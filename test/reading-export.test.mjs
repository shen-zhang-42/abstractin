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

test('full export merges equivalent questions across chats, verifies source and preserves chats/index', async () => {
 const { p, ctx, dir, job, original } = await setup();
 const before = await readFile(join(dir, 'discussions.json'), 'utf8'); let call = 0;
 p.runBackend = async (id, request) => {
  assert.equal(id, 'codex'); assert.equal(request.history.length, 0); assert.equal(request.session, null); assert.equal(request.ctx.reading.exportSummary, true);
  assert.notEqual(request.ctx.dir, ctx.dir);
  call++;
  if (call === 1) { assert.match(request.question, /What is a set/); assert.match(request.question, /Explain the meaning/); return { text: JSON.stringify({ lookups: ['Definition 1.2'] }) }; }
  if (call === 2) { assert.match(request.question, /collection of distinct objects/); return { text: JSON.stringify({ points: [point(['a:0:0', 'a:1:0', 'b:0:0', 'b:1:0'])] }) }; }
  return { text: JSON.stringify({ points: [point(['a:0:0', 'a:1:0', 'b:0:0', 'b:1:0'])] }) };
 };
 const result = await p.generateReadingExport(ctx, job);
 assert.equal(call, 2); assert.equal((result.markdown.match(/^### /gm) || []).length, 1);
 assert.match(result.markdown, /## 1 Sets/); assert.match(result.markdown, /### 1\.2 What is a set/);
 assert.match(result.markdown, /Chat 2 — Same question/); assert.match(result.markdown, /Original source: Definition 1\.2/);
 assert.equal(await readFile(join(dir, 'discussions.json'), 'utf8'), before);
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

test('fast whole-book export includes every chapter and live conversation in one call without opening the PDF', async () => {
 const { p, ctx, job, histories, dir } = await setup(); job.verifySource = false;
 histories.live = [{ role: 'user', text: 'Question in a newly opened chapter chat' }, { role: 'assistant', text: 'A new conclusion' }];
 p.registerChatContext({ ...ctx, dir: join(dir, 'discussions', 'live'), discussion: { id: 'live', chapterID: 'ch-02', number: 3, topic: 'Live topic' } });
 p.registerChatContext({ ...ctx, documentDir: join(dir, 'another-pdf'), dir: join(dir, 'another-pdf', 'discussions', 'foreign'), attachmentItem: { key: 'OTHERPDF' }, discussion: { id: 'foreign' } });
 p.exportReadingSource = async () => { throw new Error('Fast summaries must not open the PDF'); };
 let calls = 0;
 p.runBackend = async (_, request) => {
  calls++; assert.equal(request.effort, 'low'); assert.equal(request.summaryOnly, true);
  const data = inputData(request); assert.ok(data.records.some(record => record.id.startsWith('a:'))); assert.ok(data.records.some(record => record.id.startsWith('b:'))); assert.ok(data.records.some(record => record.id.startsWith('live:')));
  assert.ok(!data.records.some(record => record.id.startsWith('foreign:')));
  return { text: JSON.stringify({ points: [point(data.records.map(record => record.id), { originalNumber: '', body: 'All chapters and their open questions.' })] }) };
 };
 const result = await p.generateReadingExport(ctx, job);
 assert.equal(calls, 1); assert.match(result.markdown, /Chat 3.*Live topic/); assert.match(result.markdown, /all available conversations/);
 const cached = await p.generateReadingExport(ctx, { ...job }); assert.equal(cached.cached, true); assert.equal(calls, 1);
});

test('long exports reuse unchanged batches and consolidate all chapters in one final pass', async () => {
 const { p, ctx, histories, job } = await setup(); job.verifySource = false;
 histories.a[1].text = 'Long discussion. '.repeat(8000);
 const count = p.readingExportBatches((await p.collectReadingExport(ctx)).units, 48000).length; assert.ok(count > 1);
 p.exportReadingSource = async () => { throw new Error('No PDF needed'); };
 let calls = 0, previews = 0; job.onPreview = () => previews++;
 p.runBackend = async (_, request) => {
  calls++; const data = inputData(request), refs = data.records ? data.records.map(record => record.id) : [...new Set(data.points.flatMap(value => value.refs))];
  return { text: JSON.stringify({ points: [point(refs, { originalNumber: '', body: 'Combined discussion facts and caveats.' })] }) };
 };
 await p.generateReadingExport(ctx, job); assert.equal(calls, count + 1); assert.equal(previews, count);
 histories.b.push({ role: 'assistant', text: 'New correction appended to the last chapter.' });
 const before = calls; await p.generateReadingExport(ctx, { ...job }); assert.equal(calls - before, 2);
});

test('incomplete whole-book coverage is rejected rather than silently dropping another chat', async () => {
 const { p, ctx, job } = await setup(); job.verifySource = false;
 p.runBackend = async () => ({ text: JSON.stringify({ points: [point(['a:0:0'])] }) });
 await assert.rejects(p.generateReadingExport(ctx, job), /omitted part of the discussion/);
});

test('original PDF loading remains lazy even when optional verification is enabled', async () => {
 const { p, ctx, job } = await setup(); let opened = false;
 p.exportReadingSource = async () => { opened = true; throw new Error('Not needed'); };
 p.runBackend = async (_, request) => ({ text: JSON.stringify({ points: [point(inputData(request).records.map(record => record.id), { originalNumber: '' })] }) });
 await p.generateReadingExport(ctx, job); assert.equal(opened, false);
});
