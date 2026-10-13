import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

function env() {
 const e = loadPlugin(); let logins = [];
 e.plugin.deepSeekLoginManager = () => ({ findLogins: () => logins, addLoginAsync: async login => { logins.push(login); },
  modifyLogin: (old, login) => { logins[logins.indexOf(old)] = login; }, removeLogin: login => { logins = logins.filter(item => item !== login); } });
 e.window.Components = { classes: { '@mozilla.org/login-manager/loginInfo;1': { createInstance: () => ({ init: function(origin, action, realm, username, password) { Object.assign(this, { origin, realm, username, password }); } }) } }, interfaces: { nsILoginInfo: {} } };
 return e;
}
const catalog = { data: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'deepseek-v4-pro' }] };
function mockHTTP(e, { status = 200, chunks, text = JSON.stringify(catalog), event } = {}) {
 const calls = [];
 e.window.XMLHttpRequest = class {
  readyState = 0; responseText = ''; status = status; headers = {};
  open(method, url) { this.method = method; this.url = url; this.readyState = 1; }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send(body) { calls.push({ method: this.method, url: this.url, headers: this.headers, body }); queueMicrotask(() => {
   if (event) { this['on' + event](); return; }
   if (chunks) for (const chunk of chunks) { this.responseText += chunk; this.onprogress?.(); }
   else this.responseText = text;
   this.onload?.();
  }); }
  abort() { this.readyState = 0; this.onabort?.(); }
 };
 return calls;
}
const stream = 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'private reasoning' } }] }) + '\n\n' +
 'data: ' + JSON.stringify({ choices: [{ delta: { content: '你好 $x$' } }] }) + '\r\n\r\n' + 'data: [DONE]\n\n';

test('API credentials use the login manager and never enter prefs, catalog or validation keys', async () => {
 const { plugin: p, prefs } = env(); await p.saveDeepSeekKey('sk-private-test');
 assert.equal(p.deepSeekKey(), 'sk-private-test'); assert.doesNotMatch(JSON.stringify(prefs) + p.agentConfigKey('deepseek'), /sk-private/);
 const key = p.agentConfigKey('deepseek'); await p.saveDeepSeekKey('sk-replacement-test');
 assert.equal(p.deepSeekLogins().length, 1); assert.notEqual(p.agentConfigKey('deepseek'), key);
 p.removeDeepSeekKey(); assert.equal(p.deepSeekKey(), '');
 await assert.rejects(p.saveDeepSeekKey('bad\nkey'), /valid API key/);
});

test('model discovery authenticates, validates, deduplicates and preserves cache on failure', async () => {
 const e = env(); await e.plugin.saveDeepSeekKey('sk-private-test');
 const calls = mockHTTP(e, { text: JSON.stringify({ data: [...catalog.data, catalog.data[0], { id: 'bad\nmodel' }] }) });
 await e.plugin.loadDeepSeekModels(); assert.equal(calls[0].url, 'https://api.deepseek.com/models');
 assert.equal(calls[0].headers.Authorization, 'Bearer sk-private-test'); assert.equal(e.plugin.getModels('deepseek').length, 3);
 mockHTTP(e, { status: 401, text: 'secret sk-private-test' });
 await assert.rejects(e.plugin.loadDeepSeekModels(), /Invalid API key/); assert.equal(e.plugin.getModels('deepseek').length, 3);
 assert.doesNotMatch(JSON.stringify(e.prefs), /sk-private/);
});

test('SSE parsing handles split chunks and Unicode, replays history and suppresses reasoning', async () => {
 const e = env(); await e.plugin.saveDeepSeekKey('sk-private-test'); e.plugin.setPref('deepseek.model', 'deepseek-flash');
 const calls = mockHTTP(e, { chunks: [stream.slice(0, 35), stream.slice(35, 80), stream.slice(80)] });
 const progress = [];
 const result = await e.plugin.runBackend('deepseek', { question: 'Test question', history: [{ role: 'user', text: 'Previous question' }], onProgress: event => progress.push(event.text) });
 assert.equal(result.text, '你好 $x$'); assert.equal(result.session, null); assert.deepEqual(progress, ['你好 $x$']);
 const body = JSON.parse(calls[0].body); assert.equal(body.model, 'deepseek-flash'); assert.equal(body.stream, true);
 assert.match(body.messages[0].content, /Previous question/); assert.match(body.messages[0].content, /Test question/);
 assert.ok(!body.tools); assert.doesNotMatch(calls[0].body, /sk-private-test/);
});

test('API failures, timeouts, cancellation and incomplete streams produce actionable safe errors', async () => {
 for (const [status, expected] of [[401, /Invalid API key/], [402, /balance/], [429, /Rate limit/], [503, /busy/]]) {
  const e = env(); await e.plugin.saveDeepSeekKey('sk-private-test'); mockHTTP(e, { status, text: 'sk-private-test' });
  const result = await e.plugin.runDeepSeek({ model: 'deepseek-flash' }); assert.match(result.error, expected); assert.doesNotMatch(result.error, /sk-private-test/);
 }
 for (const [event, expected] of [['timeout', /timed out/], ['error', /network/], ['abort', /cancelled/]]) {
  const e = env(); await e.plugin.saveDeepSeekKey('sk-private-test'); mockHTTP(e, { event });
  assert.match((await e.plugin.runDeepSeek({ model: 'deepseek-flash' })).error, expected);
 }
 const e = env(); await e.plugin.saveDeepSeekKey('sk-private-test'); const calls = mockHTTP(e);
 assert.match((await e.plugin.runDeepSeek({ model: 'deepseek-flash', onSpawn: proc => proc.kill() })).error, /cancelled/); assert.equal(calls.length, 0);
 mockHTTP(e, { chunks: ['data: {"choices":[{"delta":{"content":"partial"}}]}\n'] });
 assert.match((await e.plugin.runDeepSeek({ model: 'deepseek-flash' })).error, /interrupted/);
 assert.match((await e.plugin.runDeepSeek({ images: [{}] })).error, /text only/);
});

test('DeepSeek exposes API capability without probing CLI and model changes invalidate checks', async () => {
 const { plugin: p } = env(); p.findBinary = () => { throw new Error('Must not search for CLI'); };
 assert.equal((await p.queryAgentCapabilities('deepseek')).files, false);
 p.setPref('agentValidation', JSON.stringify({ deepseek: { configKey: p.agentConfigKey('deepseek'), discussion: true, source: false } }));
 p.selectReadingAgent('deepseek'); assert.equal(p.readingAgent(), 'deepseek'); assert.equal(p.getPref('readingEvidenceMode'), 'context');
 p.setPref('deepseek.model', 'different'); assert.equal(p.getAgentValidation('deepseek'), null);
 assert.throws(() => p.selectReadingAgent('deepseek'), /Test this agent/);
});

async function guide(options = {}) {
 const e = env(); const root = e.document.createElement('div'); e.document.body.append(root);
 e.plugin.findBinary = () => { throw new Error('Must not find CLI'); };
 e.plugin.setPref('backend', 'codex'); e.plugin.setPref('readingAgent', 'codex');
 mockHTTP(e);
 e.plugin.testAndAdaptAgent = async id => { const result = { configKey: e.plugin.agentConfigKey(id), discussion: true, source: false }; e.plugin.setPref('agentValidation', JSON.stringify({ [id]: result })); return result; };
 e.plugin.openAgentSetup(root, 'deepseek', options);
 const button = label => [...root.querySelectorAll('button')].find(node => node.textContent === label);
 const click = async label => { assert.ok(button(label)); assert.equal(button(label).disabled, false, label); button(label).click(); await new Promise(resolve => setImmediate(resolve)); };
 return { ...e, root, button, click };
}

test('DeepSeek guide saves a masked key, fetches models, tests and enables only at the last step', async () => {
 const { plugin: p, root, click, button, window } = await guide({ reading: true });
 assert.match(root.textContent, /No local CLI/); await click('Continue');
 assert.equal(button('Continue').disabled, true);
 const input = root.querySelector('input'); assert.equal(input.type, 'password'); input.value = 'sk-private-test';
 await click('Save key & refresh models'); assert.equal(input.value, ''); assert.doesNotMatch(root.textContent, /sk-private-test/);
 const select = root.querySelector('select'); select.value = 'deepseek-flash'; select.dispatchEvent(new window.Event('change'));
 await click('Continue'); assert.match(root.textContent, /may incur API charges/); assert.equal(p.readingAgent(), 'codex');
 await click('Run connection & reading test'); await click('Continue'); assert.equal(p.readingAgent(), 'codex');
 await click('Enable DeepSeek'); assert.equal(p.readingAgent(), 'deepseek'); assert.equal(p.getPref('readingEvidenceMode'), 'context');
 assert.equal(p.getModel('deepseek'), 'deepseek-flash'); assert.equal(root.querySelector('[role="dialog"]'), null);
});

test('invalid keys block guide progression, and closing retains the current assistant', async () => {
 const { root, click, button, plugin: p, window } = await guide(); await click('Continue');
 root.querySelector('input').value = 'sk-test'; mockHTTP({ window }, { status: 401 });
 await click('Save key & refresh models'); assert.match(root.textContent, /Invalid API key/); assert.equal(button('Continue').disabled, true);
 await click('Close'); assert.equal(p.getBackend(), 'codex');
});

test('settings expose API setup with no command path and changed credentials prevent final activation', async () => {
 const { plugin: p, document } = env(); const card = p.buildAssistantsCard(document);
 assert.ok(card.querySelector('[data-backend="deepseek"]')); assert.doesNotMatch(card.querySelector('[data-backend="deepseek"]').textContent, /Command path/);
 const e = await guide(); await e.click('Continue'); e.root.querySelector('input').value = 'sk-test'; await e.click('Save key & refresh models');
 await e.click('Continue'); await e.click('Run connection & reading test'); await e.click('Continue');
 await e.plugin.saveDeepSeekKey('sk-replaced'); await e.click('Enable DeepSeek');
 assert.match(e.root.textContent, /Configuration changed/); assert.equal(e.plugin.getBackend(), 'codex');
});

test('the real compatibility pipeline routes through DeepSeek API and verifies supplied-text records without local file tools', async () => {
 const { plugin: p, window, prefs } = env(); await p.saveDeepSeekKey('sk-private-test'); p.setPref('deepseek.model', 'deepseek-flash');
 p.getDataDir = () => '/tmp/fixture';
 p.agentSkillSnapshot = async () => ({ fingerprint: 'original-skills', files: [{ name: 'SKILL.md', type: 'paper', content: 'Original skill: check evidence.' }] });
 window.Zotero.File = { createDirectoryIfMissingAsync: async () => {}, putContentsAsync: async () => {} };
 const calls = [];
 p.deepSeekRequest = async (path, body, opts) => {
  calls.push(body); const prompt = body.messages[0].content;
  let text;
  if (prompt.includes('Prepare a tool mapping')) {
   assert.match(prompt, /Available tools \(list no others\): \[\]/); text = '{"mappings":[],"unsupported":[]}';
  } else {
   const nonce = prompt.match(/passage-[a-z0-9]+/)[0];
   text = '<abstractin-agent-check>' + JSON.stringify({ code: nonce, pageIndex: 4, printedPageLabel: 'vii', missingTheorem: null }) + '</abstractin-agent-check>\n' +
    '<abstractin-record>{"title":"Check","summary":"Supplied passage checked.","openQuestions":[],"scope":{"level":"paper","id":"","title":""},"topicKey":"agent-check","sources":[]}</abstractin-record>';
  }
  opts.onChunk('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n'); return '';
 };
 const result = await p.testAndAdaptAgent('deepseek');
 assert.equal(result.discussion, true); assert.equal(result.source, false); assert.equal(calls.length, 2);
 assert.ok(calls.every(body => body.model === 'deepseek-flash')); assert.doesNotMatch(JSON.stringify(prefs), /sk-private-test/);
 await p.assertAgentReadingReady('deepseek', 'knowledge');
 assert.match(await p.agentReadingContext('deepseek', { reading: { type: 'paper' } }), /Original skill: check evidence/);
 await assert.rejects(p.assertAgentReadingReady('deepseek', 'source'), /Context only/);
});
