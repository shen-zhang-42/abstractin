import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin } from "./load-plugin.mjs";

async function setup() {
	const { plugin: p, window } = loadPlugin({ prefs: { "extensions.abstractin.readingEvidenceMode": "source" } });
	const root = await mkdtemp(join(tmpdir(), "abstractin-pdf-"));
	const path = join(root, "original.pdf");
	await writeFile(path, "%PDF-1.7 test source");
	window.OS = { Path: { join }, File: { copy: copyFile, stat, exists: async path => { try { await access(path); return true; } catch { return false; } } } };
	window.Zotero.File = { createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }), getContentsAsync: path => readFile(path, "utf8"), putContentsAsync: writeFile };
	const dir = join(root, "reading-A"); await mkdir(dir);
	const ctx = { dir, reading: { type: "book" }, paperItem: { libraryID: 1, key: "ITEM" },
		attachmentItem: { id: 7, key: "PDF-A", isPDFAttachment: () => true, getFilePathAsync: async () => path } };
	return { p, window, ctx, path };
}

test("PDF source exports the exact attachment, every page and a searchable text file; unchanged files reuse cache", async () => {
	const { p, window, ctx, path } = await setup();
	let calls = 0;
	window.Zotero.PDFWorker = { getFullText: async (id, maxPages) => {
		calls++; assert.equal(id, 7); assert.equal(maxPages, null);
		return { text: "Title\fContents: Chapter 1 ... 3\fChapter 1\nOriginal argument", extractedPages: 3, totalPages: 3 };
	} };
	let source = await p.exportReadingSource(ctx);
	assert.equal(source.status, "ready");
	assert.equal(source.pageMapping, true);
	assert.equal(await readFile(join(ctx.dir, "source.pdf"), "utf8"), await readFile(path, "utf8"));
	let text = await readFile(join(ctx.dir, "source-text.md"), "utf8");
	assert.match(text, /PDF page 2; pageIndex 1/);
	assert.match(text, /Original argument/);
	assert.ok(!text.includes("Printed page: 2"));
	await p.exportReadingSource(ctx); assert.equal(calls, 1);
	await writeFile(path, "%PDF-1.7 updated source longer");
	await p.exportReadingSource(ctx); assert.equal(calls, 2);
});

test("missing files, scans and extractor errors are reported; failed extraction can be retried", async () => {
	const { p, window, ctx } = await setup();
	window.Zotero.PDFWorker = { getFullText: async () => ({ text: "", extractedPages: 2, totalPages: 2 }) };
	assert.match((await p.exportReadingSource(ctx)).error, /OCR/);
	window.Zotero.PDFWorker.getFullText = async () => { throw new Error("Password required"); };
	assert.match((await p.exportReadingSource(ctx)).error, /Password required/);
	window.Zotero.PDFWorker.getFullText = async () => ({ text: "Recovered text", extractedPages: 1, totalPages: 1 });
	assert.equal((await p.exportReadingSource(ctx)).status, "ready");
	ctx.attachmentItem.getFilePathAsync = async () => false;
	assert.match((await p.exportReadingSource(ctx)).error, /download/i);
});

test("ambiguous page boundaries are never assigned invented page numbers", async () => {
	const { p, window, ctx } = await setup();
	window.Zotero.PDFWorker = { getFullText: async () => ({ text: "Text after blank pages", extractedPages: 3, totalPages: 3 }) };
	const source = await p.exportReadingSource(ctx);
	assert.equal(source.pageMapping, false);
	assert.ok(!(await readFile(join(ctx.dir, "source-text.md"), "utf8")).includes("pageIndex 0"));
});

test("reading prompts require source verification and permit requested summaries", () => {
	const { plugin: p } = loadPlugin();
	const ctx = { reading: { type: "book", skillPath: "/skill", pdfSource: { status: "ready", totalPages: 3 } }, paperItem: {}, attachmentItem: {} };
	const prompt = p.readingPrompt(ctx);
	assert.match(prompt, /source-text.md/);
	assert.match(prompt, /Read the requested portions/);
	assert.match(prompt, /Do not claim/);
});

test("missing PDFs block general questions before Codex runs; selected passages remain usable with a warning", async () => {
	const { p, ctx } = await setup();
	p.prepareReadingSkills = async ctx => ctx.reading;
	p.exportContext = async () => ({});
	p.exportReadingRecords = async () => {};
	p.exportReadingWorkspace = async () => {};
	p.loadHistory = async () => [];
	p.loadSessions = async () => ({});
	p.appendHistory = async () => {};
	p.appendClarification = async () => {};
	p.saveReadingRecord = async () => "NOTE";
	ctx.attachmentItem.getFilePathAsync = async () => false;
	let runs = 0;
	p.runBackend = async (backend, request) => {
		runs++; assert.match(request.question, /unavailable/);
		return { text: 'Answer from the selected passage.\n<abstractin-record>{"title":"Passage","summary":"Local conclusion","openQuestions":[]}</abstractin-record>' };
	};
	let result = await p.ask(ctx, "Summarize this book", { backend: "codex", progress() {} });
	assert.match(result.error, /Download/); assert.equal(runs, 0);
	result = await p.ask(ctx, "Explain this passage", { backend: "codex", progress() {}, selection: { attachmentID: 7, text: "An explicit passage" } });
	assert.equal(runs, 1); assert.match(result.sourceWarning, /only the supplied passage/);
});

test("Stop during PDF extraction prevents agent execution", async () => {
	const { p, window, ctx } = await setup();
	p.prepareReadingSkills = async ctx => ctx.reading;
	p.exportContext = async () => ({});
	let pending = { backend: "codex", progress() {} };
	window.Zotero.PDFWorker = { getFullText: async () => { pending.cancelled = true; return { text: "Text", extractedPages: 1, totalPages: 1 }; } };
	p.runBackend = async () => { throw new Error("Must not launch after Stop"); };
	assert.equal((await p.ask(ctx, "Explain the argument", pending)).cancelled, true);
});

test("live page extraction preserves physical indices despite unverified full-text boundaries and caches per PDF", async () => {
 const { p, window, ctx } = await setup();
 let calls = 0;
 const pdf = { numPages: 9, getPage: async n => { calls++; assert.equal(n, 5); return { getTextContent: async () => ({ items: [{ str: 'Current equation', hasEOL: true }, { str: 'Verified argument' }] }) }; } };
 const app = { pdfDocument: pdf, pdfViewer: { currentPageNumber: 5, getPageView: () => ({ pageLabel: '1' }) } };
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: app } } } }] };
 ctx.reading.pdfSource = { status: 'ready', pageMapping: false };
 const page = await p.readNativeReadingPage(ctx, 4);
 assert.equal(page.pageIndex, 4); assert.match(page.text, /Current equation\nVerified argument/);
 await p.readNativeReadingPage(ctx, 4); assert.equal(calls, 1);
 app.pdfDocument = { ...pdf }; await p.readNativeReadingPage(ctx, 4); assert.equal(calls, 2);
 await assert.rejects(p.readNativeReadingPage(ctx, 9), /outside/);
});

test("blank-cover boundaries recover only when native edge pages and full extraction agree", async () => {
 const { p, window, ctx } = await setup();
 window.Zotero.PDFWorker = { getFullText: async () => ({ text: 'Contents\fChapter argument', extractedPages: 4, totalPages: 4 }) };
 let native = ['', 'Contents', 'Chapter argument', ''];
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: { numPages: 4, getPage: async n => ({ getTextContent: async () => ({ items: [{ str: native[n - 1] }] }) }) } } } } } }] };
 let source = await p.exportReadingSource(ctx);
 source = await p.recoverReadingPageMapping(ctx, source);
 assert.equal(source.pageMapping, true);
 let text = await readFile(join(ctx.dir, 'source-text.md'), 'utf8');
 assert.match(p.pdfPageText(text, 0), /No extractable text/);
 assert.match(p.pdfPageText(text, 1), /Contents/);
 assert.match(p.pdfPageText(text, 2), /Chapter argument/);
 assert.equal(JSON.parse(await readFile(join(ctx.dir, 'source-manifest.json'), 'utf8')).pageMapping, true);
});

test("a disagreement with the reader never repairs page offsets", async () => {
 const { p, window, ctx } = await setup();
 window.Zotero.PDFWorker = { getFullText: async () => ({ text: 'Old text', extractedPages: 2, totalPages: 2 }) };
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: { numPages: 2, getPage: async n => ({ getTextContent: async () => ({ items: [{ str: n === 1 ? '' : 'Changed text' }] }) }) } } } } } }] };
 assert.equal((await p.recoverReadingPageMapping(ctx, await p.exportReadingSource(ctx))).pageMapping, false);
});

async function attachLoadedPDF(window, ctx, { texts = ['Reader first page', 'Reader second page'], bytes = new TextEncoder().encode('%PDF-reader-snapshot'), itemID = ctx.attachmentItem.id } = {}) {
 const { webcrypto } = await import('node:crypto');
 Object.defineProperty(window, 'crypto', { value: webcrypto });
 let pageReads = 0, byteReads = 0;
 const pdf = { numPages: texts.length, getData: async () => { byteReads++; return bytes; }, getPage: async number => {
  pageReads++; return { getTextContent: async () => ({ items: [{ str: texts[number - 1], hasEOL: true }] }) };
 } };
 ctx.reader = { itemID, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: pdf } } } } };
 window.OS.File.writeAtomic = async (path, data) => writeFile(path, data);
 return { pdf, get pageReads() { return pageReads; }, get byteReads() { return byteReads; } };
}

async function modernFiles(window) {
 window.IOUtils = {
  stat: async path => { const s = await stat(path); return { size: s.size, lastModified: s.mtimeMs }; },
  exists: window.OS.File.exists, copy: copyFile, read: readFile, write: (path, bytes) => writeFile(path, bytes),
 };
}

test('externally managed linked PDF with spaces and Unicode uses resolved path and modern file access', async () => {
 const { p, window, ctx, path } = await setup();
 const folder = join(ctx.dir, '..', 'Dropbox', '我的书库 A'); await mkdir(folder, { recursive: true });
 const linked = join(folder, 'Probability (第一章).pdf'); await copyFile(path, linked);
 ctx.attachmentItem.attachmentPath = 'attachments:我的书库 A/Probability (第一章).pdf';
 ctx.attachmentItem.getFilePathAsync = async () => false;
 ctx.attachmentItem.getFilePath = () => linked;
 await modernFiles(window);
 window.OS.File.copy = window.OS.File.stat = window.OS.File.exists = async () => { throw new Error('Legacy file access denied'); };
 window.Zotero.PDFWorker = { getFullText: async () => ({ text: 'Linked PDF original text', extractedPages: 1, totalPages: 1 }) };
 const before = await readFile(linked);
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'ready'); assert.equal(source.accessMethod, 'file');
 assert.ok(source.signature.includes('Probability (第一章).pdf'));
 assert.deepEqual(await readFile(join(ctx.dir, 'source.pdf')), before);
 assert.deepEqual(await readFile(linked), before); assert.ok(ctx.attachmentItem.attachmentPath.startsWith('attachments:'));
});

test('cloud copy failure can read bytes and keep the original linked PDF untouched', async () => {
 const { p, window, ctx, path } = await setup(); await modernFiles(window);
 window.IOUtils.copy = async () => { throw new Error('Cloud placeholder copy failed'); };
 window.Zotero.PDFWorker = { getFullText: async () => ({ text: 'Hydrated text', extractedPages: 1, totalPages: 1 }) };
 assert.equal((await p.exportReadingSource(ctx)).status, 'ready');
 assert.deepEqual(await readFile(join(ctx.dir, 'source.pdf')), await readFile(path));
});

test('exact open reader supplies bytes and every physical page when the filesystem path is unavailable', async () => {
 const { p, window, ctx } = await setup(); ctx.attachmentItem.getFilePathAsync = async () => false;
 const loaded = await attachLoadedPDF(window, ctx);
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'ready'); assert.equal(source.accessMethod, 'reader-snapshot'); assert.equal(source.pageMapping, true);
 assert.equal(source.totalPages, 2); assert.equal(loaded.pageReads, 2);
 assert.equal(await readFile(join(ctx.dir, 'source.pdf'), 'utf8'), '%PDF-reader-snapshot');
 assert.match(await readFile(join(ctx.dir, 'source-text.md'), 'utf8'), /PDF page 2; pageIndex 1\n\nReader second page/);
 await p.exportReadingSource(ctx); assert.equal(loaded.pageReads, 2, 'identical bytes reuse a complete reader cache');
 loaded.pdf.getData = async () => new TextEncoder().encode('%PDF-reader-new-revision');
 await p.exportReadingSource(ctx); assert.equal(loaded.pageReads, 4, 'different bytes invalidate reader cache');
 ctx.reading.pdfSource = source;
 assert.match(p.readingPrompt(ctx), /currently loaded in Zotero/);
});

test('PDFWorker failure uses the matching loaded PDF, never another open attachment', async () => {
 const { p, window, ctx } = await setup(); await attachLoadedPDF(window, ctx);
 window.Zotero.PDFWorker = { getFullText: async () => { throw new Error('Linked source is temporarily locked'); } };
 assert.equal((await p.exportReadingSource(ctx)).accessMethod, 'reader-snapshot');
 const wrong = await attachLoadedPDF(window, ctx, { itemID: 999 });
 ctx.attachmentItem.getFilePathAsync = async () => false;
 const failed = await p.exportReadingSource(ctx);
 assert.equal(failed.status, 'unavailable'); assert.equal(wrong.byteReads, 0);
 assert.match(failed.error, /Open the selected PDF/);
});

test('incomplete reader extraction cannot create a ready manifest and can be retried', async () => {
 const { p, window, ctx } = await setup(); ctx.attachmentItem.getFilePathAsync = async () => false;
 const loaded = await attachLoadedPDF(window, ctx), getPage = loaded.pdf.getPage;
 loaded.pdf.getPage = async n => { if (n === 2) throw new Error('Page unavailable'); return getPage(n); };
 assert.equal((await p.exportReadingSource(ctx)).status, 'unavailable');
 await assert.rejects(readFile(join(ctx.dir, 'source-manifest.json')));
 loaded.pdf.getPage = getPage; assert.equal((await p.exportReadingSource(ctx)).status, 'ready');
});

test('a changed disk file is not silently replaced by a potentially older reader snapshot', async () => {
 const { p, window, ctx, path } = await setup(); const loaded = await attachLoadedPDF(window, ctx);
 window.Zotero.PDFWorker = { getFullText: async () => { await writeFile(path, '%PDF-changed-during-extraction'); return { text: 'Old text', extractedPages: 1, totalPages: 1 }; } };
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'unavailable'); assert.match(source.error, /changed during extraction/); assert.equal(loaded.byteReads, 0);
});

test('workspace permission failures are identified separately from original attachment access', async () => {
 const { p, window, ctx } = await setup(); let paths = 0;
 ctx.attachmentItem.getFilePathAsync = async () => { paths++; return false; };
 window.Zotero.File.createDirectoryIfMissingAsync = async () => { throw new Error('Access denied'); };
 const source = await p.exportReadingSource(ctx);
 assert.match(source.error, /prepare reading workspace/); assert.ok(source.error.includes(ctx.dir)); assert.equal(paths, 0);
});

test('knowledge identity does not read an open PDF when source access was not requested', async () => {
 const { p, window, ctx } = await setup(); const loaded = await attachLoadedPDF(window, ctx);
 ctx.attachmentItem.getFilePathAsync = async () => false;
 assert.equal((await p.knowledgeReadingSource(ctx)).status, 'context-only'); assert.equal(loaded.byteReads, 0); assert.equal(loaded.pageReads, 0);
});

test('a linked paper discussion can use the exact reader snapshot without a selected page when cloud path access fails', async () => {
 const { p, window, ctx } = await setup();
 ctx.documentDir = ctx.dir; ctx.dir = join(ctx.dir, 'discussions', 'paper'); await mkdir(ctx.dir, { recursive: true });
 ctx.discussion = { id: 'paper' }; ctx.reading = { type: 'paper', action: 'discuss', evidenceMode: 'source', currentPage: null };
 ctx.attachmentItem.getFilePathAsync = async () => false;
 await attachLoadedPDF(window, ctx, { texts: ['Paper abstract and research problem.', 'Experimental evidence and conclusion.'] });
 const source = await p.exportReadingSource(ctx);
 assert.equal(source.status, 'ready'); assert.equal(source.accessMethod, 'reader-snapshot'); assert.equal(source.scoped, true);
 assert.deepEqual(Array.from(source.allowedPages), [0, 1]);
 const text = await readFile(join(ctx.dir, 'source-text.md'), 'utf8');
 assert.match(text, /Paper abstract/); assert.match(text, /Experimental evidence/);
 assert.equal(await window.OS.File.exists(join(ctx.dir, 'source.pdf')), false);
 assert.equal(await window.OS.File.exists(join(ctx.documentDir, 'source.pdf')), true);
});
