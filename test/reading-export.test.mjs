import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { loadPlugin } from './load-plugin.mjs';

async function setup(type = 'book') {
 const env = loadPlugin(), { plugin: p, window } = env;
 p.hashAgentText = async text => createHash('sha256').update(text).digest('hex');
 const dir = await mkdtemp(join(tmpdir(), 'abstractin-export-'));
 window.OS = { Path: { join }, File: { exists: async path => { try { await access(path); return true; } catch { return false; } } } };
 window.Zotero.File = { createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }), getContentsAsync: path => readFile(path, 'utf8'), putContentsAsync: writeFile };
 const index = { version: 2, active: 'a', chapters: [{ id: 'ch-01', title: '1 Sets', prefix: 'chap-01', order: 0 }, { id: 'ch-02', title: '2 Functions', prefix: 'chap-02', order: 1 }], chats: [
  { id: 'a', chapterID: 'ch-01', topic: 'Definition', number: 1 }, { id: 'b', chapterID: 'ch-02', topic: 'Same question', number: 2 }, { id: 'deleted', deletedAt: 1 }, { id: 'superseded', supersededBy: ['a'] }
 ], migrated: {} };
 const histories = { a: [{ role: 'user', text: 'What is a set?' }, { role: 'assistant', text: 'A set is a collection.' }], b: [{ role: 'user', text: 'Explain the meaning of a set.' }, { role: 'assistant', text: 'Membership is the key concept.' }] };
 await writeFile(join(dir, 'discussions.json'), JSON.stringify(index));
 p.loadHistory = async path => histories[basename(path)] || [];
 p.listDiscussionChildren = async () => [];
 p.assertAgentReadingReady = async () => {};
 const notes = [];
 window.Zotero.Items = { get: id => notes.find(n => n.id === id) };
 const ctx = { dir: join(dir, 'discussions', 'a'), documentDir: dir, discussion: { id: 'a' }, paperItem: { key: 'BOOK', libraryID: 1, getNotes: () => notes.map(n => n.id) }, attachmentItem: { key: 'PDF12345' }, reading: { title: 'Example book', type, answerMode: 'context' } };
 const original = '## PDF page 3; pageIndex 2\nDefinition 1.2: A set is a collection of distinct objects. Membership is written as x in A.';
 p.exportReadingSource = async current => { assert.equal(current.discussion, undefined); assert.notEqual(current.dir, ctx.dir); await writeFile(join(current.dir, 'source-text.md'), original); return { status: 'ready' }; };
 const job = { backend: 'codex', model: 'fixture', effort: '', verifySource: true, cancelled: false, progress() {} };
 return { ...env, p, ctx, dir, index, histories, job, original, notes };
}


const inputData = request => JSON.parse(request.question.split('\nDATA:\n')[1]);
const decisions = (data, edit = () => {}) => {
 const result = { documentKind: data.documentKind || 'other', decisions: data.candidates.map(c => ({
  id: c.id, include: true, topic: 'Knowledge ' + c.id, category: 'content', chapterID: c.chapterHint || null, reason: 'new', duplicateOf: null
 })) };
 edit(result); return { text: JSON.stringify(result) };
};

test('batch selection copies complete original answers, omits user questions and skips duplicate knowledge', async () => {
 const { p, ctx, histories, job, dir } = await setup();
 histories.a[1].text = 'Original **English** answer.\n\n$$x^2 + y^2 = 1$$\n\n' + 'Detailed reasoning. '.repeat(6000) + '\nFINAL DETAIL';
 p.exportReadingSource = async () => { throw new Error('Must not open PDF'); };
 const before = await readFile(join(dir, 'discussions.json'), 'utf8'); let calls = 0;
 p.runBackend = async (_, request) => {
  calls++; assert.equal(request.summaryOnly, true); assert.equal(request.effort, 'low');
  assert.equal(request.ctx.reading.evidenceMode, 'knowledge'); assert.equal(request.history.length, 0); assert.equal(request.session, null);
  const data = inputData(request); assert.equal(data.candidates.length, 2);
  assert.match(data.candidates[0].question, /What is a set/); assert.ok(request.question.length < 12000);
  assert.ok(data.candidates[0].answerHint.length < 300);
  return decisions(data, result => { Object.assign(result.decisions[1], { include: false, reason: 'duplicate', duplicateOf: 'a:1' }); });
 };
 const result = await p.generateReadingExport(ctx, job), state = JSON.parse(await readFile(result.statePath, 'utf8'));
 assert.equal(calls, 1); assert.equal(state.entries.length, 1); assert.equal(state.entries[0].body, histories.a[1].text);
 assert.ok(result.markdown.includes(histories.a[1].text)); assert.doesNotMatch(result.markdown, /What is a set\?|Explain the meaning of a set|Membership is the key/);
 assert.equal(state.events[1].duplicateOf, 'a:1'); assert.equal(await readFile(result.markdownPath, 'utf8'), result.markdown);
 assert.equal(await readFile(join(dir, 'discussions.json'), 'utf8'), before);
});

test('initialized catalogue determines chapter ownership, including mixed-chapter chats', async () => {
 const { p, ctx, histories, job } = await setup(); histories.b = [];
 histories.a.push({ role: 'user', text: 'Explain a function' }, { role: 'assistant', text: 'Functions preserve an association.' });
 p.runBackend = async (_, request) => {
  const data = inputData(request); assert.deepEqual(data.catalogue.map(c => c.id), ['ch-01', 'ch-02']);
  return decisions(data, result => { result.decisions[0].chapterID = 'ch-02'; result.decisions[1].chapterID = 'ch-01'; });
 };
 const result = await p.generateReadingExport(ctx, job), state = JSON.parse(await readFile(result.statePath, 'utf8'));
 assert.equal(state.entries[0].chapterID, 'ch-02'); assert.equal(state.entries[1].chapterID, 'ch-01');
 assert.ok(result.markdown.indexOf('### 1 Sets') < result.markdown.indexOf('Functions preserve'));
 assert.ok(result.markdown.indexOf('### 2 Functions') < result.markdown.indexOf('A set is a collection'));
});

test('unknown chapter assignment remains unassigned and papers do not acquire book chapters', async () => {
 const { p, ctx, job } = await setup();
 p.runBackend = async (_, request) => decisions(inputData(request), result => { for (const d of result.decisions) d.chapterID = null; });
 let result = await p.generateReadingExport(ctx, job); assert.match(result.markdown, /### Unassigned/);
 ctx.reading.type = 'paper'; result = await p.generateReadingExport(ctx, job);
 assert.doesNotMatch(result.markdown, /### 1 Sets|### 2 Functions|### Unassigned/); assert.match(result.markdown, /### Knowledge points/);
});

test('unchanged exports reuse decisions; appended messages classify only the new answer', async () => {
 const { p, ctx, histories, job } = await setup(); let calls = 0;
 p.runBackend = async (_, request) => { calls++; return decisions(inputData(request)); };
 await p.generateReadingExport(ctx, job); assert.equal(calls, 1);
 p.assertAgentReadingReady = async () => { throw new Error('Cached export does not need an agent'); };
 p.getLanguage = () => 'Different output language';
 let result = await p.generateReadingExport(ctx, { ...job }); assert.equal(result.cached, true); assert.equal(calls, 1);
 p.assertAgentReadingReady = async () => {};
 histories.b.push({ role: 'user', text: 'New knowledge?' }, { role: 'assistant', text: 'An entirely new answer.' });
 p.runBackend = async (_, request) => {
  calls++; const data = inputData(request); assert.equal(data.candidates.length, 1); assert.equal(data.candidates[0].id, 'b:3'); assert.equal(data.included.length, 2);
  return decisions(data);
 };
 result = await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 2); assert.match(result.markdown, /An entirely new answer/);
});

test('interrupted batches resume; failed or invalid selections do not replace a saved result', async () => {
 const { p, ctx, histories, job, dir } = await setup(); histories.a = []; histories.b = [];
 for (let i = 0; i < 13; i++) histories.a.push({ role: 'user', text: 'Question ' + i }, { role: 'assistant', text: 'Answer ' + i });
 let calls = 0;
 p.runBackend = async (_, request) => { if (++calls === 2) throw new Error('Disconnected'); return decisions(inputData(request)); };
 await assert.rejects(p.generateReadingExport(ctx, job), /Disconnected/);
 let state = JSON.parse(await readFile(join(dir, 'exports', 'summary-state.json'), 'utf8'));
 assert.equal(state.events.length, 12); assert.equal(state.complete, false);
 p.runBackend = async (_, request) => { calls++; const data = inputData(request); assert.equal(data.candidates.length, 1); return decisions(data); };
 const complete = await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 3);
 const saved = await readFile(complete.statePath, 'utf8'); histories.a.push({ role: 'assistant', text: 'More knowledge.' });
 p.runBackend = async () => ({ text: '{"documentKind":"other","decisions":[]}' });
 await assert.rejects(p.generateReadingExport(ctx, { ...job }), /incomplete/);
 assert.equal(await readFile(complete.statePath, 'utf8'), saved);
});

test('edits rebuild the affected suffix; removed answers disappear without calling a model', async () => {
 const { p, ctx, histories, job } = await setup(); let calls = 0;
 p.runBackend = async (_, request) => { calls++; return decisions(inputData(request)); };
 await p.generateReadingExport(ctx, job); histories.b[1].text = 'Corrected answer.\nPreserve it literally.';
 p.runBackend = async (_, request) => { calls++; const data = inputData(request); assert.equal(data.candidates[0].id, 'b:1'); assert.equal(data.included.length, 1); return decisions(data); };
 let result = await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 2); assert.ok(result.markdown.includes(histories.b[1].text));
 histories.b = []; result = await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 2); assert.doesNotMatch(result.markdown, /Corrected answer/);
});

test('invented chapter IDs, duplicate references and incomplete candidate coverage are rejected', async () => {
 const { p, ctx, job } = await setup();
 for (const mutate of [
  result => { result.decisions[0].chapterID = 'invented'; },
  result => { Object.assign(result.decisions[0], { include: false, reason: 'duplicate', duplicateOf: 'b:1' }); },
  result => { result.decisions[1].id = result.decisions[0].id; },
  result => { result.decisions.pop(); }
 ]) {
  p.runBackend = async (_, request) => decisions(inputData(request), mutate);
  await assert.rejects(p.generateReadingExport(ctx, { ...job }), /chapter|duplicate|repeated|incomplete/);
 }
});

test('language books use one section; original multilingual answers are never translated', async () => {
 const { p, ctx, histories, job } = await setup();
 histories.a[1].text = '\u539f\u56de\u7b54\uff1a\u96c6\u5408\u3002\nEnglish example.\n$A \\subseteq B$';
 p.runBackend = async (_, request) => {
  assert.doesNotMatch(request.question, /Write in English|Respond in English/);
  return decisions(inputData(request), result => { result.decisions[1].category = 'language'; });
 };
 let result = await p.generateReadingExport(ctx, { ...job, organization: 'split' });
 assert.match(result.markdown, /^## Language/m); assert.ok(result.markdown.includes(histories.a[1].text));
 result = await p.generateReadingExport(ctx, { ...job, organization: 'language' });
 assert.doesNotMatch(result.markdown, /^## Language/m); assert.ok(result.markdown.includes(histories.a[1].text));
});

test('live chats, legacy chats and edited notes stay attachment-scoped; sync transcripts are not duplicated', async () => {
 const { p, ctx, histories, notes, dir, job } = await setup();
 histories.live = [{ role: 'assistant', text: 'Unsaved live knowledge.' }];
 p.registerChatContext({ ...ctx, dir: join(dir, 'discussions', 'live'), discussion: { id: 'live', chapterID: 'ch-02', number: 3, topic: 'Live' } });
 p.registerChatContext({ ...ctx, documentDir: join(dir, 'other'), dir: join(dir, 'other', 'discussions', 'foreign'), attachmentItem: { key: 'OTHER' }, discussion: { id: 'foreign' } });
 notes.push({ id: 1, key: 'EDIT', getTags: () => [{ tag: 'AbstractIn:Summary' }], getNote: () => '<p>attachment: PDF12345</p><p>Edited reading note</p>' });
 notes.push({ id: 2, key: 'OTHER', getTags: () => [{ tag: 'AbstractIn:Summary' }], getNote: () => '<p>attachment: ANOTHER</p><p>Foreign content</p>' });
 notes.push({ id: 3, key: 'SYNC', getTags: () => [{ tag: 'AbstractIn' }, { tag: 'AbstractIn:Chat' }], getNote: () => '<p>attachment: PDF12345</p><p>Raw user transcript</p>' });
 const legacy = join(dir, 'chat-legacy.json'); await writeFile(legacy, JSON.stringify([{ role: 'user', text: 'Legacy question' }, { role: 'assistant', text: 'Legacy answer.' }]));
 p.listDiscussionChildren = async () => [{ path: legacy, name: 'chat-legacy.json', isDir: false }];
 p.runBackend = async (_, request) => decisions(inputData(request));
 const result = await p.generateReadingExport(ctx, job);
 assert.match(result.markdown, /Unsaved live knowledge|Edited reading note|Legacy answer/);
 assert.doesNotMatch(result.markdown, /Foreign content|Raw user transcript|Legacy question/);
});

test('saved-summary-only histories are labeled honestly; hidden record protocol is not exported', async () => {
 const { p, ctx, histories, job } = await setup();
 histories.a = [{ role: 'assistant', text: 'Only a saved summary remains.', savedSummary: true }];
 histories.b[1].text = 'Visible original answer.\n<abstractin-record>{"summary":"HIDDEN"}</abstractin-record>';
 p.runBackend = async (_, request) => decisions(inputData(request));
 const result = await p.generateReadingExport(ctx, job);
 assert.match(result.markdown, /previously saved conversation summary/); assert.doesNotMatch(result.markdown, /HIDDEN|abstractin-record/);
});

test('UI preserves the existing export entry and starts no request until Generate', async () => {
 const { p, ctx, document } = await setup(); const body = document.createElement('div'); document.body.append(body); p.renderSkeleton(document, body);
 const root = body.querySelector('.abstractin-root'); p._views.set(root, { root, ctx, doc: document });
 let calls = 0; p.generateReadingExport = async () => { calls++; return { title: 'Book', markdown: '# Ready' }; };
 root.querySelector('.abstractin-export-reading').click();
 const panel = root.querySelector('.abstractin-reading-export'); assert.ok(panel); assert.equal(calls, 0);
 assert.match(panel.textContent, /copied in full/); assert.equal(panel.querySelector('input[type=checkbox]'), null);
 await panel.querySelector('button').onclick(); assert.equal(calls, 1); assert.equal(panel.querySelector('textarea').value, '# Ready');
 [...panel.querySelectorAll('button')].find(b => b.textContent === 'Close').click(); assert.equal(p._readingExports.size, 0);
});

test('cancelled jobs start no backend and malformed model output is rejected', async () => {
 const { p, ctx, job } = await setup(); job.cancelled = true;
 p.runBackend = async () => { throw new Error('Must not run'); };
 await assert.rejects(p.generateReadingExport(ctx, job), /cancelled/);
 job.cancelled = false; p.runBackend = async () => ({ text: 'bad JSON' });
 await assert.rejects(p.generateReadingExport(ctx, job), /invalid selection JSON/);
});
