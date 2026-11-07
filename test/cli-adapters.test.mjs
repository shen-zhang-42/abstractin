import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

test('Gemini is a built-in ACP CLI while legacy backends keep their identities', async () => {
 const { plugin: p, document } = loadPlugin(); const registry = p.agentRegistry();
 assert.equal(registry.gemini.command, 'gemini'); assert.equal(registry.gemini.protocol, 'acp'); assert.deepEqual([...registry.gemini.args], ['--acp']);
 for (const id of ['codex', 'claude', 'agy', 'deepseek']) assert.ok(registry[id]);
 const card = p.buildAssistantsCard(document), gemini = card.querySelector('[data-backend="gemini"]');
 assert.ok(gemini); assert.ok(![...gemini.querySelectorAll('button')].some(button => button.textContent === 'Remove'));
 let called = false; p.runACPAgent = async id => { assert.equal(id, 'gemini'); called = true; return { text: 'Gemini answer' }; };
 assert.equal((await p.runBackend('gemini', {})).text, 'Gemini answer'); assert.equal(called, true);
});

test('text CLI uses stdin, passes literal arguments, supplies history and never pretends to support images', async () => {
 const { plugin: p } = loadPlugin();
 p.saveAgent({ id: 'custom-text', name: 'Text agent', command: 'text-agent', protocol: 'text', args: ['--model', '{model}', '$(literal)'] });
 p.findBinary = async () => '/bin/text-agent'; p.buildChildEnvironment = () => ({});
 p.runAgentProcess = async (command, args, cwd, _, __, stdin) => {
  assert.equal(command, '/bin/text-agent'); assert.deepEqual([...args], ['--model', 'my-model', '$(literal)']);
  assert.match(stdin, /Earlier/); assert.match(stdin, /Explain/); assert.equal(cwd, '/workspace');
  return { stdout: 'Answer', stderr: '', exitCode: 0 };
 };
 assert.equal((await p.runBackend('custom-text', { ctx: { dir: '/workspace' }, model: 'my-model', question: 'Explain', history: [{ role: 'user', text: 'Earlier' }] })).text, 'Answer');
 assert.match((await p.runBackend('custom-text', { images: ['/page.png'] })).error, /does not support image/);
});

test('Windows npm CLI wrappers resolve to Node and a literal JS entry without a shell', async () => {
 const { plugin: p, window } = loadPlugin(); window.Zotero.isWin = true;
 p.findBinary = async () => 'C:/npm/gemini.cmd';
 p.buildChildEnvironment = () => ({ PATH: 'C:/node' });
 window.OS = { Path: { join: (...parts) => parts.join('/') }, File: { exists: async path => path === 'C:/npm/node_modules/@google/gemini-cli/dist/index.js' } };
 window.Zotero.File = { getContentsAsync: async () => '"%_prog%" "%dp0%\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*' };
 window.Subprocess.pathSearch = async () => 'C:/node/node.exe';
 const invocation = await p.cliInvocation('gemini', ['--acp', '$(literal)']);
 assert.equal(invocation.command, 'C:/node/node.exe'); assert.deepEqual([...invocation.args], ['C:/npm/node_modules/@google/gemini-cli/dist/index.js', '--acp', '$(literal)']);
});
