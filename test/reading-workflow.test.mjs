import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin } from "./load-plugin.mjs";

async function setup(type = "book") {
	const env = loadPlugin({ prefs: { "extensions.abstractin.onboarded": true } });
	const { plugin: p, window, document } = env;
	const dir = await mkdtemp(join(tmpdir(), "abstractin-workflow-"));
	window.OS = { Path: { join }, File: { copy: copyFile, stat, exists: async path => { try { await access(path); return true; } catch { return false; } } } };
	window.Zotero.File = { createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }), getContentsAsync: path => readFile(path, "utf8"), putContentsAsync: writeFile };
	const notes = [];
	const parent = { id: 1, key: "ITEM", libraryID: 1, getNotes: () => notes.map(n => n.id), getField: () => "Test book", getCreators: () => [] };
	const path = join(dir, "original.pdf"); await writeFile(path, "%PDF test source");
	const attachment = { id: 7, key: "PDF-A", isPDFAttachment: () => true, getFilePathAsync: async () => path };
	const ctx = { dir, paperItem: parent, attachmentItem: attachment, reading: { type, skillPath: "/skill", pdfSource: { status: "ready", totalPages: 3, pageMapping: true, signature: "source-A" } } };
	window.Zotero.Items = { get: id => notes.find(n => n.id === id) };
	window.Zotero.Libraries = { get: () => ({ libraryType: "user" }) };
	window.Zotero.Item = class {
		constructor() { this.id = notes.length + 100; this.key = "NOTE" + this.id; this.tags = []; }
		setNote(text) { this.html = text; } getNote() { return this.html; }
		addTag(tag) { if (!this.tags.includes(tag)) this.tags.push(tag); } getTags() { return this.tags.map(tag => ({ tag })); }
		async saveTx() { if (!notes.includes(this)) notes.push(this); }
	};
	const body = document.createElement("div"); document.body.append(body); p.renderSkeleton(document, body);
	const root = body.querySelector(".zs-root");
	const view = { root, doc: document, ctx, input: root.querySelector(".zs-input"), logEl: root.querySelector(".zs-log") };
	p._views.set(root, view);
	await writeFile(join(dir, "source-text.md"), "## PDF page 1; pageIndex 0\nContents\n1 Foundations .... 3\n## PDF page 2; pageIndex 1\nPreface\n## PDF page 3; pageIndex 2\n1 Foundations\nArgument");
	const contents = { kind: "contents", coverage: "PDF page 1", entries: [{ id: "ch-01", title: "1 Foundations", evidence: "1 Foundations .... 3", printedPageLabel: "3", pageIndex: null }] };
	const response = "Verified chapter structure; no chapter summaries.\n<abstractin-workspace>" + JSON.stringify(contents) + "</abstractin-workspace>";
	return { ...env, notes, ctx, view, dir, contents, response };
}

test("contents initialize from source evidence as one Zotero note, with derived chapter folders", async () => {
	const { plugin, ctx, notes, response, dir } = await setup();
	const result = await plugin.saveReadingAction(ctx, "contents", response);
	assert.equal(result.key, notes[0].key);
	assert.equal(notes.length, 1);
	assert.ok(notes[0].tags.includes("AbstractIn:Contents"));
	assert.ok(!result.answer.includes("abstractin-workspace"));
	assert.ok((await stat(join(dir, "chapters", "ch-01"))).isDirectory());
	assert.match(await readFile(join(dir, "workspace.md"), "utf8"), /1 Foundations/);
	await plugin.saveReadingAction(ctx, "contents", response);
	assert.equal(notes.length, 1, "updates preserve one authoritative contents note");
});

test("contents reject invented evidence, invalid paths and guessed PDF page locations", async () => {
	const { plugin: p, ctx, contents, notes } = await setup();
	for (const patch of [{ evidence: "Unseen chapter" }, { id: "../escape" }, { pageIndex: 19 }, { pageIndex: 1.5 }]) {
		let data = { ...contents, entries: [{ ...contents.entries[0], ...patch }] };
		await assert.rejects(p.saveReadingAction(ctx, "contents", "Answer\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>"));
	}
	assert.equal(notes.length, 0);
});

test("paper summary choices require a click; update and view reuse the same editable note", async () => {
	const { plugin: p, ctx, view, notes, dir } = await setup("paper");
	let requests = []; p.startRequest = (...args) => requests.push(args);
	p.openReadingWorkspace(view);
	assert.equal(requests.length, 0);
	view.root.querySelector(".zs-workspace-actions button").click();
	assert.equal(requests[0][4].readingAction, "summary");
	let text = '## Research question\nA tested hypothesis with $x$.\n<abstractin-workspace>{"kind":"summary","coverage":"All 3 PDF pages"}</abstractin-workspace>';
	await p.saveReadingAction(ctx, "summary", text);
	await p.saveReadingAction(ctx, "summary", text.replace("A tested", "An updated"));
	assert.equal(notes.length, 1);
	assert.ok(notes[0].tags.includes("AbstractIn:Summary"));
	notes[0].html = notes[0].html.replace("updated", "corrected");
	await p.exportReadingWorkspace(ctx);
	assert.match(await readFile(join(dir, "workspace.md"), "utf8"), /corrected/);
	p.openReadingWorkspace(view);
	assert.match(view.root.textContent, /View summary/);
	assert.match(view.root.textContent, /Update summary/);
	view.root.querySelector(".zs-workspace-actions button").click();
	assert.ok(view.root.querySelector(".zs-workspace-view math"));
});

test("reference navigation preserves genuine position and Return restores it", async () => {
	const { plugin: p, ctx, view, window, notes } = await setup();
	let current = 5, navigations = [];
	ctx.reading.pdfSource.totalPages = 20;
	window.Zotero.Reader = { _readers: [{ itemID: 7, type: "pdf", navigate: async ({ pageIndex }) => { current = pageIndex + 1; navigations.push(pageIndex); },
		_internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: { get currentPageNumber() { return current; }, getPageView: () => ({ pageLabel: "iv" }) } } } } } }] };
	await p.navigateReading(view, { pageIndex: 9 });
	assert.equal(p.readingArtifactData(notes[0]).pageIndex, 4);
	await p.rememberReadingPosition(ctx);
	assert.equal(p.readingArtifactData(notes[0]).pageIndex, 4, "reference position never overwrites genuine position");
	await p.returnToReading(view);
	assert.deepEqual(navigations, [9, 4]);
	assert.equal(ctx.reading.referenceNavigation, false);
});

test("first book Start initializes structure; subsequent Start restores position and recaps instead", async () => {
	const { plugin: p, ctx, view, response, window } = await setup();
	let requests = [];
	p.startRequest = (...args) => requests.push(args);
	await p.beginReadingWorkflow(view);
	assert.equal(requests[0][4].readingAction, "contents");
	await p.saveReadingAction(ctx, "contents", response);
	await p.saveReadingArtifact(ctx, "Position", "Reading position", "Last location", { kind: "position", pageIndex: 2, pageLabel: "1" });
	let restored;
	window.Zotero.Reader = { _readers: [{ itemID: 7, type: "pdf", navigate: async position => { restored = position.pageIndex; } }] };
	await p.beginReadingWorkflow(view);
	assert.equal(restored, 2);
	assert.equal(requests.length, 1);
	assert.match(view.root.textContent, /Previous discussions and open questions/);
});

test("records merge a follow-up within the same verified scope and attachment", async () => {
	const { plugin: p, ctx, response, notes } = await setup();
	await p.saveReadingAction(ctx, "contents", response);
	let record = { title: "Proof", summary: "Original conclusion", openQuestions: ["Why?"], topicKey: "proof-topic", scope: { level: "chapter", id: "ch-01", title: "Foundations" } };
	let first = await p.saveReadingRecord(ctx, "Question", null, record);
	let next = await p.saveReadingRecord(ctx, "Follow-up", null, { ...record, summary: "Corrected merged conclusion", openQuestions: [] });
	assert.equal(first, next);
	assert.equal(notes.length, 2);
	assert.match(notes[1].getNote(), /Corrected merged conclusion/);
	assert.ok(!notes[1].getNote().includes("Original conclusion"));
	await assert.rejects(p.saveReadingRecord(ctx, "Unverified section", null, { ...record, scope: { level: "section", id: "missing", title: "Missing" } }), /not been verified/);
});

test("summary transport passes local PDF text and saves a summary without a second discussion note", async () => {
	const { plugin: p, window, ctx, notes } = await setup("paper");
	p.prepareReadingSkills = async ctx => ctx.reading;
	window.Zotero.PDFWorker = { getFullText: async () => ({ text: "Title\fMethod\fResult", extractedPages: 3, totalPages: 3 }) };
	p.runBackend = async (backend, request) => {
		assert.match(request.question, /Use initial read mode/);
		assert.match(request.question, /source-text.md/);
		assert.match(request.question, /approved creating or updating/);
		return { text: '## Research question\nA summary $x$.\n<abstractin-workspace>{"kind":"summary","coverage":"PDF pages 1–3"}</abstractin-workspace>', sessionId: "new" };
	};
	const result = await p.ask(ctx, "Summarize", { backend: "codex", readingAction: "summary", progress() {} });
	assert.equal(result.error, undefined);
	assert.equal(result.recordKey, notes[0].key);
	assert.equal(notes.length, 1);
	assert.ok(notes[0].tags.includes("AbstractIn:Summary"));
	assert.ok(!(await p.loadHistory(ctx.dir))[1].text.includes("abstractin-workspace"));
});

test("retrieved source quotes must match their physical PDF page before a record is saved", async () => {
	const { plugin: p, ctx, notes } = await setup();
	const record = { title: "A verified argument", summary: "An explanation", openQuestions: [],
		sources: [{ pageIndex: 2, printedPageLabel: null, quote: "1 Foundations" }] };
	await p.saveReadingRecord(ctx, "Why?", null, record);
	assert.match(notes[0].getNote(), /PDF-A\?page=3/);
	await assert.rejects(p.saveReadingRecord(ctx, "Wrong page", null, { ...record, sources: [{ ...record.sources[0], pageIndex: 1 }] }), /could not be verified/);
	assert.equal(notes.length, 1);
});

test("contents links require a chapter heading verified on the target physical page", async () => {
	const { plugin: p, ctx, contents } = await setup();
	let data = { ...contents, entries: [{ ...contents.entries[0], pageIndex: 1 }] };
	await assert.rejects(p.saveReadingAction(ctx, "contents", "Contents\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>"), /heading was not verified/);
	data.entries[0].pageIndex = 2;
	assert.ok((await p.saveReadingAction(ctx, "contents", "Contents\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>")).key);
});

test("changed source starts a new agent thread and unnamed questions receive the current page", async () => {
	const { plugin: p, window, ctx } = await setup();
	p.prepareReadingSkills = async ctx => ctx.reading;
	p.loadSessions = async () => ({ codex: { id: "old", model: "", sourceSignature: "old-pdf" } });
	window.Zotero.PDFWorker = { getFullText: async () => ({ text: "Title\fContents\fCurrent page argument", extractedPages: 3, totalPages: 3 }) };
	window.Zotero.Reader = { _readers: [{ itemID: 7, type: "pdf", _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: { currentPageNumber: 3, getPageView: () => ({ pageLabel: "1" }) } } } } } }] };
	p.runBackend = async (backend, request) => {
		assert.equal(request.session, null);
		assert.match(request.question, /Current page argument/);
		assert.match(request.question, /pdfPageIndex|pageIndex/);
		return { text: 'Explained.\n<abstractin-record>{"title":"Argument","summary":"A verified point","openQuestions":[]}</abstractin-record>' };
	};
	assert.equal((await p.ask(ctx, "Explain this", { backend: "codex", model: "", progress() {} })).error, undefined);
});

test("page tracking releases event listeners and does not replace position during references", async () => {
	const { plugin: p, ctx, view, window } = await setup();
	let callback, removed = false, timer;
	window.setTimeout = fn => { timer = fn; return 1; }; window.clearTimeout = () => {};
	window.Zotero.Reader = { _readers: [{ itemID: 7, type: "pdf", _internalReader: { _primaryView: { _iframeWindow: {
		PDFViewerApplication: { eventBus: { on: (type, fn) => { callback = fn; }, off: (type, fn) => { removed = fn === callback; } } },
	} } } }] };
	let writes = 0; p.rememberReadingPosition = async () => { writes++; };
	p.trackReadingPosition(view);
	callback(); timer(); assert.equal(writes, 1);
	ctx.reading.referenceNavigation = true; callback(); timer(); assert.equal(writes, 1);
	p.stopReadingPositionTracking(); assert.ok(removed);
});

test("saved summary view preserves display equations and tables", async () => {
	const { plugin: p, ctx, view } = await setup("paper");
	await p.saveReadingAction(ctx, "summary", '## Result\n\n$$x^2=1$$\n\n| Measure | Result |\n|---|---|\n| Test | $x$ |\n<abstractin-workspace>{"kind":"summary","coverage":"PDF pages 1–3"}</abstractin-workspace>');
	p.openReadingWorkspace(view);
	view.root.querySelector(".zs-workspace-actions button").click();
	assert.equal(view.root.querySelectorAll(".zs-workspace-view math").length, 2);
	assert.ok(view.root.querySelector(".zs-workspace-view table"));
	assert.ok(!view.root.querySelector(".zs-workspace-view").textContent.includes("abstractin-workspace-v1"));
});
