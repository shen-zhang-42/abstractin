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

const point = (refs, extra = {}) => ({ title: 'What is a set?', body: 'A collection, with membership explained.', chapterID: 'ch-01', originalNumber: '1.2', quote: 'Definition 1.2: A set is a collection of distinct objects.', refs, ...extra });

const progressive = (data, extra = {}) => ({ documentKind: data.documentKind || 'other', updates: [{
 ...point(data.records.map(r => r.id), { originalNumber: '', quote: '' }), id: data.existingTopics[0]?.id || null,
 category: 'content', openQuestions: [], relations: [{ type: data.existingTopics.length ? 'supplement' : 'new',
 targetID: data.existingTopics[0]?.id || null, explanation: 'Connect the new discussion to this topic.' }], ...extra
}], skippedRecords: [] });

test('sequential export integrates earlier topics, verifies lazily and preserves original chats', async () => {
 const { p, ctx, dir, job } = await setup();
 const before = await readFile(join(dir, 'discussions.json'), 'utf8'); let calls = 0;
 p.runBackend = async (id, request) => {
  assert.equal(id, 'codex'); assert.equal(request.history.length, 0); assert.equal(request.session, null);
  assert.equal(request.ctx.reading.exportSummary, true); assert.notEqual(request.ctx.dir, ctx.dir);
  const data = inputData(request); calls++;
  if (calls === 1) {
   assert.ok(data.records.every(r => r.id.startsWith('a:'))); assert.equal(data.existingTopics.length, 0);
   return { text: JSON.stringify({ lookups: ['Definition 1.2'] }) };
  }
  if (calls === 2) assert.match(request.question, /collection of distinct objects/);
  if (calls === 3) { assert.ok(data.records.every(r => r.id.startsWith('b:'))); assert.equal(data.existingTopics[0].id, 't1'); }
  return { text: JSON.stringify(progressive(data, { originalNumber: '1.2', quote: 'Definition 1.2: A set is a collection of distinct objects.' })) };
 };
 const result = await p.generateReadingExport(ctx, job);
 assert.equal(calls, 3); assert.equal((result.markdown.match(/^#### /gm) || []).length, 1);
 assert.match(result.markdown, /### 1 Sets/); assert.match(result.markdown, /#### 1\.2 What is a set/);
 assert.match(result.markdown, /Chat 2.*Same question/); assert.match(result.markdown, /Original source: Definition 1\.2/);
 assert.equal(await readFile(join(dir, 'discussions.json'), 'utf8'), before);
 const state = JSON.parse(await readFile(result.statePath, 'utf8'));
 assert.equal(state.complete, true); assert.equal(state.events.length, 2); assert.equal(state.topics.length, 1);
 assert.deepEqual(state.topics[0].refs, ['a:0:0', 'a:1:0', 'b:0:0', 'b:1:0']);
 assert.equal(await readFile(result.markdownPath, 'utf8'), result.markdown);
 assert.deepEqual((await readdir(ctx.documentDir)).sort(), ['discussions.json', 'exports']);
});

test('snapshot includes edited PDF notes and every long chat piece, excludes deleted chats and other PDFs', async () => {
 const { p, ctx, histories, notes } = await setup();
 histories.a[1].text = 'x'.repeat(41000) + 'END OF LONG ANSWER';
 notes.push({ id: 1, key: 'N1', getTags: () => [{ tag: 'AbstractIn:Summary' }], getNote: () => '<p>attachment: PDF12345</p><p>Edited summary correction</p>' });
 notes.push({ id: 2, key: 'N2', getTags: () => [{ tag: 'AbstractIn:Summary' }], getNote: () => '<p>attachment: OTHERPDF</p><p>Not this paper</p>' });
 const snapshot = await p.collectReadingExport(ctx);
 assert.ok(snapshot.units.map(u => u.text).join('').includes('END OF LONG ANSWER'));
 assert.ok(snapshot.units.some(u => u.id.startsWith('note:N1')));
 assert.ok(!snapshot.units.some(u => /N2|deleted|superseded/.test(u.id)));
 assert.ok(p.readingExportBatches(snapshot.units).length >= 3);
});

test('unverified numbering receives separate export numbering and papers have no chapter grouping', async () => {
 const { p, ctx, index } = await setup('paper');
 const text = p.renderReadingExport({ ctx, index, title: 'Paper' }, [point(['a'], { originalNumber: '99.1', quote: 'Invented quotation 99.1' }), point(['b'], { originalNumber: '' })], { source: { text: 'Some original text' }, evidence: ['Different text'] });
 assert.match(text, /### paper\.S1/); assert.match(text, /### paper\.S2/); assert.match(text, /could not be verified/);
 assert.doesNotMatch(text, /## 1 Sets|### 99\.1/);
});

test('source-based additions without book numbering retain their verified quotation', async () => {
 const { p, ctx, index } = await setup();
 const quote = 'Membership is written as x in A.';
 const text = p.renderReadingExport({ ctx, index, title: 'Book' }, [point(['a'], { originalNumber: '', quote, body: 'Original-source addition: membership notation.' })], { source: { text: quote }, evidence: [quote] });
 assert.match(text, /### 1\.S1/); assert.match(text, /Original source: Membership/);
});

test('export source lookup works for text-only agents and labels missing evidence', async () => {
 const { p, job, ctx } = await setup(); job.ctx = ctx; job.backend = 'deepseek'; job.source = { text: '', error: 'PDF missing' }; job.evidence = [];
 let calls = 0;
 p.runBackend = async (id, request) => {
  assert.equal(id, 'deepseek');
  if (++calls === 1) return { text: '{"lookups":["Definition 1.2"]}' };
  assert.match(request.question, /Original source unavailable: PDF missing/);
  return { text: JSON.stringify({ points: [point(['a'], { body: 'Unverified: the original PDF is unavailable.' })] }) };
 };
 const result = await p.readingExportAgent(job, 'Return points JSON', {});
 assert.match(result.points[0].body, /Unverified/); assert.equal(calls, 2);
});

test('cancelled export starts no agent request; invalid output is rejected', async () => {
 const { p, job, ctx } = await setup(); job.ctx = ctx; job.evidence = []; job.source = { text: '' }; job.cancelled = true;
 p.runBackend = async () => { throw new Error('must not be called'); };
 await assert.rejects(p.readingExportAgent(job, '', {}), /Export cancelled/);
 job.cancelled = false; p.runBackend = async () => ({ text: 'not JSON' });
 await assert.rejects(p.readingExportAgent(job, '', {}), /invalid summary format/);
});

test('source search returns relevant original passages without claiming absence', async () => {
 const { p, original } = await setup();
 assert.match(p.readingExportSearch({ text: original }, 'Definition 1.2'), /collection of distinct objects/);
 assert.match(p.readingExportSearch({ text: original }, 'nonexistentzzzz'), /not proof of absence/);
});

test('UI opens export preview, closes cleanly and does not start a billable request automatically', async () => {
 const { p, ctx, document } = await setup(); const body = document.createElement('div'); document.body.append(body); p.renderSkeleton(document, body);
 const root = body.querySelector('.abstractin-root'); p._views.set(root, { root, ctx, doc: document });
 let calls = 0; p.generateReadingExport = async () => { calls++; return { title: 'Book', markdown: '# Ready' }; };
 root.querySelector('.abstractin-export-reading').click();
 assert.equal(calls, 0); assert.equal(p._readingExports.size, 1);
 const panel = root.querySelector('.abstractin-reading-export'); assert.ok(panel);
 await panel.querySelector('button').onclick(); assert.equal(calls, 1); assert.equal(panel.querySelector('textarea').value, '# Ready');
 [...panel.querySelectorAll('button')].find(b => b.textContent === 'Close').click();
 assert.equal(p._readingExports.size, 0); assert.equal(root.querySelector('.abstractin-reading-export'), null);
});

const inputData = request => JSON.parse(request.question.split('\nDATA:\n')[1].split('\nLOOKUP RESULTS:\n')[0]);

test('whole-book export reads each exchange and includes live chats without opening the PDF', async () => {
 const { p, ctx, job, histories, dir } = await setup(); job.verifySource = false;
 histories.live = [{ role: 'user', text: 'New chapter question' }, { role: 'assistant', text: 'New conclusion' }];
 p.registerChatContext({ ...ctx, dir: join(dir, 'discussions', 'live'), discussion: { id: 'live', chapterID: 'ch-02', number: 3, topic: 'Live topic' } });
 p.registerChatContext({ ...ctx, documentDir: join(dir, 'another-pdf'), dir: join(dir, 'another-pdf', 'discussions', 'foreign'), attachmentItem: { key: 'OTHERPDF' }, discussion: { id: 'foreign' } });
 p.exportReadingSource = async () => { throw new Error('Must not open PDF'); };
 let calls = 0; const seen = [];
 p.runBackend = async (_, request) => {
  calls++; assert.equal(request.effort, 'low'); assert.equal(request.summaryOnly, true);
  const data = inputData(request); seen.push(...data.records.map(r => r.id));
  return { text: JSON.stringify(progressive(data)) };
 };
 const result = await p.generateReadingExport(ctx, job);
 assert.equal(calls, 3); assert.ok(seen.some(id => id.startsWith('a:'))); assert.ok(seen.some(id => id.startsWith('b:')));
 assert.ok(seen.some(id => id.startsWith('live:'))); assert.ok(!seen.some(id => id.startsWith('foreign:')));
 assert.match(result.markdown, /Chat 3.*Live topic/); assert.match(result.markdown, /all available conversations/);
 const cached = await p.generateReadingExport(ctx, { ...job }); assert.equal(cached.cached, true); assert.equal(calls, 3);
});

test('long exchanges split without omission and new exchanges only process the new suffix', async () => {
 const { p, ctx, histories, job } = await setup(); job.verifySource = false;
 histories.a[1].text = 'Long discussion. '.repeat(8000) + 'FINAL SENTENCE';
 const segments = p.readingExportSegments((await p.collectReadingExport(ctx)).units); assert.ok(segments.length > 2);
 let calls = 0, previews = 0; job.onPreview = () => previews++;
 p.runBackend = async (_, request) => { calls++; return { text: JSON.stringify(progressive(inputData(request))) }; };
 await p.generateReadingExport(ctx, job); assert.equal(calls, segments.length); assert.equal(previews, segments.length + 1);
 histories.b.push({ role: 'user', text: 'A new question' }, { role: 'assistant', text: 'A new conclusion' });
 const before = calls; await p.generateReadingExport(ctx, { ...job }); assert.equal(calls - before, 1);
});

test('incomplete coverage fails without accepting an incomplete segment', async () => {
 const { p, ctx, job, dir } = await setup(); job.verifySource = false;
 p.runBackend = async (_, request) => { const data = inputData(request), out = progressive(data); out.updates[0].refs = [data.records[0].id]; return { text: JSON.stringify(out) }; };
 await assert.rejects(p.generateReadingExport(ctx, job), /omitted part of the discussion/);
 const state = JSON.parse(await readFile(join(dir, 'exports', 'summary-state.json'), 'utf8'));
 assert.equal(state.complete, false); assert.equal(state.events.length, 0);
});

test('optional source verification does not load the PDF unless requested', async () => {
 const { p, ctx, job } = await setup(); let opened = false;
 p.exportReadingSource = async () => { opened = true; throw new Error('Not needed'); };
 p.runBackend = async (_, request) => ({ text: JSON.stringify(progressive(inputData(request))) });
 await p.generateReadingExport(ctx, job); assert.equal(opened, false);
});

test('interruptions resume saved segments; editing earlier messages rebuilds the dependent suffix', async () => {
 const { p, ctx, job, histories, dir } = await setup(); job.verifySource = false; let calls = 0;
 p.runBackend = async (_, request) => { calls++; if (calls === 2) throw new Error('Disconnected'); return { text: JSON.stringify(progressive(inputData(request))) }; };
 await assert.rejects(p.generateReadingExport(ctx, job), /Disconnected/);
 let state = JSON.parse(await readFile(join(dir, 'exports', 'summary-state.json'), 'utf8')); assert.equal(state.events.length, 1);
 p.runBackend = async (_, request) => { calls++; const data = inputData(request); assert.ok(data.records.every(r => r.id.startsWith('b:'))); return { text: JSON.stringify(progressive(data)) }; };
 await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 3);
 histories.a[0].text = 'An edited question';
 p.runBackend = async (_, request) => { calls++; return { text: JSON.stringify(progressive(inputData(request))) }; };
 await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 5);
 histories.b.length = 0;
 const shortened = await p.generateReadingExport(ctx, { ...job }); assert.equal(calls, 5);
 state = JSON.parse(await readFile(shortened.statePath, 'utf8'));
 assert.equal(state.topics[0].refs.length, 2); assert.doesNotMatch(shortened.markdown, /Chat 2/);
});

test('content and language are independent while language books produce one section', async () => {
 const { p, ctx, job } = await setup(); job.verifySource = false;
 p.runBackend = async (_, request) => {
  const data = inputData(request), out = progressive(data); out.updates[0].category = 'content';
  if (data.records[0].id.startsWith('a:')) out.updates.push({ ...out.updates[0], category: 'language', title: 'Collection: vocabulary', body: 'Word meaning and use.' });
  return { text: JSON.stringify(out) };
 };
 let result = await p.generateReadingExport(ctx, job);
 assert.match(result.markdown, /^## Book content/m); assert.match(result.markdown, /^## Language/m);
 p.runBackend = async (_, request) => ({ text: JSON.stringify(progressive(inputData(request), { category: 'language' })) });
 result = await p.generateReadingExport(ctx, { ...job, organization: 'language' });
 assert.match(result.markdown, /^## Book content/m); assert.doesNotMatch(result.markdown, /^## Language/m);
 const state = JSON.parse(await readFile(result.statePath, 'utf8')); assert.ok(state.topics.every(t => t.category === 'content'));
});

test('related topics outside the selected context are read on demand before revision', async () => {
 const { p, job, ctx, index } = await setup(); job.ctx = ctx; job.verifySource = false; job.evidence = []; job.source = { text: '' };
 const topic = { ...point(['old']), id: 't1', category: 'content', relations: [], openQuestions: [] };
 const state = { title: 'Book', documentKind: 'other', topics: [topic], events: [] };
 p.readingSummaryContext = () => []; let calls = 0;
 p.runBackend = async (_, request) => {
  const data = inputData(request); calls++;
  if (calls === 1) { assert.equal(data.existingTopics.length, 0); assert.equal(data.topicIndex[0].id, 't1'); return { text: '{"readTopics":["t1"]}' }; }
  assert.equal(data.existingTopics[0].body, topic.body);
  return { text: JSON.stringify(progressive(data, { body: 'Corrected explanation', relations: [{ type: 'correction', targetID: 't1', explanation: 'The new discussion corrects the old claim.' }] })) };
 };
 const result = await p.readingSummaryStep(job, state, [{ id: 'new', text: 'Unrelated wording' }], index.chapters);
 assert.equal(calls, 2); assert.equal(result.topics.length, 1); assert.deepEqual(Array.from(result.topics[0].refs), ['old', 'new']);
 assert.equal(result.topics[0].relations[0].type, 'correction');
});
