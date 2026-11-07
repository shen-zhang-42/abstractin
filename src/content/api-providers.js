/* Configurable API providers. Secrets stay in Zotero's login manager. */
"use strict";
(() => {
 const previousKey = AbstractIn.agentConfigKey, previousModels = AbstractIn.getModels;
 const paths = { "openai-chat": "/chat/completions", anthropic: "/messages", gemini: "/models/{model}:streamGenerateContent?alt=sse", "custom-json": "/chat" };
 Object.assign(AbstractIn, {
  API_PRESETS: {
   custom: { name: "Custom API", protocol: "openai-chat", baseURL: "", model: "" },
   saia: { name: "GWDG SAIA", protocol: "openai-chat", baseURL: "https://chat-ai.academiccloud.de/v1", model: "qwen3.6-35b-a3b", modelsMethod: "POST", imageModels: ["qwen3.5-397b-a17b", "qwen3.6-35b-a3b"] },
   deepseek: { name: "DeepSeek API", protocol: "openai-chat", baseURL: "https://api.deepseek.com", model: "" },
   anthropic: { name: "Anthropic-compatible API", protocol: "anthropic", baseURL: "https://api.anthropic.com/v1", model: "", auth: "header", authHeader: "x-api-key" },
   gemini: { name: "Gemini API", protocol: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta", model: "", auth: "header", authHeader: "x-goog-api-key" },
  },
  validateAPIProvider(input) {
   if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Enter an API configuration.");
   const id = input.id || "api-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), name = String(input.name || "").trim();
   if (!/^api-[a-z0-9-]{1,60}$/.test(id)) throw new Error("API IDs must start with api-.");
   if (!name || name.length > 100) throw new Error("Enter an API name (up to 100 characters).");
   let url; try { url = new URL(input.baseURL); } catch (_) { throw new Error("Enter a valid API base URL."); }
   if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use an HTTP(S) base URL without credentials, query parameters or fragments.");
   const protocol = input.protocol || "openai-chat";
   if (!Object.hasOwn(paths, protocol)) throw new Error("Choose a supported API protocol or Custom JSON.");
   const endpoint = (value, fallback) => {
    const path = String(value ?? fallback);
    if (path && (!path.startsWith("/") || path.startsWith("//") || /[\r\n\0#\\]/.test(path) || /(?:^|\/)\.\.(?:\/|$)/.test(path))) throw new Error("API paths must be relative to the configured service.");
    return path;
   };
   const model = String(input.model || "").trim(), auth = input.auth || "bearer", authHeader = String(input.authHeader || "x-api-key");
   if (model.length > 200 || /[\r\n\0]/.test(model)) throw new Error("Enter a valid model ID.");
   if (!["bearer", "header", "none"].includes(auth) || !/^[A-Za-z0-9-]{1,100}$/.test(authHeader)) throw new Error("Invalid API authentication configuration.");
   const maxTokens = Number(input.maxTokens ?? 8192), timeout = Number(input.timeout ?? 180000);
   if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1000000 || !Number.isInteger(timeout) || timeout < 1000 || timeout > 1800000) throw new Error("Enter valid output-token and timeout limits.");
   if (input.imageModels !== undefined && !Array.isArray(input.imageModels)) throw new Error("Image-capable models must be an array.");
   const imageModels = [...new Set((input.imageModels || []).map(String))];
   if (imageModels.some(value => !value || value.length > 200 || /[\r\n\0]/.test(value))) throw new Error("Invalid image-capable model IDs.");
   const parameters = input.parameters || {}, template = input.template || { model: "{{model}}", messages: "{{messages}}" };
   for (const value of [parameters, template]) if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 20000) throw new Error("Extra parameters and custom templates must be JSON objects.");
   if (["model", "messages", "contents", "system", "system_instruction", "stream", "tools", "tool_choice"].some(key => Object.hasOwn(parameters, key))) throw new Error("Extra parameters cannot override model, messages, streaming or tools.");
   const responsePath = String(input.responsePath || "response");
   if (!/^[A-Za-z0-9_.]{1,200}$/.test(responsePath)) throw new Error("Use a dot-separated JSON response path.");
   return { id, name, baseURL: url.href.replace(/\/$/, ""), protocol, model, auth, authHeader,
    chatPath: endpoint(input.chatPath, paths[protocol]), modelsPath: endpoint(input.modelsPath, "/models"), modelsMethod: input.modelsMethod === "POST" ? "POST" : "GET",
    stream: protocol !== "custom-json" && input.stream !== false, maxTokens, timeout, imageModels, parameters, template, responsePath, version: 1 };
  },
  apiProviderConfig(id) { return (this.getJSONPref("apiProviders", []) || []).find(config => config.id === id) || null; },
  apiProviderRegistry() {
   const registry = {};
   for (const value of this.getJSONPref("apiProviders", []) || []) {
    try {
     const config = this.validateAPIProvider(value), model = this.getPref(config.id + ".model") || config.model;
     registry[config.id] = { label: config.name, fullName: config.name, api: true, images: config.imageModels.includes(model), models: [{ id: model, label: model || "Default" }], efforts: [""] };
     this.BACKEND_ICONS[config.id] = "sparkle";
    } catch (error) { this.logError("API configuration", error); }
   }
   return registry;
  },
  apiProviderLogins(id) { return this.deepSeekLoginManager().findLogins("chrome://abstractin", null, "AbstractIn API " + id); },
  apiProviderCredentials(id) { const password = this.apiProviderLogins(id)[0]?.password; return password ? JSON.parse(password) : { key: "", headers: {} }; },
  async saveAPIProvider(input, credentials = {}) {
   const config = this.validateAPIProvider(input); this.assertAgentIdle(config.id);
   const saved = this.getJSONPref("apiProviders", []) || [], existing = saved.find(value => value.id === config.id);
   const old = existing ? this.apiProviderCredentials(config.id) : { key: "", headers: {} };
   const key = credentials.key === undefined ? old.key : String(credentials.key).trim(), headers = credentials.headers === undefined ? old.headers : credentials.headers;
   if ((config.auth !== "none" && !key) || /[\r\n\0]/.test(key) || key.length > 8192) throw new Error("Enter a valid API key or choose no authentication.");
   if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.entries(headers).some(([name, value]) => !/^[A-Za-z0-9-]{1,100}$/.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value) || ["host", "content-length", "content-type", "authorization", config.authHeader.toLowerCase()].includes(name.toLowerCase()))) throw new Error("Extra headers must contain header names and string values; configure authentication separately.");
   const manager = this.deepSeekLoginManager(), logins = this.apiProviderLogins(config.id);
   const login = Components.classes["@mozilla.org/login-manager/loginInfo;1"].createInstance(Components.interfaces.nsILoginInfo);
   login.init("chrome://abstractin", null, "AbstractIn API " + config.id, "credentials", JSON.stringify({ key, headers }), "", "");
   if (logins.length) manager.modifyLogin(logins[0], login); else await manager.addLoginAsync(login);
   this.setPref("apiProviders", JSON.stringify([...saved.filter(value => value.id !== config.id), config]));
   this.setPref(config.id + ".credentialsRevision", Date.now() + "-" + Math.random().toString(36).slice(2));
   this.setPref(config.id + ".model", config.model); this.clearAgentValidation(config.id); this.agentRegistry(); return config;
  },
  agentConfigKey(id) {
   const config = this.apiProviderConfig(id);
   return config ? JSON.stringify(["api-provider-v1", config, this.getPref(id + ".model") || "", this.getPref(id + ".credentialsRevision") || ""]) : previousKey.call(this, id);
  },
  getModels(id) {
   const config = this.apiProviderConfig(id); if (!config) return previousModels.call(this, id);
   const model = this.getPref(id + ".model") || config.model, catalog = this.getJSONPref(id + ".models", []) || [];
   const list = [{ id: "", label: "Default", desc: config.model || "Choose a model" }, ...catalog];
   if (model && !list.some(item => item.id === model)) list.push({ id: model, label: model }); return list;
  },
  apiProviderCapabilities(id) {
   const config = this.apiProviderConfig(id), model = this.getModel(id) || config?.model;
   return { files: false, inlineSource: true, images: !!config?.imageModels.includes(model), version: id === "deepseek" ? "DeepSeek API" : config.protocol + " API v1", models: this.getModels(id).filter(item => item.id), efforts: [] };
  },
  apiEndpoint(config, path, model = "") {
   const url = new URL(config.baseURL + path.replace(/\{model\}/g, encodeURIComponent(model.replace(/^models\//, ""))));
   if (url.origin !== new URL(config.baseURL).origin) throw new Error("API endpoint must stay on the configured service."); return url.href;
  },
  apiProviderRequest(id, url, body, { method = body === null ? "GET" : "POST", onChunk, onSpawn, timeout } = {}) {
   const config = this.apiProviderConfig(id), credentials = this.apiProviderCredentials(id);
   if (!config || new URL(url).origin !== new URL(config.baseURL).origin) throw new Error("Unknown API service or endpoint.");
   if (config.auth !== "none" && !credentials.key) throw new Error("API key is missing. Open Guided setup.");
   return new Promise((resolve, reject) => {
    const xhr = new (Zotero.getMainWindow().XMLHttpRequest)(); xhr.open(method, url, true); xhr.timeout = timeout || config.timeout;
    xhr.setRequestHeader("Content-Type", "application/json");
    if (config.auth === "bearer") xhr.setRequestHeader("Authorization", "Bearer " + credentials.key);
    if (config.auth === "header") xhr.setRequestHeader(config.authHeader, credentials.key);
    if (config.protocol === "anthropic") xhr.setRequestHeader("anthropic-version", "2023-06-01");
    for (const [name, value] of Object.entries(credentials.headers)) xhr.setRequestHeader(name, value);
    let offset = 0, aborted = false;
    const chunk = () => { if (onChunk && xhr.status >= 200 && xhr.status < 300) { const value = xhr.responseText.slice(offset); offset = xhr.responseText.length; if (value) onChunk(value); } };
    xhr.onprogress = () => { try { chunk(); } catch (error) { reject(error); xhr.abort(); } };
    xhr.onload = () => {
     if (xhr.responseURL && new URL(xhr.responseURL).origin !== new URL(config.baseURL).origin) { reject(new Error("API response came from a different service. Configure the final service URL directly.")); return; }
     if (xhr.status < 200 || xhr.status >= 300) { const hints = { 400: "Invalid request or unsupported model/parameters.", 401: "Invalid API key.", 403: "API access denied.", 404: "Endpoint or model not found.", 429: "Rate limit reached; try again later." }; reject(new Error("API HTTP " + xhr.status + ": " + (hints[xhr.status] || "Service request failed."))); return; }
     try { chunk(); resolve(xhr.responseText); } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new Error("Cannot connect to the API. Check its address and network.")); xhr.ontimeout = () => reject(new Error("API request timed out.")); xhr.onabort = () => reject(new Error("API request cancelled."));
    onSpawn?.({ kill: () => { aborted = true; xhr.abort(); reject(new Error("API request cancelled.")); } });
    if (!aborted) xhr.send(body === null ? null : JSON.stringify(body));
   });
  },
  async loadAPIProviderModels(id) {
   const config = this.apiProviderConfig(id), key = this.agentConfigKey(id);
   if (!config?.modelsPath) throw new Error("No model-list endpoint configured. Enter a model ID manually.");
   const response = JSON.parse(await this.apiProviderRequest(id, this.apiEndpoint(config, config.modelsPath), config.modelsMethod === "POST" ? {} : null, { method: config.modelsMethod, timeout: 30000 }));
   const values = response.data || response.models || response;
   if (!Array.isArray(values)) throw new Error("Model list was not recognized. Enter a model ID manually.");
   const seen = new Set(), models = [];
   for (const value of values) {
    const model = typeof value === "string" ? value : value?.id || value?.name?.replace(/^models\//, "");
    if (typeof model !== "string" || !/^[A-Za-z0-9._:/-]{1,200}$/.test(model) || seen.has(model)) continue;
    seen.add(model); models.push({ id: model, label: value.displayName || value.id && value.name || model });
   }
   if (!models.length) throw new Error("No models returned. Enter a model ID manually.");
   if (this.agentConfigKey(id) !== key) throw new Error("API configuration changed. Refresh again.");
   this.setPref(id + ".models", JSON.stringify(models)); return models;
  },
  async apiImageContent(paths) {
   const result = [];
   for (const path of paths || []) {
    const bytes = await OS.File.read(path); let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const extension = path.split(".").pop().toLowerCase(), mime = Object.entries(this.IMAGE_TYPES).find(([, ext]) => ext === extension)?.[0] || (extension === "jpeg" ? "image/jpeg" : null);
    if (!mime) throw new Error("Unsupported image format."); result.push({ mime, data: Zotero.getMainWindow().btoa(binary) });
   }
   return result;
  },
  apiJSONPath(value, path) { return path.split(".").reduce((current, key) => ["__proto__", "constructor", "prototype"].includes(key) ? undefined : current?.[key], value); },
  apiJSONTemplate(value, variables) {
   if (typeof value === "string") { const exact = value.match(/^\{\{(model|prompt|messages|system)\}\}$/); return exact ? variables[exact[1]] : value.replace(/\{\{(model|prompt|system)\}\}/g, (_, key) => variables[key]); }
   if (Array.isArray(value)) return value.map(item => this.apiJSONTemplate(item, variables));
   if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.apiJSONTemplate(item, variables)])); return value;
  },
  async runAPIProvider(id, request) {
   try {
    const config = this.apiProviderConfig(id); if (!config) throw new Error("Unknown API configuration.");
    const model = request.model || this.getModel(id) || config.model || this.getModels(id).find(item => item.id)?.id;
    if (!model) throw new Error("Enter a model ID or refresh the API model list.");
    if (request.images?.length && (!config.imageModels.includes(model) || config.protocol === "custom-json")) throw new Error("Image input is not configured for this model.");
    const prompt = this.transcriptFor(request.history || [], null) + (request.question || "") + this.formattingReminder(request.ctx?.reading?.vocabularyTutor ? "English" : this.getLanguage());
    const system = this.systemPrompt(request.ctx), images = await this.apiImageContent(request.images);
    const content = images.length ? [{ type: "text", text: prompt }, ...images.map(image => ({ type: "image_url", image_url: { url: "data:" + image.mime + ";base64," + image.data } }))] : prompt;
    const messages = [{ role: "system", content: system }, { role: "user", content }];
    let body, path = config.chatPath;
    if (config.protocol === "openai-chat") body = { ...config.parameters, model, messages, stream: config.stream, ...(!Object.hasOwn(config.parameters, "max_completion_tokens") ? { max_tokens: config.maxTokens } : {}) };
    if (config.protocol === "anthropic") body = { ...config.parameters, model, system, stream: config.stream, max_tokens: config.maxTokens, messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map(image => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } }))] }] };
    if (config.protocol === "gemini") { if (!config.stream) path = path.replace(":streamGenerateContent?alt=sse", ":generateContent"); body = { ...config.parameters, system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }, ...images.map(image => ({ inline_data: { mime_type: image.mime, data: image.data } }))] }], generationConfig: { ...config.parameters.generationConfig, maxOutputTokens: config.maxTokens } }; }
    if (config.protocol === "custom-json") body = { ...this.apiJSONTemplate(config.template, { model, prompt, messages, system }), ...config.parameters };
    let text = "", buffer = "", dataLines = [], finished = false;
    const append = part => { if (typeof part === "string" && part) { text += part; request.onProgress?.({ text, status: "writing" }); } };
    const failReason = reason => { if (["length", "max_tokens", "MAX_TOKENS", "content_filter", "SAFETY", "RECITATION", "tool_calls", "tool_use"].includes(reason)) throw new Error("API stopped before a complete answer (" + reason + "). Check the output limit and model capabilities."); };
    const event = data => {
     if (data === "[DONE]") { finished = true; return; } const value = JSON.parse(data);
     if (value.error || value.type === "error") throw new Error("The API reported a model error.");
     if (config.protocol === "openai-chat") { const choice = value.choices?.[0]; failReason(choice?.finish_reason); append(choice?.delta?.content); if (choice?.finish_reason) finished = true; }
     if (config.protocol === "anthropic") { failReason(value.delta?.stop_reason); if (value.delta?.type === "text_delta") append(value.delta.text); if (value.type === "message_stop") finished = true; }
     if (config.protocol === "gemini") { const candidate = value.candidates?.[0]; failReason(candidate?.finishReason); for (const part of candidate?.content?.parts || []) if (!part.thought) append(part.text); if (candidate?.finishReason) finished = true; }
    };
    const line = value => { if (!value) { if (dataLines.length) { event(dataLines.join("\n")); dataLines = []; } } else if (value.startsWith("data:")) dataLines.push(value.slice(5).trimStart()); };
    const response = await this.apiProviderRequest(id, this.apiEndpoint(config, path, model), body, { onSpawn: request.onSpawn,
     ...(config.stream ? { onChunk: chunk => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop(); for (const value of lines) line(value.replace(/\r$/, "")); } } : {}) });
    if (config.stream) { if (buffer) line(buffer.replace(/\r$/, "")); line(""); if (!finished) throw new Error("API response was interrupted. Try again."); }
    else {
     const value = JSON.parse(response); if (value.error) throw new Error("The API reported a model error.");
     if (config.protocol === "openai-chat") { failReason(value.choices?.[0]?.finish_reason); append(value.choices?.[0]?.message?.content); }
     if (config.protocol === "anthropic") { failReason(value.stop_reason); for (const part of value.content || []) if (part.type === "text") append(part.text); }
     if (config.protocol === "gemini") { failReason(value.candidates?.[0]?.finishReason); for (const part of value.candidates?.[0]?.content?.parts || []) if (!part.thought) append(part.text); }
     if (config.protocol === "custom-json") append(this.apiJSONPath(value, config.responsePath));
    }
    if (!text.trim()) throw new Error("API returned no answer. Check the model and response format."); return { text, session: null, usage: null };
   } catch (error) { return { text: "", error: error.message || String(error) }; }
  },
 });
})();
