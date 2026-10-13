import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

function env() {
 const e = loadPlugin(); e.plugin.findBinary = async () => '/bin/claude'; e.plugin.getDataDir = () => '/tmp/catalog';
 e.window.Zotero.File = { createDirectoryIfMissingAsync: async () => {} };
 e.plugin.buildChildEnvironment = () => ({});
 return e;
}
const catalog = [{ value: 'sonnet', displayName: 'Sonnet from CLI', description: 'Current account configuration' }, { value: 'custom[1m]', displayName: 'Long context' }];

test('Claude refresh replaces static aliases with the CLI catalog, caches and preserves explicit selection', async () => {
 const { plugin: p } = env(); p.setPref('claude.model', 'my-selected-model');
 let reads = 0; p.queryClaudeModels = async () => { reads++; return [...catalog, catalog[0], { value: '' }, { value: '\ninvalid' }]; };
 await Promise.all([p.loadClaudeModels(), p.loadClaudeModels()]); assert.equal(reads, 1);
 assert.deepEqual([...p.getModels('claude')].map(m => m.id), ['', 'sonnet', 'custom[1m]', 'my-selected-model']);
 assert.equal(p.modelLabel('claude', 'sonnet'), 'Sonnet from CLI');
 assert.equal(p.getModel('claude'), 'my-selected-model');
 await p.loadClaudeModels(); assert.equal(reads, 1); await p.loadClaudeModels(true); assert.equal(reads, 2);
 p.queryClaudeModels = async () => { throw new Error('CLI startup failed'); }; await p.loadClaudeModels(true);
 assert.match(p._claudeModelsError, /CLI startup failed/); assert.equal(p.modelLabel('claude', 'sonnet'), 'Sonnet from CLI');
});

test('empty or invalid Claude catalog does not erase the previous model list', async () => {
 const { plugin: p } = env(); p.queryClaudeModels = async () => catalog; await p.loadClaudeModels();
 p.queryClaudeModels = async () => [{ unexpected: 'data' }]; await p.loadClaudeModels(true);
 assert.match(p._claudeModelsError, /no supported models/); assert.equal(p.getModels('claude')[1].id, 'sonnet');
});

test('Claude catalog invalidates when executable or settings mode changes', async () => {
 const { plugin: p } = env(); let reads = 0; p.queryClaudeModels = async () => { reads++; return catalog; };
 await p.loadClaudeModels(); p.setPref('claudePath', '/new/claude');
 assert.ok(p.getModels('claude').some(m => m.id === 'opus')); await p.loadClaudeModels(); assert.equal(reads, 2);
 p.setPref('useClaudeUserSettings', true); await p.loadClaudeModels(); assert.equal(reads, 3);
});

test('a stale Claude catalog response cannot overwrite a changed configuration', async () => {
 const { plugin: p } = env(); let finish;
 p.queryClaudeModels = () => new Promise(resolve => { finish = resolve; }); const task = p.loadClaudeModels();
 await new Promise(resolve => setImmediate(resolve)); p.setPref('claudePath', '/changed/claude'); finish(catalog); await task;
 assert.equal(p._claudeModels, undefined); assert.match(p._claudeModelsError, /configuration changed/);
});

function protocol(e, reply) {
 const sent = []; let pending, chunks = [], closed = false, kills = 0, closes = 0;
 const enqueue = text => { if (pending) { const resolve = pending; pending = null; resolve(text); } else chunks.push(text); };
 const proc = {
  stdin: { write: async bytes => {
   const msg = JSON.parse(new TextDecoder().decode(bytes)); sent.push(msg);
   const response = reply(msg);
   if (response) { const text = JSON.stringify(response) + '\n'; enqueue('non-JSON notice\n' + text.slice(0, 15)); enqueue(text.slice(15)); }
  }, close: async () => { closes++; } },
  stdout: { readString: async () => chunks.length ? chunks.shift() : closed ? '' : new Promise(resolve => { pending = resolve; }) },
  stderr: { readString: async () => '' },
  kill: () => { kills++; closed = true; enqueue(''); }, wait: async () => ({ exitCode: 0 }),
 };
 e.window.Subprocess.call = async options => {
  const args = [...options.arguments]; assert.ok(args.includes('--input-format')); assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.ok(args.includes('--no-session-persistence')); assert.ok(!args.includes('--model'));
  if (e.window.Zotero.isWin) { assert.ok(args.includes('--setting-sources=')); assert.ok(!args.includes('')); }
  return proc;
 };
 return { sent, cleanup: () => ({ kills, closes }) };
}
const success = msg => ({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { models: catalog } } });

test('Claude catalog uses only SDK initialization, handles split JSON, and releases the process', async () => {
 for (const windows of [false, true]) {
  const e = env(); e.window.Zotero.isWin = windows;
  const fake = protocol(e, success); const models = await e.plugin.queryClaudeModels('/bin/claude', '/tmp/catalog');
  assert.deepEqual([...models].map(m => m.value), ['sonnet', 'custom[1m]']);
  assert.equal(fake.sent.length, 1); assert.equal(fake.sent[0].type, 'control_request'); assert.equal(fake.sent[0].request.subtype, 'initialize');
  assert.equal(fake.cleanup().closes, 1); assert.ok(fake.cleanup().kills >= 1);
 }
});

test('Claude catalog errors, invalid catalogs and timeouts always release the process', async () => {
 for (const kind of ['error', 'invalid', 'timeout', 'result']) {
  const e = env();
  const fake = protocol(e, msg => kind === 'error' ? { type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: 'Not authorized' } }
   : kind === 'invalid' ? { type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } }
   : kind === 'result' ? { type: 'result', is_error: true, result: 'Login required' } : null);
  if (kind === 'timeout') e.window.setTimeout = fn => { queueMicrotask(fn); return 1; };
  await assert.rejects(e.plugin.queryClaudeModels('/bin/claude', '/tmp/catalog'), kind === 'error' ? /Not authorized/ : kind === 'invalid' ? /Invalid Claude model catalog/ : kind === 'result' ? /Login required/ : /timed out/);
  assert.equal(fake.cleanup().closes, 1); assert.ok(fake.cleanup().kills >= 1);
 }
});

test('Claude Settings has a working refresh action and updates the model select', async () => {
 const { plugin: p, document } = env(); p.queryClaudeModels = async () => catalog;
 const card = p.buildAssistantsCard(document); document.body.append(card);
 const button = [...card.querySelectorAll('button')].find(n => n.textContent === 'Refresh Claude models'); assert.ok(button);
 button.click(); await new Promise(resolve => setImmediate(resolve));
 assert.match(card.textContent, /Claude models refreshed/);
 assert.ok([...card.querySelector('[data-backend="claude"] select').options].some(n => n.textContent === 'Sonnet from CLI'));
});

test('Claude default catalog entry maps to the local-default choice without duplicates', async () => {
 const { plugin: p } = env(); p.queryClaudeModels = async () => [{ value: 'default', displayName: 'Default (recommended)' }, ...catalog];
 await p.loadClaudeModels(); assert.deepEqual([...p.getModels('claude')].map(m => m.id), ['', 'sonnet', 'custom[1m]']);
 assert.equal(p.modelLabel('claude', ''), 'Default (recommended)');
 p.queryClaudeModels = async () => [{ value: 'default', displayName: 'Only default' }]; await p.loadClaudeModels(true);
 assert.equal(p._claudeModelsError, null); assert.deepEqual([...p.getModels('claude')].map(m => m.id), ['']);
});
