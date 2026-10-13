/* Guided local CLI setup. Credentials stay with the provider's CLI. */
"use strict";
(() => {
 const testAgent = AbstractIn.testAndAdaptAgent;
 const running = new Set();
 Object.assign(AbstractIn, {
  async testAndAdaptAgent(id, onProgress) {
   if (running.has(id)) throw new Error("A compatibility check is already running for this agent. Wait for it to finish.");
   running.add(id);
   try { return await testAgent.call(this, id, onProgress); }
   finally { running.delete(id); }
  },
  async checkAgentSignIn(id, command) {
   if (!["claude", "codex"].includes(id)) return { manual: true };
   await Zotero.File.createDirectoryIfMissingAsync(this.getDataDir());
   const args = id === "claude" ? ["auth", "status"] : ["login", "status"];
   const result = await this.runAgentProcess(command, args, this.getDataDir(), null, null, null, 30000);
   if (id === "claude") {
    let status;
    try { status = JSON.parse(result.stdout); }
    catch (_) { throw new Error("Could not check sign-in. Update Claude Code, then run claude auth login in your terminal and try again."); }
    if (result.exitCode !== 0 || status.loggedIn !== true) throw new Error("Claude Code is not signed in. Complete login in your terminal, then check again.");
   } else if (result.exitCode !== 0) throw new Error("Codex is not signed in. Run codex login in your terminal, then check again.");
   return { manual: false };
  },
  openAgentSetup(root, id, options = {}) {
   const agent = this.agentRegistry()[id];
   if (!agent) return;
   root._agentSetup?.close();
   this.closeMenu(root);
   const doc = root.ownerDocument;
   const previousFocus = doc.activeElement;
   const overlay = this.el(doc, "div", "abstractin-agent-setup");
   overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
   overlay.setAttribute("aria-label", "Set up " + agent.fullName);
   const panel = this.el(doc, "div", "abstractin-agent-setup-panel");
   const head = this.el(doc, "div", "abstractin-agent-setup-head");
   head.append(this.el(doc, "strong", null, "Set up " + agent.fullName));
   const button = (label, action, className = "abstractin-button") => {
    const node = this.el(doc, "button", className, label); node.type = "button";
    node.addEventListener("click", action); return node;
   };
   let disposed = false, busy = false, step = 0, command = "", detectedKey = "", checkedKey = "", testedKey = "";
   let model = options.model ?? this.getModel(id), effort = this.getEffort(id);
   const close = () => {
    disposed = true; overlay.remove();
    if (root._agentSetup?.close === close) delete root._agentSetup;
    if (previousFocus?.isConnected) previousFocus.focus();
   };
   root._agentSetup = { close };
   head.append(button("Close", close));
   const steps = this.el(doc, "ol", "abstractin-agent-setup-steps");
   for (const label of ["Local CLI", "Sign in", "Test", "Enable"]) steps.append(this.el(doc, "li", null, label));
   const body = this.el(doc, "div", "abstractin-agent-setup-body");
   const status = this.el(doc, "div", "abstractin-agent-setup-status");
   status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
   const footer = this.el(doc, "div", "abstractin-agent-setup-footer");
   const back = button("Back", () => { if (!busy && step > 0) { step--; render(); } });
   const next = button("Continue", () => { if (!busy && !next.disabled) { step++; render(); } });
   footer.append(back, next); panel.append(head, steps, body, status, footer); overlay.append(panel);
   root.append(overlay);
   const note = text => body.append(this.el(doc, "p", null, text));
   const link = (label, url) => body.append(button(label, () => Zotero.launchURL(url)));
   const task = async (work, success) => {
    if (busy) return;
    busy = true; status.textContent = "Checking…";
    panel.querySelectorAll("button, input, select").forEach(node => { if (node !== head.lastChild) node.disabled = true; });
    try { const result = await work(); if (!disposed && overlay.isConnected) success(result); }
    catch (e) { if (!disposed) status.textContent = e.message || String(e); }
    finally {
     busy = false;
     if (!disposed) {
      panel.querySelectorAll("button, input, select").forEach(node => { node.disabled = false; });
      back.disabled = step === 0;
      next.disabled = step === 0 ? !command || detectedKey !== this.agentConfigKey(id) : step === 1 ? !checkedKey || checkedKey !== this.agentConfigKey(id) : step === 2 ? testedKey !== this.agentConfigKey(id) || !this.getAgentValidation(id)?.discussion : false;
     }
    }
   };
   const render = () => {
    body.replaceChildren(); status.textContent = ""; back.disabled = step === 0;
    next.hidden = step === 3; next.disabled = true;
    [...steps.children].forEach((node, index) => {
     node.classList.toggle("is-current", index === step);
     if (index === step) node.setAttribute("aria-current", "step"); else node.removeAttribute("aria-current");
    });
    const titles = ["Find the CLI on this computer", "Sign in with your provider", "Check the connection with Zotero", "Choose a model and enable"];
    const title = this.el(doc, "h3", null, titles[step]); title.tabIndex = -1; body.append(title);
    if (step === 0) {
     note("AbstractIn runs your local CLI. Install it on the same computer and operating system as Zotero. A CLI installed only inside WSL or on another computer is not detected here.");
     if (id === "claude") link("Open Claude Code installation guide", "https://code.claude.com/docs/en/setup");
     else if (id === "codex") link("Open Codex installation guide", "https://developers.openai.com/codex/cli/");
     else note("Install " + agent.fullName + " using its provider’s instructions. For a custom agent, configure its local ACP or AbstractIn JSONL adapter in Settings first.");
     const label = this.el(doc, "label", "abstractin-reading-field", "Executable path (optional)");
     const path = this.el(doc, "input", "abstractin-field"); path.type = "text";
     path.value = this.getPref(agent.pathPref) || ""; path.placeholder = "Detect “" + agent.command + "” automatically";
     path.addEventListener("input", () => { command = ""; detectedKey = ""; checkedKey = ""; next.disabled = true; });
     label.append(path); body.append(label);
     body.append(button("Find CLI", () => task(async () => {
      this.assertAgentIdle(id);
      const value = path.value.trim();
      if (/[\r\n\0]/.test(value)) throw new Error("Enter a single executable path.");
      if (value !== (this.getPref(agent.pathPref) || "")) {
       this.setPref(agent.pathPref, value); this.clearAgentValidation(id);
      }
      command = ""; checkedKey = "";
      const key = this.agentConfigKey(id);
      const found = await this.findBinary(id);
      await Zotero.File.createDirectoryIfMissingAsync(this.getDataDir());
      if (!agent.custom) await this.queryAgentCapabilities(id, { dir: this.getDataDir() });
      if (key !== this.agentConfigKey(id)) throw new Error("Configuration changed. Find the CLI again.");
      return { found, key };
     }, ({ found, key }) => {
      command = found; detectedKey = key;
      root._installed = { ...root._installed, [id]: found };
      status.textContent = "Found local CLI: " + found;
     })));
     next.disabled = !command || detectedKey !== this.agentConfigKey(id);
    } else if (step === 1) {
     note("Complete sign-in in your terminal using the official CLI. Your browser may open. AbstractIn never asks for your password.");
     if (["claude", "codex"].includes(id)) {
      // Copy a PowerShell or POSIX literal; never execute a shell string.
      const windows = Zotero.isWin;
      const quoted = windows ? "& '" + command.replace(/'/g, "''") + "'" : "'" + command.replace(/'/g, "'\\''") + "'";
      const login = quoted + (id === "claude" ? " auth login" : " login");
      body.append(this.el(doc, "pre", "abstractin-agent-setup-command", login));
      body.append(button("Copy sign-in command", () => {
       Zotero.Utilities.Internal.copyTextToClipboard(login); status.textContent = "Copied. Paste into " + (windows ? "PowerShell" : "your terminal") + ".";
      }));
     } else note("Open “" + agent.command + "” in your terminal and follow your provider’s sign-in instructions. Login cannot be checked automatically for this adapter; the next step tests a real request.");
     body.append(button(["claude", "codex"].includes(id) ? "Check sign-in" : "I have signed in", () => task(async () => {
      if (!command || detectedKey !== this.agentConfigKey(id)) throw new Error("Configuration changed. Go back and find the CLI again.");
      const result = await this.checkAgentSignIn(id, command);
      return { ...result, key: detectedKey };
     }, result => {
      checkedKey = result.key;
      status.textContent = result.manual ? "Ready to test. Sign-in will be verified by a real request." : "Local CLI sign-in confirmed. Continue to test the connection.";
     })));
     next.disabled = !checkedKey || checkedKey !== this.agentConfigKey(id);
    } else if (step === 2) {
     note("This sends small compatibility prompts and sample reading skills to your agent’s provider and may use your plan’s allowance. Your paper is not sent. We check responses, evidence handling and local source access.");
     body.append(button("Run connection & reading test", () => task(async () => {
      if (checkedKey !== this.agentConfigKey(id)) throw new Error("Configuration changed. Go back and check the CLI and sign-in again.");
      return await this.testAndAdaptAgent(id, message => { if (!disposed) status.textContent = message; });
     }, result => {
      testedKey = this.agentConfigKey(id);
      status.textContent = result.source ? "Passed. Discussion and local source access are available." : "Discussion passed. Local source access is unavailable; reading will use Context only.";
     })));
     next.disabled = testedKey !== this.agentConfigKey(id) || !this.getAgentValidation(id)?.discussion;
    } else {
     const validation = this.getAgentValidation(id);
     note(validation?.source ? "Ready for discussion and reading local sources." : "Ready for discussion. Reading will use Context only because local source access was not verified.");
     if (!this.getModels(id).some(item => item.id === model)) model = "";
     body.append(this.row(doc, "Model", this.select(doc, this.getModels(id).map(item => [item.id, item.label]), model, value => { model = value; })));
     const efforts = this.getEfforts(id);
     if (!efforts.includes(effort)) effort = "";
     if (efforts.length > 1) body.append(this.row(doc, "Reasoning effort", this.select(doc, efforts.map(value => [value, this.EFFORTS[value]?.label || value || "Auto"]), effort, value => { effort = value; })));
     body.append(button("Enable " + agent.label, () => {
      try {
       this.assertAgentIdle(id);
       if (!this.getAgentValidation(id)?.discussion || checkedKey !== this.agentConfigKey(id) || testedKey !== this.agentConfigKey(id)) throw new Error("Configuration changed or the test expired. Go back and test again.");
       if (options.reading ?? !!this._views.get(root)?.ctx.reading) this.selectReadingAgent(id);
       else this.setPref("backend", id);
       this.setPref(id + ".model", model); this.setPref(id + ".effort", effort);
       close(); if (this._views.has(root)) this.updateControls(root); options.onComplete?.();
      } catch (e) { status.textContent = e.message || String(e); }
     }, "abstractin-button abstractin-primary"));
    }
    title.focus();
   };
   overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") {
     const nodes = [...panel.querySelectorAll("button, input, select")].filter(node => !node.disabled && !node.hidden && !node.closest("[hidden]"));
     const first = nodes[0], last = nodes[nodes.length - 1];
     if (event.shiftKey && (doc.activeElement === first || doc.activeElement === body.firstChild)) { event.preventDefault(); last?.focus(); }
     else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
   });
   render();
   return root._agentSetup;
  },
 });
})();
