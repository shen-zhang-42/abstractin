/* Direct API agents. Secrets stay in the native login manager, never prefs. */
"use strict";
(() => {
 const configKey = AbstractIn.agentConfigKey;
 const models = AbstractIn.getModels;
 const origin = "https://api.deepseek.com";
 const realm = "AbstractIn DeepSeek API";
 Object.assign(AbstractIn, {
  deepSeekLoginManager() {
   return Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
  },
  deepSeekLogins() { return this.deepSeekLoginManager().findLogins(origin, null, realm); },
  deepSeekKey() { return this.deepSeekLogins()[0]?.password || ""; },
  async saveDeepSeekKey(value) {
   this.assertAgentIdle("deepseek");
   value = value.trim();
   if (!value || /[\s\0]/.test(value) || value.length > 4096) throw new Error("Enter a valid API key without spaces or line breaks.");
   const manager = this.deepSeekLoginManager(), existing = this.deepSeekLogins();
   const login = Components.classes["@mozilla.org/login-manager/loginInfo;1"].createInstance(Components.interfaces.nsILoginInfo);
   login.init(origin, null, realm, "api-key", value, "", "");
   if (existing.length) manager.modifyLogin(existing[0], login);
   else await manager.addLoginAsync(login);
   this.setPref("deepseek.credentialsRevision", Date.now() + "-" + Math.random().toString(36).slice(2));
   this.clearAgentValidation("deepseek");
  },
  removeDeepSeekKey() {
   this.assertAgentIdle("deepseek");
   for (const login of this.deepSeekLogins()) this.deepSeekLoginManager().removeLogin(login);
   this.setPref("deepseek.credentialsRevision", Date.now() + "-removed");
   this.clearAgentValidation("deepseek");
  },
  agentConfigKey(id) {
   return id === "deepseek" ? JSON.stringify(["agent-api-config-v1", id, origin,
    this.getPref("deepseek.credentialsRevision") || "", this.getPref("deepseek.model") || ""]) : configKey.call(this, id);
  },
  getModels(id) {
   if (id !== "deepseek") return models.call(this, id);
   const catalog = this.getJSONPref("deepseek.models", []) || [];
   const list = [{ id: "", label: "Default", desc: "First available DeepSeek model" }, ...catalog];
   const selected = this.getModel(id);
   if (selected && !list.some(model => model.id === selected)) list.push({ id: selected, label: selected });
   return list;
  },
  deepSeekRequest(path, body, { onChunk, onSpawn, timeout = 180000 } = {}) {
   const key = this.deepSeekKey();
   if (!key) throw new Error("DeepSeek API key is missing. Open Guided setup.");
   return new Promise((resolve, reject) => {
    const xhr = new (Zotero.getMainWindow().XMLHttpRequest)();
    xhr.open(body ? "POST" : "GET", origin + path, true);
    xhr.timeout = timeout;
    xhr.setRequestHeader("Authorization", "Bearer " + key);
    xhr.setRequestHeader("Content-Type", "application/json");
    // Use the bearer header; privileged Firefox XHR disallows the
    // withCredentials setter even before send, so keep its native default.
    let offset = 0, aborted = false;
    const chunk = () => {
     if (onChunk && xhr.status === 200) {
      const text = xhr.responseText.slice(offset); offset = xhr.responseText.length;
      if (text) onChunk(text);
     }
    };
    xhr.onprogress = () => { try { chunk(); } catch (e) { reject(e); xhr.abort(); } };
    xhr.onload = () => {
     if (xhr.status !== 200) {
      const errors = { 401: "Invalid API key. Update it in Guided setup.", 402: "Insufficient API balance. Top up your DeepSeek API account.",
       403: "API access denied.", 429: "Rate limit reached. Try again later.", 400: "Invalid request or unsupported model. Refresh the model list and test again.",
       500: "DeepSeek server error. Try again later.", 503: "DeepSeek is busy. Try again later." };
      reject(new Error("DeepSeek API (" + xhr.status + "): " + (errors[xhr.status] || "Request failed. Try again later."))); return;
     }
     try { chunk(); resolve(xhr.responseText); } catch (e) { reject(e); }
    };
    xhr.onerror = () => reject(new Error("Cannot connect to DeepSeek. Check your network or proxy."));
    xhr.ontimeout = () => reject(new Error("DeepSeek request timed out. Try again."));
    xhr.onabort = () => reject(new Error("DeepSeek request cancelled."));
    onSpawn?.({ kill: () => { aborted = true; xhr.abort(); reject(new Error("DeepSeek request cancelled.")); } });
    if (aborted) return; // A pending cancellation can abort before send.
    xhr.send(body ? JSON.stringify(body) : null);
   });
  },
  async loadDeepSeekModels() {
   const key = this.agentConfigKey("deepseek");
   const response = JSON.parse(await this.deepSeekRequest("/models", null, { timeout: 30000 }));
   const ids = new Set(), list = [];
   for (const item of Array.isArray(response.data) ? response.data : []) {
    if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(item.id) || ids.has(item.id)) continue;
    ids.add(item.id); list.push({ id: item.id, label: typeof item.name === "string" ? item.name : item.id });
   }
   if (!list.length) throw new Error("DeepSeek returned no models. Check your API key and try again.");
   if (key !== this.agentConfigKey("deepseek")) throw new Error("Configuration changed. Refresh again.");
   const saved = JSON.stringify(list);
   if (saved !== this.getPref("deepseek.models") && !this.getModel("deepseek")) this.clearAgentValidation("deepseek");
   this.setPref("deepseek.models", saved);
   return list;
  },
  async runDeepSeek(request) {
   try {
    if (request.images?.length) throw new Error("This DeepSeek integration supports text only. Remove the images and try again.");
    const model = request.model || this.getModel("deepseek") || this.getModels("deepseek").find(item => item.id)?.id;
    if (!model) throw new Error("No DeepSeek model selected. Open Guided setup to refresh models.");
    let text = "", buffer = "", finished = false;
    const consume = line => {
     if (!line.startsWith("data:")) return;
     const data = line.slice(5).trim();
     if (!data) return;
     if (data === "[DONE]") { finished = true; return; }
     const event = JSON.parse(data);
     if (event.error) throw new Error("DeepSeek could not complete the request. Check the model and retry.");
     if (event.choices?.[0]?.finish_reason === "length") throw new Error("DeepSeek reached the output limit. Ask a shorter question.");
     if (event.choices?.[0]?.finish_reason === "content_filter") throw new Error("DeepSeek declined this request.");
     const part = event.choices?.[0]?.delta?.content;
     if (typeof part === "string") { text += part; request.onProgress?.({ text }); }
    };
    const prompt = this.transcriptFor(request.history || [], null) + (request.question || "") +
     this.formattingReminder(request.ctx?.reading?.vocabularyTutor ? "English" : this.getLanguage());
    await this.deepSeekRequest("/chat/completions", { model, messages: [{ role: "user", content: prompt }], stream: true }, {
     onSpawn: request.onSpawn,
     onChunk: chunk => {
      buffer += chunk;
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) consume(line.replace(/\r$/, ""));
     },
    });
    if (buffer.trim()) consume(buffer.replace(/\r$/, ""));
    if (!finished) throw new Error("DeepSeek response was interrupted. Try again.");
    if (!text.trim()) throw new Error("DeepSeek returned no answer. Try again.");
    return { text, session: null, usage: null };
   } catch (e) { return { text: "", error: e.message || String(e) }; }
  },
  openDeepSeekSetup(root, options = {}) {
   root._agentSetup?.close(); this.closeMenu(root);
   const doc = root.ownerDocument, focus = doc.activeElement;
   const overlay = this.el(doc, "div", "abstractin-agent-setup"); overlay.setAttribute("role", "dialog");
   overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "Set up DeepSeek API");
   const panel = this.el(doc, "div", "abstractin-agent-setup-panel"), head = this.el(doc, "div", "abstractin-agent-setup-head");
   let step = 0, busy = false, disposed = false, verified = "", tested = "";
   let model = options.model ?? this.getModel("deepseek");
   const button = (label, action) => { const node = this.el(doc, "button", "abstractin-button", label); node.type = "button"; node.addEventListener("click", action); return node; };
   const close = () => { disposed = true; overlay.remove(); if (root._agentSetup?.close === close) delete root._agentSetup; if (focus?.isConnected) focus.focus(); };
   root._agentSetup = { close };
   head.append(this.el(doc, "strong", null, "Set up DeepSeek API"), button("Close", close));
   const steps = this.el(doc, "ol", "abstractin-agent-setup-steps");
   for (const label of ["API key", "Configure", "Test", "Enable"]) steps.append(this.el(doc, "li", null, label));
   const body = this.el(doc, "div", "abstractin-agent-setup-body"), status = this.el(doc, "div", "abstractin-agent-setup-status");
   status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
   const footer = this.el(doc, "div", "abstractin-agent-setup-footer");
   const back = button("Back", () => { if (!busy && step > 0) { step--; render(); } });
   const next = button("Continue", () => { if (!busy && !next.disabled) { step++; render(); } });
   footer.append(back, next); panel.append(head, steps, body, status, footer); overlay.append(panel); root.append(overlay);
   const valid = () => step === 0 || (step === 1 ? verified === this.agentConfigKey("deepseek") : tested === this.agentConfigKey("deepseek") && !!this.getAgentValidation("deepseek")?.discussion);
   const task = async work => {
    if (busy) return; busy = true; status.textContent = "Checking…";
    panel.querySelectorAll("button, input, select").forEach(node => { if (node !== head.lastChild) node.disabled = true; });
    try { await work(); } catch (e) { if (!disposed) status.textContent = e.message || String(e); }
    finally { busy = false; if (!disposed) { panel.querySelectorAll("button, input, select").forEach(node => { node.disabled = false; }); back.disabled = step === 0; next.disabled = !valid(); } }
   };
   const note = text => body.append(this.el(doc, "p", null, text));
   const render = () => {
    body.replaceChildren(); status.textContent = ""; next.hidden = step === 3; back.disabled = step === 0; next.disabled = !valid();
    [...steps.children].forEach((node, index) => { node.classList.toggle("is-current", index === step); if (index === step) node.setAttribute("aria-current", "step"); else node.removeAttribute("aria-current"); });
    const title = this.el(doc, "h3", null, ["Create a DeepSeek API key", "Save your key and choose a model", "Test the connection and reading", "Enable DeepSeek"][step]);
    title.tabIndex = -1; body.append(title);
    if (step === 0) {
     note("No local CLI is required. Create an API key on the official DeepSeek platform. API usage is billed separately from the web chat service.");
     body.append(button("Open DeepSeek API key page", () => Zotero.launchURL("https://platform.deepseek.com/api_keys")));
     note("AbstractIn sends your questions and supplied reading text to DeepSeek when you use this assistant. It does not give this API assistant access to local files.");
    } else if (step === 1) {
     note("API address: https://api.deepseek.com. The key is stored in Zotero’s login manager, not in plugin preferences or chat history.");
     const input = this.el(doc, "input", "abstractin-field"); input.type = "password"; input.autocomplete = "off";
     input.setAttribute("aria-label", "DeepSeek API key"); input.placeholder = "Paste a new API key; leave blank to keep the saved key";
     input.addEventListener("input", () => { verified = ""; tested = ""; next.disabled = true; });
     body.append(this.row(doc, "API key", input));
     const picker = () => {
      const old = body.querySelector(".deepseek-model-row"); old?.remove();
      const row = this.row(doc, "Model", this.select(doc, this.getModels("deepseek").map(item => [item.id, item.label]), model, value => {
       model = value; this.assertAgentIdle("deepseek"); this.setPref("deepseek.model", model); this.clearAgentValidation("deepseek");
       verified = input.value.trim() ? "" : this.agentConfigKey("deepseek"); tested = ""; next.disabled = !verified;
      })); row.classList.add("deepseek-model-row"); body.append(row);
     };
     body.append(button("Save key & refresh models", () => task(async () => {
      verified = ""; tested = "";
      if (input.value.trim()) { await this.saveDeepSeekKey(input.value); input.value = ""; }
      await this.loadDeepSeekModels();
      this.assertAgentIdle("deepseek"); this.setPref("deepseek.model", model);
      verified = this.agentConfigKey("deepseek");
      if (!disposed) { picker(); status.textContent = "API key accepted. Models refreshed."; }
     })));
     body.append(button("Remove saved key", () => { try { this.removeDeepSeekKey(); verified = ""; tested = ""; next.disabled = true; status.textContent = "Saved API key removed."; } catch (e) { status.textContent = e.message; } }));
     if (verified === this.agentConfigKey("deepseek")) picker();
    } else if (step === 2) {
     note("This sends small sample prompts to DeepSeek and may incur API charges. Your paper is not sent during this test. We check supplied-text evidence handling and reading-record output.");
     body.append(button("Run connection & reading test", () => task(async () => {
      if (verified !== this.agentConfigKey("deepseek")) throw new Error("Configuration changed. Go back and refresh models.");
      const result = await this.testAndAdaptAgent("deepseek", message => { if (!disposed) status.textContent = message; });
      tested = result.configKey;
      if (!disposed) status.textContent = "Passed. Ready for discussion using supplied text. Local file access is unavailable.";
     })));
    } else {
     note("Model: " + this.modelLabel("deepseek", model)); note("Reading uses Context only. Select or paste the text you want to discuss; local source-file tools are unavailable.");
     body.append(button("Enable DeepSeek", () => {
      try {
       this.assertAgentIdle("deepseek");
       if (!valid()) throw new Error("Configuration changed. Go back and test again.");
       if (options.reading ?? !!this._views.get(root)?.ctx.reading) this.selectReadingAgent("deepseek"); else this.setPref("backend", "deepseek");
       close(); if (this._views.has(root)) this.updateControls(root); options.onComplete?.();
      } catch (e) { status.textContent = e.message; }
     }));
    }
    title.focus();
   };
   overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
     const nodes = [...panel.querySelectorAll("button, input, select")].filter(node => !node.disabled && !node.hidden);
     const first = nodes[0], last = nodes[nodes.length - 1];
     if (event.shiftKey && (doc.activeElement === first || doc.activeElement === body.firstChild)) { event.preventDefault(); last?.focus(); }
     else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
   });
   render(); return root._agentSetup;
  },
 });
})();
