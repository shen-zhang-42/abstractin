import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin } from "./load-plugin.mjs";

async function setup() {
	const { plugin: p, window } = loadPlugin();
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
	assert.equal((await p.ask(ctx, "Question", pending)).cancelled, true);
});
