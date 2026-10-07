import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { loadPlugin } from './load-plugin.mjs';

async function environment() {
 const env = loadPlugin();
 const { plugin: p, window } = env;
 const dir = await mkdtemp(join(tmpdir(), 'abstractin-agents-'));
 p.getDataDir = () => dir;
 p.buildChildEnvironment = () => ({});
 p.hashAgentText = async text => createHash('sha256').update(text).digest('hex');
 window.OS = { Path: { join, normalize }, File: {
  stat: async path => ({ isSymLink: (await lstat(path)).isSymbolicLink() }),
  DirectoryIterator: class {
   constructor(path) { this.path = path; }
   async forEach(callback) { for (const entry of await readdir(this.path, { withFileTypes: true })) callback({ path: join(this.path, entry.name), name: entry.name, isDir: entry.isDirectory(), isSymLink: entry.isSymbolicLink() }); }
   close() {}
  },
 } };
 window.Zotero.File = { getContentsAsync: path => readFile(path, 'utf8'), putContentsAsync: (path, text) => writeFile(path, text), createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }) };
 for (const type of ['book', 'paper', 'extraction']) {
  const root = join(dir, 'original-' + type); await mkdir(root); await writeFile(join(root, 'SKILL.md'), 'Original ' + type + ' skill: verify evidence.');
 }
 p.findReadingSkill = async type => ({ path: join(dir, 'original-' + type, 'SKILL.md') });
 return { ...env, dir };
}
const config = { id: 'custom-demo', name: 'Demo agent', command: 'demo-agent', protocol: 'abstractin-jsonl', args: ['--stdio'] };

test('custom agent persistence, restricted adapters and selection gating', async () => {
 const { plugin: p, prefs } = await environment();
 p.saveAgent(config);
 assert.equal(p.agentRegistry()['custom-demo'].name, 'Demo agent');
 assert.throws(() => p.selectReadingAgent('custom-demo'), /Test this agent/);
 assert.throws(() => p.saveAgent({ ...config, id: 'codex' }), /Custom agent IDs/);
 assert.throws(() => p.saveAgent({ ...config, args: 'run shell code' }), /JSON array/);
 assert.throws(() => p.saveAgent({ ...config, protocol: 'javascript' }), /Supported adapters/);
 assert.equal(JSON.parse(prefs['extensions.abstractin.agents']).length, 1);
 p.removeAgent('custom-demo');
 assert.equal(p.agentRegistry()['custom-demo'], undefined);
 assert.throws(() => p.removeAgent('codex'), /Built-in/);
});

test('adaptation keeps original skills intact, verifies source access and invalidates changed dependencies', async () => {
 const { plugin: p, dir } = await environment();
 p.saveAgent(config);
 p.queryAgentCapabilities = async () => ({ version: '1.0', files: true, images: false });
 p.runBackend = async (id, request) => {
  if (request.question.includes('Prepare a tool mapping')) return { text: '{"mappings":[{"operation":"read_source","tool":"adapter-file-read"}],"unsupported":[]}' };
  if (request.question.includes('Compatibility test')) {
   const nonce = request.question.match(/passage-[a-z0-9]+/)[0];
   return { text: nonce + ' PDF index 4; printed label vii. Theorem 99 is unavailable.\n<abstractin-agent-check>' + JSON.stringify({ code: nonce, pageIndex: 4, printedPageLabel: 'vii', missingTheorem: null }) + '</abstractin-agent-check>\n<abstractin-record>{"title":"Check","summary":"The supplied passage was discussed.","openQuestions":[],"scope":{"level":"paper","id":"","title":""},"topicKey":"agent-check","sources":[]}</abstractin-record>' };
  }
  const source = await readFile(join(request.ctx.dir, 'source-probe.txt'), 'utf8');
  return { text: JSON.stringify({ code: source.match(/source-[a-z0-9]+/)[0], pageIndex: 4, printedPageLabel: 'vii' }) };
 };
 const checked = await p.testAndAdaptAgent('custom-demo');
 assert.equal(checked.discussion, true); assert.equal(checked.source, true);
 assert.equal(await readFile(join(dir, 'original-book', 'SKILL.md'), 'utf8'), 'Original book skill: verify evidence.');
 assert.match(await readFile(join(dir, 'agent-adaptations', 'custom-demo.md'), 'utf8'), /Original skills are authoritative/);
 p.selectReadingAgent('custom-demo'); assert.equal(p.readingAgent(), 'custom-demo');
 await p.assertAgentReadingReady('custom-demo', 'source');
 assert.match(await p.agentReadingContext('custom-demo', { reading: { type: 'book' } }), /Original book skill/);
 await writeFile(join(dir, 'original-book', 'new-reference.md'), 'A changed supporting resource.');
 await assert.rejects(p.assertAgentReadingReady('custom-demo', 'source'), /skills changed/);
 assert.equal(p.readingAgent(), 'codex');
 assert.equal(p.getAgentValidation('custom-demo'), null);
});

test('invented adaptation tools are rejected rather than enabled', async () => {
 const { plugin: p } = await environment(); p.saveAgent(config);
 p.queryAgentCapabilities = async () => ({ version: '1', files: true });
 p.runBackend = async () => ({ text: '{"mappings":[{"operation":"read_source","tool":"invented-tool"}],"unsupported":[]}' });
 await assert.rejects(p.testAndAdaptAgent('custom-demo'), /unsupported tool/);
 assert.equal(p.getAgentValidation('custom-demo'), null);
});

test('ACP source bridge rejects traversal, symlinks and file access in knowledge mode', async () => {
 const { plugin: p, dir } = await environment();
 const workspace = join(dir, 'workspace'); await mkdir(workspace); await writeFile(join(workspace, 'source.md'), 'first\nsecond\nthird');
 assert.equal(await p.agentReadFile({ dir: workspace }, join(workspace, 'source.md'), 2, 1), 'second');
 await assert.rejects(p.agentReadFile({ dir: workspace }, '../original-book/SKILL.md'), /outside/);
 await symlink(join(dir, 'original-book'), join(workspace, 'escape'));
 await assert.rejects(p.agentReadFile({ dir: workspace }, 'escape/SKILL.md'), /Symbolic/);
 await assert.rejects(p.agentReadFile({ dir: workspace, reading: { evidenceMode: 'knowledge' } }, 'source.md'), /Knowledge/);
});

test('JSONL adapter sends structured input without shell interpolation and consumes streamed/final results', async () => {
 const { plugin: p, dir } = await environment(); p.saveAgent({ ...config, args: ['literal $(not-a-shell)'] });
 p.findBinary = async () => '/path/demo';
 p.runProcess = async (command, args, cwd, onEvent, onSpawn, stdin) => {
  assert.equal(command, '/path/demo'); assert.equal(args[0], 'literal $(not-a-shell)'); assert.equal(cwd, dir);
  const payload = JSON.parse(stdin); assert.equal(payload.method, 'prompt'); assert.equal(payload.prompt, 'Why?');
  onEvent({ type: 'delta', text: 'Part ' });
  return { stdout: '{"type":"result","text":"Full answer","sessionId":"s1"}\n', stderr: '', exitCode: 0 };
 };
 const result = await p.runBackend('custom-demo', { ctx: { dir }, question: 'Why?', onProgress() {}, images: [] });
 assert.equal(result.text, 'Full answer'); assert.equal(result.sessionId, 's1');
});

function queue() {
 const values = [], waiting = [];
 return { push(value) { if (waiting.length) waiting.shift()(value); else values.push(value); }, read() { return values.length ? Promise.resolve(values.shift()) : new Promise(resolve => waiting.push(resolve)); } };
}

test('ACP performs version negotiation, session setup, streaming, read-only requests and cleanup', async () => {
 const { plugin: p, window, dir } = await environment(); p.saveAgent({ ...config, protocol: 'acp' });
 p.findBinary = async () => '/bin/demo'; p.buildChildEnvironment = () => ({});
 await writeFile(join(dir, 'source.md'), 'Verified passage.');
 const stdout = queue(), stderr = queue(); const methods = [], replies = [];
 let killed = false;
 const send = value => stdout.push(JSON.stringify(value) + '\n');
 const proc = {
  stdin: { async write(bytes) {
   const message = JSON.parse(new TextDecoder().decode(bytes));
   if (!message.method) { replies.push(message); return; }
   methods.push(message.method);
   const result = message.method === 'initialize' ? { protocolVersion: 1, agentInfo: { version: '1.2' }, agentCapabilities: { promptCapabilities: { image: false } } } :
    message.method === 'session/new' ? { sessionId: 'session-1' } : { stopReason: 'end_turn' };
   if (message.method === 'session/prompt') {
    send({ jsonrpc: '2.0', id: 'read', method: 'fs/read_text_file', params: { path: join(dir, 'source.md') } });
    send({ jsonrpc: '2.0', id: 'write', method: 'fs/write_text_file', params: { path: join(dir, 'source.md'), content: 'overwrite' } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } } } });
   }
   send({ jsonrpc: '2.0', id: message.id, result });
  }, async close() {} },
  stdout: { readString: () => stdout.read() }, stderr: { readString: () => stderr.read() },
  kill() { killed = true; stdout.push(''); stderr.push(''); }, wait: async () => ({ exitCode: 0 }),
 };
 window.Subprocess.call = async options => { assert.equal(options.command, '/bin/demo'); return proc; };
 const result = await p.runBackend('custom-demo', { ctx: { dir }, question: 'Explain', history: [], images: [], onProgress() {} });
 assert.equal(result.text, 'Hello'); assert.equal(result.sessionId, 'session-1'); assert.equal(killed, true);
 assert.deepEqual(methods, ['initialize', 'session/new', 'session/prompt']);
 assert.equal(replies.find(reply => reply.id === 'read').result.content, 'Verified passage.');
 assert.ok(replies.find(reply => reply.id === 'write').error);
 assert.equal(await readFile(join(dir, 'source.md'), 'utf8'), 'Verified passage.');
});

test('discussion-only readiness switches to knowledge mode and blocks source verification', async () => {
 const { plugin: p, prefs } = await environment(); p.saveAgent(config);
 const snapshot = await p.agentSkillSnapshot();
 prefs['extensions.abstractin.agentValidation'] = JSON.stringify({ 'custom-demo': { configKey: p.agentConfigKey('custom-demo'), skillFingerprint: snapshot.fingerprint, agentVersion: '1', discussion: true, source: false } });
 p.queryAgentCapabilities = async () => ({ version: '1' });
 p.selectReadingAgent('custom-demo');
 assert.equal(p.getReadingEvidenceMode(), 'knowledge');
 assert.equal(p.agentCanReadSources(), false);
 await p.assertAgentReadingReady('custom-demo', 'knowledge');
 await assert.rejects(p.assertAgentReadingReady('custom-demo', 'source'), /cannot read original sources/);
 p.queryAgentCapabilities = async () => ({ version: '2' });
 await assert.rejects(p.assertAgentReadingReady('custom-demo', 'knowledge'), /version changed/);
 assert.equal(p.readingAgent(), 'codex');
});

test('settings add/edit/remove custom agents without running commands or changing font size', async () => {
 const { plugin: p, document, prefs } = await environment();
 prefs['extensions.abstractin.appearance'] = JSON.stringify({ size: 'large' });
 let launched = false; p.runBackend = async () => { launched = true; throw new Error('Unexpected execution'); };
 const container = document.createElement('div'); document.body.append(container); p.renderPrefsPane(document, container);
 const card = [...container.querySelectorAll('.abstractin-card')].find(el => el.querySelector('.abstractin-card-title').textContent === 'Assistants');
 [...card.querySelectorAll('button')].find(button => button.textContent === 'Add agent').click();
 const editor = card.querySelector('.abstractin-agent-editor');
 const fields = editor.querySelectorAll('input'); fields[0].value = 'My agent'; fields[1].value = '/bin/my-agent'; fields[2].value = '["--stdio"]';
 [...editor.querySelectorAll('button')].find(button => button.textContent === 'Save agent').click();
 const saved = JSON.parse(prefs['extensions.abstractin.agents'])[0];
 assert.equal(saved.name, 'My agent'); assert.equal(saved.protocol, 'acp'); assert.equal(launched, false);
 assert.equal(p.getAppearance().size, 'large');
 const details = card.querySelector('[data-backend="' + saved.id + '"]');
 [...details.querySelectorAll('button')].find(button => button.textContent === 'Remove').click();
 assert.equal(p.agentRegistry()[saved.id], undefined);
 assert.equal(launched, false);
});

test('custom adapters inherit locally configured credentials while native subscription defaults remain unchanged', () => {
 const { plugin: p, window } = loadPlugin();
 window.Subprocess.getEnvironment = () => ({ HOME: '/tmp/home', PATH: '/bin', OPENAI_API_KEY: 'test-key', ANTHROPIC_API_KEY: 'other-test-key' });
 assert.equal(p.buildChildEnvironment().OPENAI_API_KEY, undefined);
 assert.equal(p.buildChildEnvironment({ preserveAPIKeys: true }).OPENAI_API_KEY, 'test-key');
 assert.equal(p.buildChildEnvironment({ preserveAPIKeys: true }).ANTHROPIC_API_KEY, 'other-test-key');
});
