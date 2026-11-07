import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

function env() {
 const e = loadPlugin(); let logins = [];
 e.plugin.deepSeekLoginManager = () => ({ findLogins: (origin, _, realm) => logins.filter(login => login.origin === origin && login.realm === realm),
  addLoginAsync: async login => { logins.push(login); }, modifyLogin: (old, login) => { logins[logins.indexOf(old)] = login; } });
 e.window.Components = { classes: { '@mozilla.org/login-manager/loginInfo;1': { createInstance: () => ({ init(origin, _, realm, username, password) { Object.assign(this, { origin, realm, username, password }); } }) } }, interfaces: { nsILoginInfo: {} } };
 return e;
}
const input = { id: 'api-school', name: 'School model', baseURL: 'https://example.edu/v1', model: 'vision-model', imageModels: ['vision-model'] };
function mockHTTP(e, { chunks, response, status = 200, event } = {}) {
 const calls = [];
 e.window.XMLHttpRequest = class {
  responseText = ''; status = status; headers = {};
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send(body) { calls.push({ method: this.method, url: this.url, headers: this.headers, body: body && JSON.parse(body) }); queueMicrotask(() => {
   if (event) { this['on' + event](); return; }
   if (chunks) for (const chunk of chunks) { this.responseText += chunk; this.onprogress?.(); }
   else this.responseText = JSON.stringify(response);
   this.onload?.();
  }); }
  abort() { this.onabort?.(); }
 };
 return calls;
}
const sse = value => 'data: ' + JSON.stringify(value) + '\r\n\r\n';

test('API providers preserve built-ins, isolate credentials and invalidate changed configuration', async () => {
 const e = env(), p = e.plugin;
 const keys = ['codex', 'claude', 'agy', 'deepseek'].map(id => p.agentConfigKey(id));
 await p.saveDeepSeekKey('old-deepseek-key');
 await p.saveAPIProvider(input, { key: 'school-key', headers: { 'x-school-secret': 'private-header' } });
 await p.saveAPIProvider({ ...input, id: 'api-other', name: 'Other' }, { key: 'other-key' });
 assert.equal(p.apiProviderCredentials('api-school').key, 'school-key'); assert.equal(p.apiProviderCredentials('api-other').key, 'other-key'); assert.equal(p.deepSeekKey(), 'old-deepseek-key');
 assert.doesNotMatch(JSON.stringify(e.prefs) + p.agentConfigKey('api-school'), /school-key|private-header|other-key|old-deepseek-key/);
 assert.deepEqual(['codex', 'claude', 'agy'].map(id => p.agentConfigKey(id)), keys.slice(0, 3));
 assert.ok(p.agentRegistry().gemini); assert.equal(p.agentRegistry()['api-school'].images, true);
 p.setPref('agentValidation', JSON.stringify({ 'api-school': { configKey: p.agentConfigKey('api-school'), discussion: true, source: false } }));
 p.selectReadingAgent('api-school'); assert.equal(p.agentCanReadSources(), true);
 p.setPref('api-school.model', 'text-model'); assert.equal(p.getAgentValidation('api-school'), null); assert.equal(p.agentRegistry()['api-school'].images, false);
});

test('OpenAI-compatible API streams split SSE, passes actual page images and omits reasoning', async () => {
 const e = env(), p = e.plugin; await p.saveAPIProvider(input, { key: 'school-key' });
 e.window.OS = { File: { read: async () => new Uint8Array([1, 2, 3, 4]) } };
 const stream = sse({ choices: [{ delta: { reasoning_content: 'private thought' } }] }) + sse({ choices: [{ delta: { content: '图中结果' } }] }) + sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
 const calls = mockHTTP(e, { chunks: [stream.slice(0, 13), stream.slice(13, 97), stream.slice(97)] });
 const progress = [];
 const result = await p.runBackend('api-school', { question: 'Explain figure', history: [{ role: 'user', text: 'Earlier question' }], images: ['/page.png'], onProgress: value => progress.push(value.text) });
 assert.equal(result.text, '图中结果'); assert.deepEqual(progress, ['图中结果']);
 assert.equal(calls[0].url, 'https://example.edu/v1/chat/completions'); assert.equal(calls[0].headers.Authorization, 'Bearer school-key');
 assert.equal(calls[0].body.messages[1].content[1].image_url.url, 'data:image/png;base64,AQIDBA==');
 assert.match(calls[0].body.messages[1].content[0].text, /Earlier question/); assert.ok(!calls[0].body.tools);
});

test('SAIA preset discovers models by POST, permits manual IDs and preserves catalog on errors', async () => {
 const e = env(), p = e.plugin;
 await p.saveAPIProvider({ ...p.API_PRESETS.saia, id: 'api-school' }, { key: 'school-key' });
 const calls = mockHTTP(e, { response: { data: [{ id: 'one' }, { id: 'one' }, { id: 'bad\nmodel' }] } });
 await p.loadAPIProviderModels('api-school'); assert.equal(calls[0].method, 'POST'); assert.match(calls[0].url, /academiccloud.de\/v1\/models$/);
 assert.equal(p.getModels('api-school').filter(model => model.id === 'one').length, 1);
 mockHTTP(e, { status: 401, response: { error: 'school-key' } });
 await assert.rejects(p.loadAPIProviderModels('api-school'), /Invalid API key/); assert.ok(p.getModels('api-school').some(model => model.id === 'one'));
});

test('Anthropic and Gemini API protocols use native image blocks and hide reasoning', async () => {
 for (const protocol of ['anthropic', 'gemini']) {
  const e = env(), p = e.plugin; await p.saveAPIProvider({ ...input, protocol, auth: 'header', authHeader: 'x-provider-key' }, { key: 'school-key' });
  e.window.OS = { File: { read: async () => new Uint8Array([1]) } };
  const chunks = protocol === 'anthropic' ? [sse({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } }), sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }), sse({ type: 'message_stop' })] : [sse({ candidates: [{ content: { parts: [{ text: 'private', thought: true }, { text: 'Answer' }] }, finishReason: 'STOP' }] })];
  const calls = mockHTTP(e, { chunks }); const result = await p.runBackend('api-school', { question: 'Read', images: ['/page.png'] });
  assert.equal(result.text, 'Answer'); assert.equal(calls[0].headers['x-provider-key'], 'school-key');
  if (protocol === 'anthropic') assert.equal(calls[0].body.messages[0].content[1].source.data, 'AQ==');
  else assert.equal(calls[0].body.contents[0].parts[1].inline_data.data, 'AQ==');
 }
});

test('custom JSON maps typed request placeholders and a nested response without executing code', async () => {
 const e = env(), p = e.plugin;
 await p.saveAPIProvider({ ...input, protocol: 'custom-json', template: { deployment: '{{model}}', input: { text: '{{prompt}}', instructions: '{{system}}' } }, responsePath: 'output.0.text', auth: 'none' });
 const calls = mockHTTP(e, { response: { output: [{ text: 'Custom answer' }] } });
 const result = await p.runBackend('api-school', { question: 'Test $(literal)' });
 assert.equal(result.text, 'Custom answer'); assert.equal(calls[0].body.deployment, 'vision-model'); assert.match(calls[0].body.input.text, /Test \$\(literal\)/); assert.ok(!calls[0].headers.Authorization);
 assert.equal(p.apiJSONPath({}, '__proto__.secret'), undefined);
});

test('API cancellation, invalid auth, incomplete streams and output limits stay explicit', async () => {
 const e = env(), p = e.plugin; await p.saveAPIProvider(input, { key: 'school-key' });
 const calls = mockHTTP(e); assert.match((await p.runBackend('api-school', { onSpawn: proc => proc.kill() })).error, /cancelled/); assert.equal(calls.length, 0);
 mockHTTP(e, { chunks: [sse({ choices: [{ delta: { content: 'partial' } }] })] }); assert.match((await p.runBackend('api-school', {})).error, /interrupted/);
 mockHTTP(e, { chunks: [sse({ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] })] }); assert.match((await p.runBackend('api-school', {})).error, /length/);
 mockHTTP(e, { status: 401, response: { error: 'school-key' } }); const result = await p.runBackend('api-school', {}); assert.match(result.error, /Invalid API key/); assert.doesNotMatch(result.error, /school-key/);
 assert.throws(() => p.validateAPIProvider({ ...input, baseURL: 'https://secret@example.edu' }), /without credentials/);
 assert.throws(() => p.validateAPIProvider({ ...input, chatPath: '//another.edu/' }), /relative/);
});

test('two settings entries open API presets without changing the selected legacy agent', async () => {
 const e = env(), p = e.plugin; p.setPref('readingAgent', 'claude');
 const card = p.buildAssistantsCard(e.document); e.document.body.append(card);
 const find = text => [...card.querySelectorAll('button')].find(button => button.textContent === text);
 assert.ok(find('Add agent (CLI)')); find('Add API').click();
 assert.equal(p.readingAgent(), 'claude'); assert.equal(card.querySelector('input[aria-label="API key"]').type, 'password');
 const preset = [...card.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'saia'));
 preset.value = 'saia'; preset.dispatchEvent(new e.window.Event('change'));
 assert.equal(card.querySelector('input[aria-label="Base URL"]').value, 'https://chat-ai.academiccloud.de/v1');
 card.querySelector('input[aria-label="API key"]').value = 'school-key'; find('Save API').click(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(p.readingAgent(), 'claude'); assert.equal((p.getJSONPref('apiProviders', []) || []).length, 1);
 assert.equal(card.querySelector('input[aria-label="API key"]').value, ''); assert.equal(find('Enable API').disabled, true);
});

test('API setup tests the saved model, enables only on request, and blocks edited fields', async () => {
 const e = env(), p = e.plugin; p.setPref('readingAgent', 'codex');
 const root = e.document.createElement('div'); e.document.body.append(root);
 p.openAPIProviderSetup(root, null, { reading: true });
 const field = label => root.querySelector('[aria-label="' + label + '"]');
 field('API name').value = 'School'; field('Base URL').value = 'https://example.edu/v1'; field('Model ID').value = 'manual-model'; field('API key').value = 'school-key';
 let tested = '';
 p.testAndAdaptAgent = async id => { tested = p.getModel(id); const result = { configKey: p.agentConfigKey(id), discussion: true, source: false, inlineSource: true }; p.setPref('agentValidation', JSON.stringify({ [id]: result })); return result; };
 const button = text => [...root.querySelectorAll('button')].find(node => node.textContent === text);
 button('Test connection & reading').click(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(tested, 'manual-model'); assert.equal(p.readingAgent(), 'codex'); assert.equal(button('Enable API').disabled, false);
 field('Model ID').value = 'another-model'; field('Model ID').dispatchEvent(new e.window.Event('input')); assert.equal(button('Enable API').disabled, true);
 button('Test connection & reading').click(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(tested, 'another-model'); button('Enable API').click(); assert.match(p.readingAgent(), /^api-/); assert.equal(p.agentCanReadSources(), true);
});

test('saving SAIA discovers its real models, shows a picker and retains it when reopening setup', async () => {
 const e = env(), p = e.plugin; p.setPref('readingAgent', 'codex');
 const root = e.document.createElement('div'); e.document.body.append(root); p.openAPIProviderSetup(root, null, { reading: true });
 const preset = [...root.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'saia'));
 preset.value = 'saia'; preset.dispatchEvent(new e.window.Event('change'));
 const field = label => root.querySelector('[aria-label="' + label + '"]');
 field('API key').value = 'school-key';
 const calls = mockHTTP(e, { response: { data: [{ id: 'school-reader-new', name: 'School Reader' }, { id: 'school-fast-new' }] } });
 const button = text => [...root.querySelectorAll('button')].find(node => node.textContent === text);
 button('Save API').click(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST'); assert.match(calls[0].url, /academiccloud.de\/v1\/models$/);
 assert.ok(field('Available models'), root.textContent); assert.equal(field('Available models').options.length, 3);
 assert.equal(field('Model ID').value, ''); assert.match(root.textContent, /Found 2 models/);
 field('Available models').value = 'school-reader-new'; field('Available models').dispatchEvent(new e.window.Event('change'));
 assert.equal(field('Model ID').value, 'school-reader-new');
 p.testAndAdaptAgent = async id => { assert.equal(p.getModel(id), 'school-reader-new'); const result = { configKey: p.agentConfigKey(id), discussion: true }; p.setPref('agentValidation', JSON.stringify({ [id]: result })); return result; };
 button('Test connection & reading').click(); await new Promise(resolve => setImmediate(resolve));
 assert.equal(p.readingAgent(), 'codex'); assert.equal(button('Enable API').disabled, false);
 const config = p.getJSONPref('apiProviders', [])[0]; p.openAPIProviderSetup(root, config.id, { reading: true });
 assert.equal(field('Available models').value, 'school-reader-new'); assert.equal(calls.length, 1);
});

test('model discovery failure keeps a usable manual-ID configuration and does not enable it', async () => {
 const e = env(), p = e.plugin; await p.saveAPIProvider(input, { key: 'school-key' }); p.setPref('readingAgent', 'codex');
 const root = e.document.createElement('div'); e.document.body.append(root); p.openAPIProviderSetup(root, input.id, { reading: true });
 mockHTTP(e, { status: 401, response: { error: 'school-key' } });
 const button = [...root.querySelectorAll('button')].find(node => node.textContent === 'Save API'); button.click(); await new Promise(resolve => setImmediate(resolve));
 assert.match(root.textContent, /model list could not be loaded/); assert.doesNotMatch(root.textContent, /school-key/);
 assert.equal(root.querySelector('[aria-label="Model ID"]').value, 'vision-model'); assert.equal(p.readingAgent(), 'codex');
 assert.equal(p.apiProviderConfig(input.id).model, 'vision-model');
});
