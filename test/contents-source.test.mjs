import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlugin } from './load-plugin.mjs';

async function setup(pages, current = 0) {
 const { plugin: p, window } = loadPlugin();
 const root = await mkdtemp(join(tmpdir(), 'abstractin-contents-'));
 const dir = join(root, 'discussion'); await mkdir(dir);
 window.OS = { Path: { join }, File: { exists: async path => { try { await access(path); return true; } catch { return false; } } } };
 window.Zotero.File = { getContentsAsync: path => readFile(path, 'utf8'), putContentsAsync: writeFile };
 window.Zotero.PDFWorker = { getFullText() { throw new Error('Initialization must not extract the whole PDF'); } };
 const ctx = { dir, documentDir: root, discussion: { id: 'init' }, paperItem: { libraryID: 1 }, attachmentItem: { key: 'BOOK' }, reading: { type: 'book', action: 'contents' } };
 const reads = [];
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 1000 } });
 p.currentReadingLocation = () => ({ pageIndex: current });
 p.readNativeReadingPage = async (_, index) => { reads.push(index); return { text: pages[index] || 'Body text', pageIndex: index }; };
 await writeFile(join(root, 'source-text.md'), 'Existing complete source cache');
 return { p, ctx, root, dir, reads };
}

test('book initialization reads bounded front matter and complete contents continuations, preserving full cache', async () => {
 const pages = { 22: 'Contents\n1 Foundations .... 3', 23: '2 Methods .... 20', 24: '3 Results .... 40', 25: '4 Conclusions .... 60' };
 const { p, ctx, root, dir, reads } = await setup(pages);
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'ready'); assert.equal(source.scope, 'contents');
 assert.equal(source.totalPages, 1000); assert.equal(source.pageMapping, true);
 assert.ok(reads.length < 35); assert.ok(reads.includes(25));
 const text = await readFile(join(dir, 'source-text.md'), 'utf8');
 assert.match(text, /4 Conclusions/); assert.doesNotMatch(text, /Body text/);
 assert.match(text, /PDF page 25; pageIndex 24/);
 assert.equal(await readFile(join(root, 'source-text.md'), 'utf8'), 'Existing complete source cache');
 await assert.rejects(access(join(root, 'source.pdf')));
});

test('contents opened beyond front matter are discovered without scanning preceding chapters', async () => {
 const { p, ctx, dir, reads } = await setup({ 499: 'Contents\nAppendix A Proofs .... 700', 500: 'Appendix B Tables .... 800' }, 499);
 assert.equal((await p.exportReadingSource(ctx)).status, 'ready');
 assert.match(await readFile(join(dir, 'source-text.md'), 'utf8'), /Appendix B/);
 assert.ok(reads.length < 35); assert.ok(!reads.includes(250));
});

test('missing contents do not trigger a full-document fallback or replace source files', async () => {
 const { p, ctx, dir, reads } = await setup({});
 await writeFile(join(dir, 'source-text.md'), 'Previous source');
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'unavailable'); assert.match(source.error, /contents pages/i);
 assert.equal(await readFile(join(dir, 'source-text.md'), 'utf8'), 'Previous source');
 assert.ok(reads.length <= 24);
});

test('directory page detection never treats distant pages as adjacent continuations', () => {
 const { plugin: p } = loadPlugin();
 const plan = p.contentsSourcePlan('## PDF page 2; pageIndex 1\nContents\n1 First .... 3\n## PDF page 500; pageIndex 499\n2 Body references .... 80');
 assert.equal(plan.pages.length, 1);
});

test('contents bookmarks locate a distant directory without visiting chapter bodies', async () => {
 const { p, ctx, dir, reads } = await setup({ 100: 'Contents\n1 Foundations .... 200', 101: '2 Methods .... 300' });
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 1000, getOutline: async () => [{ title: 'Table of Contents', dest: 'toc' }], getDestination: async () => [100] } });
 assert.equal((await p.exportReadingSource(ctx)).status, 'ready');
 assert.match(await readFile(join(dir, 'source-text.md'), 'utf8'), /2 Methods/);
 assert.ok(reads.includes(100)); assert.ok(!reads.includes(50));
});

test('contents-only manifests can never masquerade as complete PDF caches', async () => {
 const { p, ctx, dir } = await setup({ 0: 'Contents\n1 Foundations .... 3' });
 const source = await p.exportReadingSource(ctx);
 await writeFile(join(dir, 'source.pdf'), 'An older PDF copy');
 assert.equal(await p.cachedReadingSource(ctx, source.signature), null);
});

test('a closed reader reuses an identity-checked full cache without extracting the PDF again', async () => {
 const { p, ctx, root, dir } = await setup({});
 p.readingPDFApplication = () => null;
 p.readingFileInfo = async () => ({ path: 'book.pdf', size: 100, modified: 1 });
 const signature = p.readingSourceSignature(ctx, await p.readingFileInfo());
 await writeFile(join(root, 'source-text.md'), '## PDF page 2; pageIndex 1\nContents\n1 Foundations .... 3');
 await writeFile(join(root, 'source.pdf'), 'Full PDF cache');
 await writeFile(join(root, 'source-manifest.json'), JSON.stringify({ status: 'ready', signature, totalPages: 1000, pageMapping: true }));
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'ready'); assert.equal(source.accessMethod, 'cached-contents');
 assert.match(await readFile(join(dir, 'source-text.md'), 'utf8'), /1 Foundations/);
});

test('a PDF with no bookmarks or page labels verifies chapter ranges from TOC numbers and actual headings', async () => {
 const { p, ctx, reads } = await setup({ 8: '1\nFoundations\nOpening text\n1', 18: '2 Methods\nOpening text\n11', 35: '3 Results\nOpening text\n28' });
 ctx.reading.pdfSource = { scope: 'contents' };
 ctx.reading.contentsPlan = { pages: [{ index: 1 }] };
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 1000, getOutline: async () => [], getPageLabels: async () => null } });
 const entries = [
  { id: 'ch-01', title: '1 Foundations', printedPageLabel: '1', pageIndex: null },
  { id: 'sec-01-01', title: '1.1 Sets', printedPageLabel: '2', pageIndex: null },
  { id: 'ch-02', title: '2 Methods', printedPageLabel: '11', pageIndex: null },
  { id: 'ch-03', title: '3 Results', printedPageLabel: '28', pageIndex: null }
 ];
 await p.verifyContentsChapterPages(ctx, entries);
 assert.deepEqual(entries.map(entry => entry.pageIndex), [8, null, 18, 35]);
 assert.ok(reads.length <= 26, 'only anchor search and individual chapter starts are read');
 p.readingArtifactNotes = () => [{}]; p.readingArtifactData = () => ({ entries }); p.readDiscussionJSON = async () => null;
 const index = { chapters: [] }; await p.refreshDiscussionChapters(ctx, index);
 assert.equal(p.chapterAtPage(index, 12), 'ch-01');
 assert.equal(p.chapterAtPage(index, 23), 'ch-02');
 assert.equal(p.chapterAtPage(index, 80), 'ch-03');
 assert.equal(index.chapters.length, 3, 'sections are not promoted to chapters');
});

test('inserted plates and wrong chapter headings never turn a proposed offset into a verified boundary', async () => {
 const { p, ctx } = await setup({ 8: '1 Foundations\nText\n1', 18: '1 Foundations\nText\n11', 35: '3 Results\nText\n27' });
 ctx.reading.pdfSource = { scope: 'contents' }; ctx.reading.contentsPlan = { pages: [{ index: 1 }] };
 const entries = [
  { id: 'ch-01', title: '1 Foundations', printedPageLabel: '1', pageIndex: null },
  { id: 'ch-02', title: '2 Methods', printedPageLabel: '11', pageIndex: null },
  { id: 'ch-03', title: '3 Results', printedPageLabel: '28', pageIndex: null }
 ];
 await p.verifyContentsChapterPages(ctx, entries);
 assert.deepEqual(entries.map(entry => entry.pageIndex), [8, null, null]);
});

test('PDF page labels locate chapters without bookmarks, still requiring matching headings', async () => {
 const { p, ctx } = await setup({ 100: '1 Foundations\nText', 700: 'Wrong heading' });
 ctx.reading.pdfSource = { scope: 'contents' }; ctx.reading.contentsPlan = { pages: [{ index: 1 }] };
 const labels = Array(1000).fill(''); labels[100] = '1'; labels[700] = '11';
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 1000, getOutline: async () => [], getPageLabels: async () => labels } });
 const entries = [{ id: 'ch-01', title: '1 Foundations', printedPageLabel: '1', pageIndex: null }, { id: 'ch-02', title: '2 Methods', printedPageLabel: '11', pageIndex: null }];
 await p.verifyContentsChapterPages(ctx, entries);
 assert.deepEqual(entries.map(entry => entry.pageIndex), [100, null]);
});
