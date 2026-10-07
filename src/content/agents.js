/* Agent registry, declarative adapters and verified skill compatibility.
 * Original skills remain immutable. Generated mappings are stored separately.
 */
"use strict";
(() => {
 const builtin = Object.fromEntries(Object.entries(AbstractIn.BACKENDS).map(([id, agent]) => [id, { ...agent }]));
 const nativeRun = AbstractIn.runBackend;
 const nativeGetBackend = AbstractIn.getBackend;
 const nativeInit = AbstractIn.init;
 const nativeGetModels = AbstractIn.getModels;
 const nativeGetEfforts = AbstractIn.getEfforts;
 Object.assign(AbstractIn, {
  agentRegistry() {
   const saved = this.getJSONPref("agents", []) || [];
   const registry = { ...builtin };
   for (const item of Array.isArray(saved) ? saved : []) {
    try {
     const agent = this.validateAgentConfig(item);
     registry[agent.id] = { ...agent, label: agent.name, fullName: agent.name,
      pathPref: "agent." + agent.id + ".path", images: false, models: [{ id: "", label: "Default" }], efforts: [""], custom: true };
    } catch (e) { this.logError("agent configuration", e); }
   }
   for (const id of Object.keys(this.BACKENDS)) if (!registry[id]) delete this.BACKENDS[id];
   for (const [id, agent] of Object.entries(registry)) {
    const checked = (this.getJSONPref("agentValidation", {}) || {})[id];
    const key = JSON.stringify([this.version || "development", id, agent.command, agent.args || [], agent.protocol || "native", this.getPref(agent.pathPref) || "", id === "claude" ? !!this.getPref("useClaudeUserSettings") : false]);
    if (agent.custom) this.BACKEND_ICONS[id] = "terminal";
    if (agent.custom && checked?.configKey === key) agent.images = checked.images === true;
   }
   Object.assign(this.BACKENDS, registry);
   return registry;
  },
  init(options) { this.agentRegistry(); return nativeInit.call(this, options); },
  getBackend() { this.agentRegistry(); return nativeGetBackend.call(this); },
  readingAgent() {
   const registry = this.agentRegistry();
   const selected = this.getPref("readingAgent") || "codex";
   return registry[selected] ? selected : "codex";
  },
  selectReadingAgent(id) {
   if (!this.agentRegistry()[id]) throw new Error("Unknown agent.");
   if (id !== "codex" && !this.getAgentValidation(id)?.discussion) throw new Error("Test this agent before enabling it for reading.");
   this.setPref("readingAgent", id);
   if (!this.agentCanReadSources(id)) this.setPref("readingEvidenceMode", "knowledge");
  },
  agentCanReadSources(id = this.readingAgent()) { return id === "codex" || this.getAgentValidation(id)?.source === true; },
  validateAgentConfig(input) {
   if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Import an agent configuration object.");
   const id = input.id || "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
   if (!/^custom-[a-z0-9-]{1,60}$/.test(id)) throw new Error("Custom agent IDs must start with custom- and contain lowercase letters, digits or hyphens.");
   const name = String(input.name || "").trim();
   const command = String(input.command || "").trim();
   if (!name || name.length > 100 || !command || command.length > 4096 || /[\r\n\0]/.test(command)) throw new Error("Enter a name and one executable path or command.");
   const protocol = input.protocol || "acp";
   if (!["acp", "abstractin-jsonl"].includes(protocol)) throw new Error("Supported adapters: ACP v1 and AbstractIn JSONL v1.");
   const args = input.args || [];
   if (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== "string" || arg.length > 4096 || arg.includes("\0"))) throw new Error("Arguments must be a JSON array of strings.");
   // Imports are data, never JavaScript or a shell command template.
   return { id, name, command, protocol, args: [...args], adapterVersion: 1 };
  },
  saveAgent(input) {
   const config = this.validateAgentConfig(input);
   this.assertAgentIdle(config.id);
   const saved = this.getJSONPref("agents", []) || [];
   const list = (Array.isArray(saved) ? saved : []).filter(item => item.id !== config.id);
   if (list.length >= 50) throw new Error("At most 50 custom agents can be configured.");
   list.push(config);
   this.setPref("agents", JSON.stringify(list));
   this.clearAgentValidation(config.id);
   this.agentRegistry();
   return config;
  },
  removeAgent(id) {
   this.assertAgentIdle(id);
   if (builtin[id]) throw new Error("Built-in agents cannot be deleted.");
   this.setPref("agents", JSON.stringify((this.getJSONPref("agents", []) || []).filter(item => item.id !== id)));
   this.clearAgentValidation(id);
   if (this.getPref("readingAgent") === id) this.setPref("readingAgent", "codex");
   if (this.getPref("backend") === id) this.setPref("backend", "codex");
   this.agentRegistry();
  },
  clearAgentValidation(id) {
   const results = this.getJSONPref("agentValidation", {}) || {};
   delete results[id];
   this.setPref("agentValidation", JSON.stringify(results));
   if (this.getPref("readingAgent") === id) this.setPref("readingAgent", "codex");
  },
  agentConfigKey(id) {
   const agent = this.agentRegistry()[id];
   return JSON.stringify([this.version || "development", id, agent?.command, agent?.args || [], agent?.protocol || "native", this.getPref(agent?.pathPref) || "", id === "claude" ? !!this.getPref("useClaudeUserSettings") : false]);
  },
  getAgentValidation(id) {
   const result = (this.getJSONPref("agentValidation", {}) || {})[id];
   return result?.configKey === this.agentConfigKey(id) ? result : null;
  },
  getModels(id) {
   this.agentRegistry();
   if (!this.BACKENDS[id]?.custom) return nativeGetModels.call(this, id);
   const result = this.getAgentValidation(id);
   return [{ id: "", label: "Default" }, ...(result?.models || [])];
  },
  getEfforts(id) {
   this.agentRegistry();
   if (!this.BACKENDS[id]?.custom) return nativeGetEfforts.call(this, id);
   return ["", ...(this.getAgentValidation(id)?.efforts || [])];
  },
  async hashAgentText(text) {
   const win = Zotero.getMainWindow();
   const bytes = new TextEncoder().encode(text);
   const hash = await win.crypto.subtle.digest("SHA-256", bytes);
   return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  },
  async agentSkillSnapshot() {
   const files = [];
   for (const type of ["book", "paper", "extraction"]) {
    const skill = await this.findReadingSkill(type);
    const root = skill.path.replace(/[\\/]SKILL\.md$/, "");
    const walk = async (path, relative = "") => {
     const iterator = new OS.File.DirectoryIterator(path);
     const entries = [];
     try { await iterator.forEach(entry => entries.push(entry)); } finally { iterator.close(); }
     for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymLink) throw new Error("Skill resources must not contain symbolic links.");
      if (entry.name.startsWith(".")) continue;
      const name = relative + entry.name;
      if (entry.isDir) await walk(entry.path, name + "/");
      else files.push({ type, name, path: entry.path, content: await Zotero.File.getContentsAsync(entry.path) });
     }
    };
    await walk(root);
   }
   const fingerprint = await this.hashAgentText(JSON.stringify(files.map(({ type, name, content }) => [type, name, content])));
   return { fingerprint, files };
  },
  async assertAgentReadingReady(id, mode) {
   if (id === "codex") return; // Existing, supported native integration.
   const result = this.getAgentValidation(id);
   if (!result?.discussion) throw new Error("Test and adapt this agent in Settings → Assistants before using it for reading.");
   const actual = await this.queryAgentCapabilities(id, { dir: this.getDataDir() });
   if (actual.version !== result.agentVersion) { this.clearAgentValidation(id); throw new Error("Agent version changed. Test and adapt it again."); }
   const snapshot = await this.agentSkillSnapshot();
   if (snapshot.fingerprint !== result.skillFingerprint) {
    this.clearAgentValidation(id);
    throw new Error("Reading skills changed. Test and adapt this agent again.");
   }
   if (mode !== "knowledge" && !result.source) throw new Error("This agent passed discussion tests but cannot read original sources. Choose Knowledge discussion or a source-capable agent.");
  },
  agentMappingText(result) {
   return "AbstractIn agent adaptation v1. Original skills are authoritative and unchanged. " +
    "Use the supplied original skill content and resources. " +
    (result?.source ? "Source files are available through the verified read capability. " : "No original-source file access was verified. Use only supplied context and request missing evidence. ") +
    "The plugin supplies reader identity, page text and saved notes, handles navigation, validates source quotations, and saves records. " +
    "Never invent tools, infer a printed-page offset, claim unperformed source verification, rewrite skills, or write reading notes yourself. " +
    "Verified mappings: " + JSON.stringify(result?.mappings || []);
  },
  async agentReadingContext(id, ctx) {
   if (id === "codex") return "";
   const snapshot = await this.agentSkillSnapshot();
   const result = this.getAgentValidation(id);
   if (!result || result.skillFingerprint !== snapshot.fingerprint) throw new Error("Agent skill adaptation is out of date. Test again in Settings.");
   const relevant = snapshot.files.filter(file => file.type === ctx.reading.type || (ctx.reading.type === "paper" && file.type === "extraction"));
   return "\n\n" + this.agentMappingText(result) + "\n" + relevant.map(file =>
    "<original-skill-resource type=" + JSON.stringify(file.type) + " file=" + JSON.stringify(file.name) + ">\n" + file.content + "\n</original-skill-resource>").join("\n");
  },
  async testAndAdaptAgent(id, onProgress = () => {}) {
   this.assertAgentIdle(id);
   const agent = this.agentRegistry()[id];
   if (!agent) throw new Error("Unknown agent.");
   const configKey = this.agentConfigKey(id);
   this.clearAgentValidation(id);
   const root = OS.Path.join(this.getDataDir(), "agent-checks");
   const dir = OS.Path.join(root, id + "-" + Date.now());
   for (const folder of [this.getDataDir(), root, dir]) await Zotero.File.createDirectoryIfMissingAsync(folder);
   const snapshot = await this.agentSkillSnapshot();
   const nonce = "passage-" + Math.random().toString(36).slice(2);
   const sourceNonce = "source-" + Math.random().toString(36).slice(2);
   const source = "Theorem 2. Physical PDF page index 4; printed page label vii. The measurement code is " + nonce + ".";
   await Zotero.File.putContentsAsync(OS.Path.join(dir, "source-probe.txt"), source.replace(nonce, sourceNonce));
   const ctx = { dir };
   const request = { ctx, files: {}, history: [], session: null, images: [], model: "", effort: "", onProgress: event => onProgress(event.status || "Testing…"), onSpawn() {} };
   const capabilities = await this.queryAgentCapabilities(id, ctx);
   onProgress("Checking skill adaptation…");
   const available = agent.protocol === "acp" ? ["fs/read_text_file"] : id === "claude" ? ["Read"] : id === "codex" ? ["local-file-read"] : capabilities.files ? ["adapter-file-read"] : [];
   const adaptation = await this.runBackend(id, { ...request, question:
    "Prepare a tool mapping for these original reading skills; do not rewrite them. Return ONLY JSON " +
    '{"mappings":[{"operation":"read_source","tool":"one available tool"}],"unsupported":[]}. ' +
    "Available tools (list no others): " + JSON.stringify(available) + ". Use an empty mapping if file reading is unavailable. " +
    snapshot.files.filter(file => file.name === "SKILL.md").map(file => "\nOriginal " + file.type + " skill:\n" + file.content).join("\n") });
   if (adaptation.error) throw new Error(adaptation.error);
   const plan = this.parseAgentObject(adaptation.text);
   if (!Array.isArray(plan.mappings) || plan.mappings.length > 1 || !Array.isArray(plan.unsupported) || plan.unsupported.some(value => typeof value !== "string")) throw new Error("Agent returned an invalid skill mapping.");
   for (const mapping of plan.mappings) {
    if (mapping.operation !== "read_source" || !available.includes(mapping.tool) || Object.keys(mapping).some(key => !["operation", "tool"].includes(key))) throw new Error("Agent invented an unsupported tool mapping.");
   }
   onProgress("Testing evidence handling and record output…");
   const record = '<abstractin-record>{"title":"Check","summary":"The supplied passage contains the requested measurement code.","openQuestions":[],"scope":{"level":"paper","id":"","title":""},"topicKey":"agent-check","sources":[]}</abstractin-record>';
   const discussion = await this.runBackend(id, { ...request, question:
    "Compatibility test. Supplied passage: " + source + "\nExplain the measurement code using only this passage, quote the code exactly, and distinguish physical page index 4 from printed label vii. " +
    "The value of missing Theorem 99 is not supplied. Say explicitly that it is unavailable; do not guess. " +
    'Before the record append <abstractin-agent-check>{"code":"the exact supplied code","pageIndex":4,"printedPageLabel":"vii","missingTheorem":null}</abstractin-agent-check>. ' +
    "End with one record following this example, preserving scope and topicKey and empty sources: " + record });
   if (discussion.error) throw new Error(discussion.error);
   const parsedRecord = this.parseReadingAnswer(discussion.text).record;
   const evidenceCheck = this.readingEnvelope(discussion.text, "agent-check");
   if (!parsedRecord || evidenceCheck?.code !== nonce || evidenceCheck.pageIndex !== 4 || evidenceCheck.printedPageLabel !== "vii" || evidenceCheck.missingTheorem !== null ||
    parsedRecord.scope?.level !== "paper" || parsedRecord.topicKey !== "agent-check" || !Array.isArray(parsedRecord.sources) || parsedRecord.sources.length) {
    throw new Error("Agent failed the supplied-passage, missing-evidence or reading-record check.");
   }
   let sourcePassed = false;
   if (plan.mappings.length) {
    onProgress("Testing original-source access…");
    const read = await this.runBackend(id, { ...request, question:
     'Read source-probe.txt in the working directory using your file-reading capability. Return ONLY JSON {"code":"exact measurement code","pageIndex":4,"printedPageLabel":"vii"}. The code was not included in this prompt. If reading is unavailable return {"unavailable":true}.' });
    if (!read.error) {
     try { const value = this.parseAgentObject(read.text); sourcePassed = value.code === sourceNonce && value.pageIndex === 4 && value.printedPageLabel === "vii"; } catch (e) { /* Discussion remains available. */ }
    }
   }
   if (this.agentConfigKey(id) !== configKey || (await this.agentSkillSnapshot()).fingerprint !== snapshot.fingerprint) throw new Error("Agent configuration or skills changed during testing. Run the check again.");
   const result = { configKey, skillFingerprint: snapshot.fingerprint, agentVersion: capabilities.version || "unknown",
    checkedAt: new Date().toISOString(), discussion: true, source: sourcePassed, images: !!capabilities.images,
    models: discussion.capabilities?.models || capabilities.models || [], efforts: capabilities.efforts || [], mappings: sourcePassed ? plan.mappings : [],
    tests: { suppliedPassage: true, missingEvidence: true, readingRecord: true, originalSource: sourcePassed } };
   // Store the overlay outside all original skill directories.
   const cache = OS.Path.join(this.getDataDir(), "agent-adaptations");
   await Zotero.File.createDirectoryIfMissingAsync(cache);
   await Zotero.File.putContentsAsync(OS.Path.join(cache, id + ".json"), JSON.stringify(result, null, 2));
   await Zotero.File.putContentsAsync(OS.Path.join(cache, id + ".md"), this.agentMappingText(result));
   const results = this.getJSONPref("agentValidation", {}) || {};
   results[id] = result;
   this.setPref("agentValidation", JSON.stringify(results));
   this.BACKENDS[id].images = result.images;
   return result;
  },
  parseAgentObject(text) {
   const clean = String(text || "").trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1");
   const value = JSON.parse(clean);
   if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
   return value;
  },
  async runBackend(id, request) {
   const agent = this.agentRegistry()[id];
   if (!agent) throw new Error("Unknown agent: " + id);
   if (!agent.custom) return nativeRun.call(this, id, request);
   return agent.protocol === "acp" ? this.runACPAgent(id, request) : this.runJSONLAgent(id, request);
  },
  async queryAgentCapabilities(id, ctx) {
   if (!this.BACKENDS[id].custom) {
    const command = await this.findBinary(id);
    const result = await this.runAgentProcess(command, ["--version"], ctx.dir, null, null, null, 30000);
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error("Could not determine the agent version.");
    return { images: !!builtin[id].images, version: result.stdout.trim().slice(0, 100), files: id !== "agy" };
   }
   if (this.BACKENDS[id].protocol === "acp") {
    const client = await this.openACPAgent(id, ctx, () => {}, () => {});
    try { return client.capabilities; } finally { await client.close(); }
   }
   const result = await this.runJSONLAgent(id, { ctx, capabilityProbe: true, onProgress() {}, onSpawn() {} });
   if (result.error) throw new Error(result.error);
   const value = this.parseAgentObject(result.text);
   if (value.protocol !== "abstractin-jsonl/1") throw new Error("Adapter must implement abstractin-jsonl/1.");
   return this.normalizeAgentCapabilities(value);
  },
  normalizeAgentCapabilities(value) {
   const models = (Array.isArray(value.models) ? value.models : []).filter(model => model && typeof model.id === "string" && /^[a-zA-Z0-9._:/-]+$/.test(model.id)).slice(0, 100).map(model => ({ id: model.id, label: typeof model.label === "string" ? model.label : model.id }));
   const efforts = (Array.isArray(value.efforts) ? value.efforts : []).filter(effort => ["low", "medium", "high", "xhigh", "max"].includes(effort));
   return { files: value.files === true, images: value.images === true, version: String(value.version || "unknown").slice(0, 100), models, efforts: [...new Set(efforts)] };
  },
  async runJSONLAgent(id, request) {
   const agent = this.BACKENDS[id];
   const command = await this.findBinary(id);
   const payload = { protocol: "abstractin-jsonl/1", method: request.capabilityProbe ? "capabilities" : "prompt",
    prompt: request.question || "", instructions: this.systemPrompt(request.ctx), context: request.files || {},
    history: request.history || [], sessionId: request.session?.id || null, model: request.model || "", effort: request.effort || "",
    images: request.images || [], cwd: request.ctx.dir };
   let text = "", sessionId = null, complete = false;
   const stream = event => {
    if (event.type === "delta" && typeof event.text === "string") { text += event.text; request.onProgress?.({ text, status: "writing" }); }
    if (event.type === "result" && typeof event.text === "string") { complete = true; text = event.text; sessionId = typeof event.sessionId === "string" ? event.sessionId : null; }
   };
   const run = await this.runAgentProcess(command, agent.args, request.ctx.dir, stream, request.onSpawn, JSON.stringify(payload) + "\n", request.capabilityProbe ? 30000 : 180000, this.buildChildEnvironment({ preserveAPIKeys: true }));
   if (request.capabilityProbe && run.exitCode === 0) return { text: run.stdout.trim() };
   for (const event of this.parseJsonLines(run.stdout)) if (event.type === "result") stream(event);
   return { text: run.exitCode === 0 && complete ? text : "", sessionId, resumeFailed: !!request.session && run.exitCode !== 0, error: run.exitCode === 0 && complete && text ? "" : (run.stderr.trim() || "Adapter did not return a result.") };
  },
 });
})();

Object.assign(AbstractIn, {
 async agentReadFile(ctx, path, line = 1, limit = undefined) {
  if (ctx.reading?.evidenceMode === "knowledge") throw new Error("File access is unavailable during Knowledge discussion.");
  if (typeof path !== "string" || path.includes("\0")) throw new Error("Invalid source path.");
  const root = OS.Path.normalize(ctx.dir);
  const absolute = OS.Path.normalize(/^(?:[A-Za-z]:[\\/]|[\\/])/.test(path) ? path : OS.Path.join(root, path));
  const relative = absolute.slice(root.length).replace(/^[\\/]/, "");
  if (!absolute.startsWith(root + (Zotero.isWin ? "\\" : "/")) || !relative) throw new Error("Source path is outside this reading workspace.");
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
   current = OS.Path.join(current, part);
   const info = await OS.File.stat(current, { unixNoFollowingLinks: true });
   if (info.isSymLink) throw new Error("Symbolic links are not source files.");
  }
  if (!Number.isInteger(line) || line < 1 || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) throw new Error("Invalid line range.");
  const text = await Zotero.File.getContentsAsync(absolute);
  return text.split("\n").slice(line - 1, limit === undefined ? undefined : line - 1 + limit).join("\n");
 },
 async openACPAgent(id, ctx, onProgress, onSpawn) {
  const agent = this.BACKENDS[id];
  const command = await this.findBinary(id);
  const proc = await Subprocess.call({ command, arguments: agent.args, environment: this.buildChildEnvironment({ preserveAPIKeys: true }), workdir: ctx.dir, stderr: "pipe" });
  const win = Zotero.getMainWindow();
  const pending = new Map();
  let sequence = 0, closed = false, stderr = "", failure = null, activeSession = null;
  let writes = Promise.resolve();
  const send = message => {
   writes = writes.then(() => proc.stdin.write(new TextEncoder().encode(JSON.stringify(message) + "\n").buffer));
   return writes;
  };
  const fail = error => {
   failure = error;
   for (const entry of pending.values()) { win.clearTimeout(entry.timer); entry.reject(error); }
   pending.clear();
  };
  const call = (method, params, timeout = 180000) => {
   if (closed || failure) return Promise.reject(failure || new Error("Agent connection closed."));
   const requestId = ++sequence;
   return new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => {
     pending.delete(requestId);
     reject(new Error("Agent timed out during " + method + "."));
     proc.kill();
    }, timeout);
    pending.set(requestId, { resolve, reject, timer });
    send({ jsonrpc: "2.0", id: requestId, method, params }).catch(fail);
   });
  };
  const receive = async message => {
   if (message.jsonrpc !== "2.0") throw new Error("Invalid ACP response.");
   if (message.method === "session/update") {
    const update = message.params?.update;
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") onProgress({ delta: update.content.text, status: "writing" });
    else if (update?.sessionUpdate === "agent_thought_chunk") onProgress({ status: "thinking", thinking: true });
    return;
   }
   if (message.method && message.id !== undefined) {
    try {
     let result;
     if (message.method === "fs/read_text_file") {
      result = { content: await this.agentReadFile(ctx, message.params?.path, message.params?.line ?? 1, message.params?.limit) };
     } else if (message.method === "session/request_permission") {
      result = { outcome: { outcome: "cancelled" } };
     } else throw new Error("Unsupported operation: " + message.method);
     await send({ jsonrpc: "2.0", id: message.id, result });
    } catch (e) { await send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: e.message } }); }
    return;
   }
   const entry = pending.get(message.id);
   if (entry) {
    pending.delete(message.id); win.clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || "ACP request failed."));
    else entry.resolve(message.result);
   }
  };
  const reader = (async () => {
   let buffer = "", chunk;
   try {
    while ((chunk = await proc.stdout.readString())) {
     buffer += chunk;
     if (buffer.length > 4000000) throw new Error("ACP message exceeds the supported size.");
     const lines = buffer.split("\n"); buffer = lines.pop();
     for (const line of lines) if (line.trim()) await receive(JSON.parse(line));
    }
    if (!closed) fail(new Error("Agent disconnected" + (stderr ? ": " + stderr.slice(-1000) : ".")));
   } catch (e) { if (!closed) { fail(e); proc.kill(); } }
  })();
  const errors = (async () => {
   try { let chunk; while ((chunk = await proc.stderr.readString())) stderr = (stderr + chunk).slice(-4000); } catch (e) { /* Process may have been cancelled. */ }
  })();
  const close = async () => {
   if (closed) return;
   closed = true;
   fail(new Error("Agent connection closed."));
   try { await proc.stdin.close(); } catch (e) { /* Closed by agent. */ }
   proc.kill();
   await Promise.allSettled([reader, errors, proc.wait()]);
  };
  // The request owns this process, so Stop kills it and rejects in-flight calls.
  onSpawn?.({ kill: () => {
   if (activeSession) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: activeSession } }).catch(() => {}).finally(() => proc.kill());
   else proc.kill();
  } });
  try {
   const init = await call("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: ctx.reading?.evidenceMode !== "knowledge", writeTextFile: false }, terminal: false },
    clientInfo: { name: "abstractin", version: this.version || "development" } }, 30000);
   if (init.protocolVersion !== 1) throw new Error("This client supports ACP protocol version 1. Use a compatible adapter.");
   const capabilities = this.normalizeAgentCapabilities({ version: init.agentInfo?.version, images: init.agentCapabilities?.promptCapabilities?.image });
   return { call, close, proc, setSession: id => { activeSession = id; }, capabilities, loadSession: init.agentCapabilities?.loadSession === true };
  } catch (e) { await close(); throw e; }
 },
 async runACPAgent(id, request) {
  let text = "";
  const client = await this.openACPAgent(id, request.ctx, event => {
   if (event.delta) text += event.delta;
   request.onProgress?.({ ...event, ...(event.delta ? { text } : {}) });
  }, request.onSpawn);
  try {
   const resumed = request.session?.id && client.loadSession;
   let session;
   try { session = (await client.call(resumed ? "session/load" : "session/new", { cwd: request.ctx.dir, mcpServers: [], ...(resumed ? { sessionId: request.session.id } : {}) })) || {}; }
   catch (e) { if (resumed) return { text: "", error: e.message, resumeFailed: true }; throw e; }
   const sessionId = resumed ? request.session.id : session.sessionId;
   if (typeof sessionId !== "string" || !sessionId) throw new Error("ACP agent did not create a session.");
   client.setSession(sessionId);
   const models = session.models?.availableModels?.map(model => ({ id: model.modelId, label: model.name })) || [];
   client.capabilities.models = this.normalizeAgentCapabilities({ models }).models;
   if (request.model) {
    if (!session.models?.availableModels?.some(model => model.modelId === request.model)) throw new Error("This ACP session does not offer the selected model.");
    await client.call("session/set_model", { sessionId, modelId: request.model });
   }
   if (request.effort) throw new Error("This ACP adapter does not advertise reasoning-effort controls.");
   // A loaded agent owns its history; a new session receives the transcript.
   const prompt = [{ type: "text", text: this.systemPrompt(request.ctx) + "\n\n" +
    (resumed ? "" : this.transcriptFor(request.history || [], null)) + JSON.stringify(request.files || {}) + "\n\n" + request.question }];
   for (const path of request.images || []) {
    if (!client.capabilities.images) throw new Error("This agent does not support images.");
    const bytes = await OS.File.read(path);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const extension = path.split(".").pop().toLowerCase();
    const mimeType = Object.entries(this.IMAGE_TYPES).find(([, ext]) => ext === extension)?.[0] || (extension === "jpeg" ? "image/jpeg" : null);
    if (!mimeType) throw new Error("Unsupported image format.");
    prompt.push({ type: "image", data: Zotero.getMainWindow().btoa(binary), mimeType });
   }
   await client.call("session/prompt", { sessionId, prompt });
   return { text, sessionId, error: text ? "" : "Agent returned no answer.", capabilities: client.capabilities };
  } finally { await client.close(); }
 },
});

Object.assign(AbstractIn, {
 buildAssistantsCard(doc) {
  const card = this.card(doc, "Assistants", "Manage reading agents. Built-in Codex is ready; other agents must pass skill compatibility checks before activation.");
  const status = this.el(doc, "div", "abstractin-notice"); status.setAttribute("role", "status");
  const list = this.el(doc, "div", "abstractin-agent-list");
  const editor = this.el(doc, "div", "abstractin-agent-editor"); editor.hidden = true;
  const redraw = () => {
   list.replaceChildren();
   const registry = this.agentRegistry();
   const select = this.select(doc, Object.entries(registry).map(([id, agent]) => [id, agent.fullName]), this.readingAgent(), id => {
    try { this.selectReadingAgent(id); status.textContent = "Reading agent selected."; redraw(); }
    catch (e) { status.textContent = e.message; select.value = this.readingAgent(); }
   });
   list.append(this.row(doc, "Reading agent", select));
   for (const [id, agent] of Object.entries(registry)) {
    const details = this.el(doc, "details", "abstractin-agent"); details.dataset.backend = id;
    const summary = this.el(doc, "summary");
    const name = this.el(doc, "strong", null, agent.fullName);
    const checked = this.getAgentValidation(id);
    const label = id === "codex" ? "Built-in reading support" : checked?.source ? "Discussion & source checks passed" : checked?.discussion ? "Discussion checks passed; source access unavailable" : "Not tested";
    summary.append(name, this.el(doc, "span", "abstractin-agent-status", label));
    const badge = this.el(doc, "span", "abstractin-badge", "In use"); badge.hidden = id !== this.readingAgent(); summary.append(badge);
    const body = this.el(doc, "div", "abstractin-agent-body");
    const path = this.el(doc, "input", "abstractin-field"); path.type = "text";
    path.placeholder = "Detect “" + agent.command + "” automatically";
    path.value = this.getPref(agent.pathPref) || "";
    path.addEventListener("change", () => { try { this.assertAgentIdle(id); this.setPref(agent.pathPref, path.value.trim()); this.clearAgentValidation(id); redraw(); } catch (e) { status.textContent = e.message; } });
    const models = this.getModels(id);
    if (!agent.custom || models.length > 1) body.append(this.row(doc, "Model", this.select(doc, models.map(model => [model.id, model.label]), this.getModel(id), value => this.setPref(id + ".model", value))));
    const efforts = this.getEfforts(id);
    if (efforts.length > 1) body.append(this.row(doc, "Reasoning effort", this.select(doc, efforts.map(value => [value, this.EFFORTS[value].label]), this.getEffort(id), value => this.setPref(id + ".effort", value))));
    if (id === "codex") {
     const extra = this.el(doc, "input", "abstractin-field"); extra.type = "text"; extra.value = this.getPref("codex.models") || "";
     extra.placeholder = "Comma-separated model IDs";
     extra.addEventListener("change", () => { this.setPref("codex.models", extra.value.trim()); redraw(); });
     body.append(this.row(doc, "Extra models", extra));
    }
    body.append(this.row(doc, "Command path", path));
    if (id === "claude") body.append(this.row(doc, "Use my Claude Code settings", this.switchControl(doc, !!this.getPref("useClaudeUserSettings"), value => { this.setPref("useClaudeUserSettings", value); this.clearAgentValidation(id); redraw(); }), "Uses your local Claude settings."));
    if (checked) body.append(this.el(doc, "p", "abstractin-row-hint", "Checked agent version: " + checked.agentVersion + ". Images: " + (checked.images ? "supported" : "not supported") + ". Checks are sample-based, not a guarantee for every answer."));
    const buttons = this.el(doc, "div", "abstractin-button-row");
    const test = this.el(doc, "button", "abstractin-button", "Test & adapt skills"); test.type = "button";
    test.addEventListener("click", async () => {
     test.disabled = true; select.disabled = true;
     try { const result = await this.testAndAdaptAgent(id, message => { status.textContent = message; });
      status.textContent = result.source ? "Passed discussion and source checks. Ready to enable." : "Passed discussion checks. Source access is unavailable; use Knowledge discussion.";
     } catch (e) { status.textContent = "Check failed: " + (e.message || e); }
     finally { redraw(); }
    });
    buttons.append(test);
    if (agent.custom) {
     const edit = this.el(doc, "button", "abstractin-button", "Edit"); edit.type = "button"; edit.addEventListener("click", () => editAgent(agent));
     const remove = this.el(doc, "button", "abstractin-button", "Remove"); remove.type = "button"; remove.addEventListener("click", () => { try { this.removeAgent(id); redraw(); } catch (e) { status.textContent = e.message; } });
     buttons.append(edit, remove);
    }
    body.append(buttons); details.append(summary, body); list.append(details);
   }
  };
  const editAgent = (agent = {}) => {
   editor.replaceChildren(); editor.hidden = false;
   const input = (label, value) => { const field = this.el(doc, "input", "abstractin-field"); field.type = "text"; field.value = value || ""; editor.append(this.row(doc, label, field)); return field; };
   const name = input("Agent name", agent.name);
   const command = input("Executable", agent.command);
   const args = input("Arguments (JSON array)", JSON.stringify(agent.args || []));
   const protocol = this.select(doc, [["acp", "ACP v1"], ["abstractin-jsonl", "AbstractIn JSONL adapter"]], agent.protocol || "acp", () => {});
   editor.append(this.row(doc, "Protocol", protocol));
   const save = this.el(doc, "button", "abstractin-button", "Save agent"); save.type = "button";
   save.addEventListener("click", () => {
    try { this.saveAgent({ ...(agent.id ? { id: agent.id } : {}), name: name.value, command: command.value, args: JSON.parse(args.value), protocol: protocol.value }); editor.hidden = true; redraw(); status.textContent = "Agent saved. Test and adapt its skills before enabling it."; }
    catch (e) { status.textContent = e.message || String(e); }
   });
   const cancel = this.el(doc, "button", "abstractin-button", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", () => { editor.hidden = true; });
   const buttons = this.el(doc, "div", "abstractin-button-row"); buttons.append(save, cancel); editor.append(buttons);
  };
  const buttons = this.el(doc, "div", "abstractin-button-row abstractin-agent-add-actions");
  const add = this.el(doc, "button", "abstractin-button", "Add agent"); add.type = "button"; add.addEventListener("click", () => editAgent());
  const importButton = this.el(doc, "button", "abstractin-button", "Import adapter…"); importButton.type = "button";
  importButton.addEventListener("click", async () => {
   try {
    const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
    const picker = new FilePicker(); picker.init(doc.defaultView, "Import agent adapter", picker.modeOpen); picker.appendFilter("Agent JSON", "*.json");
    if (await picker.show() !== picker.returnOK) return;
    const config = JSON.parse(await Zotero.File.getContentsAsync(picker.file));
    // Review imported configuration in the editor; importing never launches a process.
    editAgent(this.validateAgentConfig(config));
    status.textContent = "Review the imported executable and arguments, then save and test.";
   } catch (e) { status.textContent = e.message || String(e); }
  });
  buttons.append(add, importButton); card.body.append(list, buttons, editor, status); redraw();
  return card;
 },
});

Object.assign(AbstractIn, {
 async runAgentProcess(command, args, cwd, onEvent, onSpawn, stdin, timeout, environment = null) {
  const win = Zotero.getMainWindow();
  let timer, expired = false;
  try {
   const result = await this.runProcess(command, args, cwd, onEvent, proc => {
    timer = win.setTimeout(() => { expired = true; proc.kill(); }, timeout);
    onSpawn?.(proc);
   }, stdin, environment);
   if (expired) throw new Error("Agent adapter timed out.");
   return result;
  } finally { if (timer) win.clearTimeout(timer); }
 },
});

Object.assign(AbstractIn, {
 assertAgentIdle(id) {
  if ([...this._pending.values()].some(request => request.backend === id)) throw new Error("Stop or finish this agent's current reading request before changing its configuration.");
 },
});
