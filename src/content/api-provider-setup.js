"use strict";
Object.assign(AbstractIn, {
 openAPIProviderSetup(root, id = null, options = {}) {
  root._agentSetup?.close(); this.closeMenu(root);
  const doc = root.ownerDocument, focus = doc.activeElement;
  const overlay = this.el(doc, "div", "abstractin-agent-setup"); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "API setup");
  const panel = this.el(doc, "div", "abstractin-agent-setup-panel"), body = this.el(doc, "div", "abstractin-agent-setup-body");
  const status = this.el(doc, "div", "abstractin-agent-setup-status"); status.setAttribute("role", "status");
  let config = id ? this.apiProviderConfig(id) : null, busy = false, disposed = false, dirty = false;
  const close = () => { disposed = true; overlay.remove(); if (root._agentSetup?.close === close) delete root._agentSetup; if (focus?.isConnected) focus.focus(); };
  const button = (label, action) => { const node = this.el(doc, "button", "abstractin-button", label); node.type = "button"; node.addEventListener("click", action); return node; };
  const head = this.el(doc, "div", "abstractin-agent-setup-head"); head.append(this.el(doc, "strong", null, "Add or configure API"), button("Close", close));
  root._agentSetup = { close }; panel.append(head, body, status); overlay.append(panel); root.append(overlay);
  const fields = {};
  const field = (key, label, type = "text") => {
   const input = this.el(doc, type === "textarea" ? "textarea" : "input", "abstractin-field");
   if (type !== "textarea") input.type = type;
   input.setAttribute("aria-label", label); if (type === "password") input.autocomplete = "off";
   input.addEventListener("input", () => { dirty = true; enable.disabled = true; if (["baseURL", "key", "headers"].includes(key)) body.querySelector(".abstractin-api-models")?.remove(); }); fields[key] = input; body.append(this.row(doc, label, input)); return input;
  };
  const preset = this.select(doc, Object.entries(this.API_PRESETS).map(([key, value]) => [key, value.name]), "custom", value => fill(this.API_PRESETS[value]));
  if (!config) body.append(this.row(doc, "Preset", preset));
  field("name", "API name"); field("baseURL", "Base URL");
  const protocol = this.select(doc, [["openai-chat", "OpenAI-compatible chat"], ["anthropic", "Anthropic Messages"], ["gemini", "Gemini GenerateContent"], ["custom-json", "Custom JSON (non-streaming)"]], "openai-chat", value => {
   fields.chatPath.value = { "openai-chat": "/chat/completions", anthropic: "/messages", gemini: "/models/{model}:streamGenerateContent?alt=sse", "custom-json": "/chat" }[value]; dirty = true; enable.disabled = true;
  }); fields.protocol = protocol; body.append(this.row(doc, "Protocol", protocol));
  field("model", "Model ID"); field("key", "API key", "password").placeholder = "Leave blank to keep the saved key";
  const auth = this.select(doc, [["bearer", "Bearer token"], ["header", "API key header"], ["none", "No authentication"]], "bearer", () => { dirty = true; enable.disabled = true; }); fields.auth = auth; body.append(this.row(doc, "Authentication", auth));
  field("authHeader", "API key header name");
  const advanced = this.el(doc, "details"); advanced.append(this.el(doc, "summary", null, "Advanced API settings"));
  const advancedStart = body.children.length;
  field("chatPath", "Chat endpoint path"); field("modelsPath", "Model-list path (blank for manual only)");
  fields.modelsMethod = this.select(doc, [["GET", "GET"], ["POST", "POST"]], "GET", () => { dirty = true; enable.disabled = true; }); body.append(this.row(doc, "Model-list method", fields.modelsMethod));
  field("maxTokens", "Maximum output tokens", "number"); field("timeout", "Request timeout (milliseconds)", "number");
  field("imageModels", "Image-capable model IDs (comma-separated)");
  field("headers", "Extra headers (JSON; blank keeps saved headers)", "textarea");
  field("parameters", "Extra request parameters (JSON)", "textarea");
  field("template", "Custom JSON request template", "textarea"); field("responsePath", "Custom JSON response text path");
  fields.stream = this.el(doc, "input"); fields.stream.type = "checkbox"; fields.stream.addEventListener("change", () => { dirty = true; enable.disabled = true; }); body.append(this.row(doc, "Stream responses", fields.stream));
  while (body.children.length > advancedStart) advanced.append(body.children[advancedStart]); body.append(advanced);
  body.append(this.el(doc, "p", "abstractin-row-hint", "Keys and extra headers are stored in Zotero's login manager. Only models listed as image-capable receive page images. Custom JSON supports {{model}}, {{prompt}}, {{messages}} and {{system}} placeholders and a dot-separated response path."));
  const showModels = models => {
   body.querySelector(".abstractin-api-models")?.remove();
   if (!models.length) return;
   const select = this.select(doc, [["", "Choose a model"], ...models.map(item => [item.id, item.label])], fields.model.value, value => {
    fields.model.value = value; dirty = true; enable.disabled = true;
   });
   select.setAttribute("aria-label", "Available models");
   const row = this.row(doc, "Available models", select); row.classList.add("abstractin-api-models");
   body.insertBefore(row, fields.key.closest(".abstractin-row"));
  };
  const fill = value => {
   const defaults = { protocol: "openai-chat", auth: "bearer", authHeader: "x-api-key", chatPath: "/chat/completions", modelsPath: "/models", modelsMethod: "GET", maxTokens: 8192, timeout: 180000, stream: true, parameters: {}, template: { model: "{{model}}", messages: "{{messages}}" }, responsePath: "response", imageModels: [], ...value };
   if (defaults.protocol === "anthropic" && !value.chatPath) defaults.chatPath = "/messages";
   if (defaults.protocol === "gemini" && !value.chatPath) defaults.chatPath = "/models/{model}:streamGenerateContent?alt=sse";
   for (const [key, node] of Object.entries(fields)) {
    if (["key", "headers"].includes(key)) node.value = "";
    else if (key === "stream") node.checked = defaults.stream;
    else if (["parameters", "template"].includes(key)) node.value = JSON.stringify(defaults[key], null, 2);
    else if (key === "imageModels") node.value = defaults.imageModels.join(", ");
    else node.value = defaults[key] ?? "";
   }
   dirty = !config; enable.disabled = true;
   body.querySelector(".abstractin-api-models")?.remove();
   if (config && defaults.baseURL === config.baseURL && defaults.protocol === config.protocol) showModels(this.getJSONPref(config.id + ".models", []) || []);
  };
  const read = () => this.validateAPIProvider({ ...(config ? { id: config.id } : {}), ...Object.fromEntries(Object.entries(fields).filter(([key]) => !["key", "headers"].includes(key)).map(([key, node]) => [key, key === "stream" ? node.checked : ["parameters", "template"].includes(key) ? JSON.parse(node.value || "{}") : key === "imageModels" ? node.value.split(",").map(value => value.trim()).filter(Boolean) : node.value])) });
  const task = async action => {
   if (busy) return; busy = true;
   panel.querySelectorAll("button, input, select, textarea").forEach(node => { if (node !== head.lastChild) node.disabled = true; });
   try { await action(); } catch (error) { if (!disposed) status.textContent = error.message || String(error); }
   finally { busy = false; if (!disposed) { panel.querySelectorAll("button, input, select, textarea").forEach(node => { node.disabled = false; }); enable.disabled = dirty || !config || !this.getAgentValidation(config.id)?.discussion; } }
  };
  const save = async () => {
   config = await this.saveAPIProvider(read(), { ...(fields.key.value.trim() ? { key: fields.key.value } : {}), ...(fields.headers.value.trim() ? { headers: JSON.parse(fields.headers.value) } : {}) });
   fields.key.value = ""; fields.headers.value = ""; dirty = false;
   options.onComplete?.(); return config;
  };
  const discover = async () => {
   const models = await this.loadAPIProviderModels(config.id);
   if (disposed) return;
   if (fields.model.value && !models.some(model => model.id === fields.model.value)) { fields.model.value = ""; dirty = true; }
   showModels(models);
   status.textContent = "Found " + models.length + " models from this API. Choose a model, then test and enable it.";
   options.onComplete?.();
  };
  const buttons = this.el(doc, "div", "abstractin-agent-setup-footer");
  buttons.append(button("Save API", () => task(async () => {
   await save(); if (disposed) return;
   if (!config.modelsPath) { status.textContent = "Saved. Enter a model ID and test before enabling it."; return; }
   status.textContent = "Connecting to the API and discovering available models…";
   try { await discover(); }
   catch (_) { if (!disposed) status.textContent = "API configuration saved, but its model list could not be loaded. Check the address/key, retry Refresh models, or enter a model ID manually."; }
  })),
   button("Refresh models", () => task(async () => {
    await save(); await discover();
   })), button("Test connection & reading", () => task(async () => {
    if (!fields.model.value.trim()) throw new Error("Choose an available model or enter a model ID before testing.");
    await save(); const key = this.agentConfigKey(config.id);
    status.textContent = "Testing synthetic passages; this uses the configured API. Your paper is not sent.";
    await this.testAndAdaptAgent(config.id, message => { if (!disposed) status.textContent = message; });
    if (key !== this.agentConfigKey(config.id)) throw new Error("Configuration changed. Test again.");
    if (!disposed) status.textContent = "Reading checks passed. Ready to enable; original passages are supplied by the plugin.";
   })));
  const enable = button("Enable API", () => {
   try {
    if (dirty || !config || !this.getAgentValidation(config.id)?.discussion) throw new Error("Save and test this configuration first.");
    this.assertAgentIdle(config.id);
    if (options.reading ?? !!this._views.get(root)?.ctx.reading) this.selectReadingAgent(config.id); else this.setPref("backend", config.id);
    close(); if (this._views.has(root)) this.updateControls(root); options.onComplete?.();
   } catch (error) { status.textContent = error.message; }
  });
  enable.disabled = true; buttons.append(enable); panel.append(buttons);
  fill(config ? { ...config, model: options.model ?? (this.getModel(id) || config.model) } : this.API_PRESETS.custom);
  overlay.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } });
  fields.name.focus(); return root._agentSetup;
 },
});
