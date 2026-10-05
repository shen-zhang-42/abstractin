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

test("contents reject entirely invented evidence without creating a note", async () => {
	const { plugin: p, ctx, contents, notes } = await setup();
	for (const patch of [{ title: "Unseen chapter", evidence: "Unseen chapter" }]) {
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
	const unverified = { ...record, scope: { level: "section", id: "missing", title: "Missing" } };
	await p.saveReadingRecord(ctx, "Unverified section", null, unverified);
	assert.match(unverified.saveNotice, /scope/);
	assert.match(notes[2].getNote(), /Scope: book; id: /);
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
	const wrong = { ...record, sources: [{ ...record.sources[0], pageIndex: 1 }] };
	await p.saveReadingRecord(ctx, "Wrong page", null, wrong);
	assert.equal(notes.length, 2);
	assert.match(wrong.saveNotice, /page/);
	assert.ok(!notes[1].getNote().includes("?page="));
	assert.match(notes[1].getNote(), /1 Foundations/);
});

test("discussion records save when page mapping is unavailable and omit fabricated excerpts", async () => {
	const { plugin: p, ctx, notes } = await setup();
	ctx.reading.pdfSource.pageMapping = false;
	const record = { title: "An explanation", summary: "The conclusion is preserved.", openQuestions: ["Check the condition"],
		sources: [{ pageIndex: 2, printedPageLabel: "1", quote: "1 Foundations" }, { pageIndex: 19, quote: "Imaginary source passage" }] };
	const key = await p.saveReadingRecord(ctx, "Why?", null, record);
	assert.equal(key, notes[0].key);
	assert.match(notes[0].getNote(), /The conclusion is preserved/);
	assert.match(notes[0].getNote(), /1 Foundations/);
	assert.ok(!notes[0].getNote().includes("Imaginary source passage"));
	assert.ok(!notes[0].getNote().includes("?page="));
	assert.match(record.saveNotice, /unverified/);
});

test("a discussion with ambiguous PDF page boundaries saves through ask and returns an informational notice", async () => {
	const { plugin: p, window, ctx, notes } = await setup();
	p.prepareReadingSkills = async ctx => ctx.reading;
	window.Zotero.PDFWorker = { getFullText: async () => ({ text: "Foundations\fArgument", extractedPages: 3, totalPages: 3 }) };
	p.runBackend = async () => ({ text: 'A useful answer.\n<abstractin-record>```json\n' + JSON.stringify({
		title: "An argument", summary: "The recorded conclusion.", openQuestions: [], sources: [{ pageIndex: 2, quote: "Argument" }],
	}) + '\n```</abstractin-record>\nFinished.', sessionId: "discussion" });
	const result = await p.ask(ctx, "Why?", { backend: "codex", progress() {} });
	assert.equal(result.recordWarning, undefined);
	assert.equal(result.recordKey, notes[0].key);
	assert.match(result.recordNotice, /unverified/);
	assert.match(notes[0].getNote(), /The recorded conclusion/);
	assert.ok(!notes[0].getNote().includes("?page="));
	assert.equal((await p.loadHistory(ctx.dir))[1].recordNotice, result.recordNotice);
});

test("contents initialization reads a bounded excerpt in a fresh context and saves without chapter page scans", async () => {
	const { plugin: p, window, ctx, notes, dir } = await setup();
	p.prepareReadingSkills = async ctx => ctx.reading;
	p.loadSessions = async () => ({ codex: { id: "old", model: "", sourceSignature: "old" } });
	window.Zotero.PDFWorker = { getFullText: async () => ({ text: "Contents\n1 Foundations .... 3\fPreface\f1 Foundations\nArgument", extractedPages: 3, totalPages: 3 }) };
	p.runBackend = async (backend, request) => {
		assert.equal(request.session, null);
		assert.equal(request.history.length, 0);
		assert.ok(!request.question.includes("append exactly one <abstractin-record>"));
		assert.match(request.question, /set every pageIndex to null/);
		assert.match(await readFile(join(dir, "contents-source.md"), "utf8"), /Contents/);
		return { text: 'Structure initialized.\n<abstractin-workspace>' + JSON.stringify({ kind: "contents", coverage: "Actual contents", entries: [
			{ title: "1 Foundations", evidence: "1 Foundations ... 3", printedPageLabel: "3" },
		] }) + '</abstractin-workspace>', sessionId: "contents" };
	};
	const result = await p.ask(ctx, "Initialize", { backend: "codex", readingAction: "contents", progress() {} });
	assert.equal(result.recordWarning, undefined);
	assert.equal(result.recordKey, notes[0].key);
	assert.equal(p.readingArtifactData(notes[0]).entries[0].pageIndex, null);
	assert.match((await p.loadHistory(ctx.dir))[1].text, /1 Foundations/);
});

test("contents links require a chapter heading verified on the target physical page", async () => {
	const { plugin: p, ctx, contents, notes } = await setup();
	let data = { ...contents, entries: [{ ...contents.entries[0], pageIndex: 1 }] };
	const saved = await p.saveReadingAction(ctx, "contents", "Contents\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>");
	assert.match(saved.notice, /page/);
	assert.equal(p.readingArtifactData(notes[0]).entries[0].pageIndex, null);
	data.entries[0].pageIndex = 2;
	assert.ok((await p.saveReadingAction(ctx, "contents", "Contents\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>")).key);
});

test("one bad entry does not discard verified contents; identifiers are plugin-owned and stable", async () => {
	const { plugin: p, ctx, contents, notes } = await setup();
	const data = { ...contents, entries: [
		{ title: "1 Foundations", printedPageLabel: "3", evidence: "1 Foundations ... 3", id: "../escape" },
		{ title: "Invented appendix", evidence: "Never in this PDF" },
	] };
	const response = 'Claimed complete directory.\n<abstractin-workspace>```json\n' + JSON.stringify(data) + '\n```</abstractin-workspace>\nDone.';
	const saved = await p.saveReadingAction(ctx, "contents", response);
	assert.match(saved.notice, /1.*unverified/);
	let actual = p.readingArtifactData(notes[0]);
	assert.equal(actual.entries.length, 1);
	assert.match(actual.entries[0].id, /^[a-z0-9-]+$/);
	assert.equal(actual.entries[0].pageIndex, null);
	assert.equal(actual.entries[0].evidence, "1 Foundations .... 3", "recover an exact excerpt from actual contents");
	assert.match(saved.answer, /1 Foundations/);
	assert.ok(!saved.answer.includes("Claimed complete"));
	const stable = actual.entries[0].id;
	data.entries[0].id = "a-different-model-id";
	await p.saveReadingAction(ctx, "contents", "Updated\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>");
	assert.equal(p.readingArtifactData(notes[0]).entries[0].id, stable);
	assert.equal(notes.length, 1);
});

test("unverified page hints retain structural contents and never create guessed links", async () => {
	const { plugin: p, ctx, contents, notes } = await setup();
	ctx.reading.pdfSource.pageMapping = false;
	for (let pageIndex of [19, 1.5, 0]) {
		let data = { ...contents, entries: [{ ...contents.entries[0], pageIndex }] };
		const saved = await p.saveReadingAction(ctx, "contents", "Contents\n<abstractin-workspace>" + JSON.stringify(data) + "</abstractin-workspace>");
		assert.ok(saved.key);
		assert.equal(p.readingArtifactData(notes[0]).entries[0].pageIndex, null);
	}
});

test("a failed automatic initialization does not run again after another Start or plugin restart", async () => {
	const { plugin: p, ctx, view, dir } = await setup();
	let requests = [];
	p.startRequest = (...args) => requests.push(args);
	await p.beginReadingWorkflow(view);
	await p.beginReadingWorkflow(view);
	assert.equal(requests.length, 1);
	assert.match(view.root.textContent, /not saved/);
	const attempt = JSON.parse(await readFile(join(dir, "contents-auto-attempt.json"), "utf8"));
	assert.equal(attempt.attachmentKey, ctx.attachmentItem.key);
	delete ctx.reading.contentsAttempted;
	await p.beginReadingWorkflow(view);
	assert.equal(requests.length, 1);
	const retry = [...view.root.querySelectorAll("button")].find(n => n.textContent === "Initialize contents");
	retry.click();
	assert.equal(requests.length, 2, "a user can retry explicitly or go straight to questions");
});

test("contents preparation supplies a bounded exact source excerpt and avoids chapter scans", async () => {
	const { plugin: p, ctx, dir } = await setup();
	await p.prepareContentsSource(ctx);
	assert.match(await readFile(join(dir, "contents-source.md"), "utf8"), /Contents\n1 Foundations/);
	ctx.reading.action = "contents";
	const prompt = p.readingPrompt(ctx) + p.readingActionPrompt(ctx, "contents");
	assert.match(prompt, /contents-source.md/);
	assert.match(prompt, /pageIndex.*null/);
	assert.ok(!prompt.includes("append exactly one <abstractin-record>"));
	assert.ok(!prompt.includes("inspect the actual contents and chapter openings"));
});

test("failure to refresh a derived cache after Zotero save is reported as a notice, not a failed note", async () => {
	const { plugin: p, ctx, response, notes } = await setup();
	p.exportReadingWorkspace = async () => { throw new Error("Cache unavailable"); };
	const saved = await p.saveReadingAction(ctx, "contents", response);
	assert.equal(saved.key, notes[0].key);
	assert.match(saved.notice, /saved.*cache/i);
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

test("unmapped chapter opens by a unique PDF outline destination without guessing printed-page offsets", async () => {
 const { plugin: p, window, ctx, view, contents } = await setup();
 ctx.reading.pdfSource.pageMapping = false;
 let navigated;
 const pdf = { numPages: 30, getOutline: async () => [{ title: '1 Foundations', dest: 'chapter1', items: [] }], getDestination: async () => [{ num: 100, gen: 0 }], getPageIndex: async () => 12 };
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', navigate: async loc => { navigated = loc.pageIndex; }, _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: pdf } } } } }] };
 await p.openReadingContentsEntry(view, contents.entries[0]);
 assert.equal(navigated, 12); assert.equal(contents.entries[0].pageIndex, null);
 pdf.getOutline = async () => [];
 await assert.rejects(p.openReadingContentsEntry(view, contents.entries[0]), /verified/);
});

test("discussion source links validate against live physical pages when full-text mapping is unavailable", async () => {
 const { plugin: p, window, ctx, notes } = await setup();
 ctx.reading.pdfSource.pageMapping = false;
 await writeFile(join(ctx.dir, 'source-text.md'), 'Argument');
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: { numPages: 3, getPage: async n => ({ getTextContent: async () => ({ items: [{ str: n === 3 ? 'Argument' : 'Other page' }] }) }) } } } } } }] };
 await p.saveReadingRecord(ctx, 'Explain', null, { title: 'Result', summary: 'Conclusion', openQuestions: [], sources: [{ pageIndex: 2, quote: 'Argument' }] });
 assert.match(notes[0].html, /page=3/);
 await p.saveReadingRecord(ctx, 'Explain', null, { title: 'Other', summary: 'Conclusion', openQuestions: [], sources: [{ pageIndex: 1, quote: 'Argument' }] });
 assert.ok(!notes[1].html.includes('page=2'));
});

test("current-page questions receive native page text despite blank-cover mapping loss and snapshot the send-time page", async () => {
 const { plugin: p, window, ctx, dir } = await setup();
 p.prepareReadingSkills = async ctx => ctx.reading;
 window.Zotero.PDFWorker = { getFullText: async () => ({ text: 'Preface\fCurrent equation and argument', extractedPages: 3, totalPages: 3 }) };
 let calls = 0;
 const app = { pdfDocument: { numPages: 3, getPage: async n => { if (n === 3) calls++; return { getTextContent: async () => ({ items: [{ str: n === 1 ? '' : n === 2 ? 'Preface' : 'Current equation and argument' }] }) }; } }, pdfViewer: { currentPageNumber: 1, getPageView: () => ({ pageLabel: '1' }) } };
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: app } } } }] };
 p.runBackend = async (_, request) => {
  assert.match(request.question, /Current equation and argument/);
  assert.match(request.question, /current-page.md/);
  assert.match(request.question, /do not search source-text.md/);
  assert.match(request.question, /"pageIndex":2/);
  return { text: 'Explanation\n<abstractin-record>{"title":"Explanation","summary":"Conclusion","openQuestions":[],"sources":[{"quote":"Current equation and argument","pageIndex":2}]}</abstractin-record>' };
 };
 const result = await p.ask(ctx, 'Explain this page', { backend: 'codex', currentPage: { pageIndex: 2, pageLabel: '1' }, progress() {} });
 assert.equal(result.error, undefined); assert.ok(result.recordKey); assert.equal(result.recordNotice, undefined);
 assert.match(await readFile(join(dir, 'current-page.md'), 'utf8'), /pageIndex: 2/);
 assert.equal(calls, 1, 'record validation reuses the already extracted native page');
});

test("an explicitly bound reader wins over another window showing the same attachment", async () => {
 const { plugin: p, window, ctx } = await setup();
 const makeReader = n => ({ itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: { currentPageNumber: n, getPageView: () => ({}) } } } } } });
 window.Zotero.Reader = { _readers: [makeReader(1), makeReader(3)] };
 ctx.reader = window.Zotero.Reader._readers[1];
 assert.equal(p.currentReadingLocation(ctx).pageIndex, 2);
 ctx.reader = { ...ctx.reader, itemID: 8 }; assert.equal(p.currentReadingLocation(ctx).pageIndex, 0);
});

test("mapped chapter navigation accepts a wrapped heading, excludes contents rows and rejects ambiguous bookmarks", async () => {
 const { plugin: p, window, ctx, view, contents, dir } = await setup();
 let navigated;
 const pdf = { numPages: 3, getOutline: async () => [] };
 window.Zotero.Reader = { _readers: [{ itemID: 7, type: 'pdf', navigate: async loc => { navigated = loc.pageIndex; }, _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: pdf } } } } }] };
 await writeFile(join(dir, 'source-text.md'), '## PDF page 1; pageIndex 0\nContents\n1 Foundations\n## PDF page 2; pageIndex 1\nPreface\n## PDF page 3; pageIndex 2\n1\nFoundations\nArgument');
 await p.openReadingContentsEntry(view, contents.entries[0]); assert.equal(navigated, 2);
 pdf.getOutline = async () => [{ title: 'Foundations', dest: [0] }, { title: 'Chapter 1 Foundations', dest: [1] }];
 await assert.rejects(p.openReadingContentsEntry(view, contents.entries[0]), /unique/);
 assert.equal(navigated, 2);
});

test("knowledge discussion skips full PDF extraction, supplies corrected notes inline and keeps follow-up context", async () => {
 const { plugin: p, prefs, ctx, view, notes, response } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 await p.saveReadingAction(ctx, 'contents', response);
 await p.saveReadingRecord(ctx, 'Prior', null, { title: 'Prior', summary: 'Corrected understanding', openQuestions: [] });
 p.prepareReadingSkills = async () => { throw new Error('Knowledge discussion must not stage skills each turn'); };
 p.exportReadingSource = async () => { throw new Error('Knowledge discussion must not extract PDF'); };
 p.runBackend = async (_, request) => {
  assert.match(request.question, /Knowledge discussion/); assert.match(request.question, /Corrected understanding/);
  assert.match(request.question, /Do not open or search/); assert.ok(!request.question.includes('Read and follow the original skill'));
  return { text: 'A supplementary explanation\n<abstractin-record>{"title":"Intuition","summary":"Supplementary explanation","openQuestions":[],"sources":[]}</abstractin-record>', sessionId: 'knowledge-thread' };
 };
 let result = await p.ask(ctx, 'Why does this work?', { backend: 'codex', progress() {} }); assert.equal(result.error, undefined); assert.ok(result.recordKey);
 let calls = 0; p.runBackend = async (_, request) => { calls++; assert.equal(request.session.id, 'knowledge-thread'); return { text: 'Follow-up\n<abstractin-record>{"title":"Follow-up","summary":"More intuition","openQuestions":[]}</abstractin-record>' }; };
 result = await p.ask(ctx, 'Give an example', { backend: 'codex', progress() {} }); assert.equal(result.error, undefined); assert.equal(calls, 1);
 p.updateReadingControls(view); const button = view.root.querySelector('.zs-reading-evidence-mode');
 assert.equal(button.dataset.mode, 'knowledge');
 assert.equal(button.previousElementSibling.textContent, 'AbstractIn');
 assert.ok(button.closest('.zs-header')); assert.equal(view.root.querySelector('.zs-reading-bar .zs-reading-evidence-mode'), null);
 assert.equal(button.querySelector('.zs-i').dataset.icon, 'effort');
 button.click(); assert.equal(button.getAttribute('aria-expanded'), 'true');
 const choices = [...view.root.querySelectorAll('.zs-menu-item')];
 assert.equal(choices[0].getAttribute('aria-checked'), 'true'); choices[1].click();
 assert.equal(p.getReadingEvidenceMode(), 'source'); assert.equal(button.dataset.mode, 'source');
 assert.equal(button.querySelector('.zs-i').dataset.icon, 'book');
 assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(view.root.querySelector('.zs-menu'), null);
});

test("switching evidence modes starts a fresh thread while preserving chat history", async () => {
 const { plugin: p, prefs, ctx } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 await p.saveSessions(ctx.dir, { codex: { id: 'old-source-thread', model: '', sourceSignature: 'source-A', evidenceMode: 'source', seen: 2 } });
 await p.saveHistory(ctx.dir, [{ role: 'user', text: 'Old question' }, { role: 'assistant', text: 'Old answer' }]);
 p.runBackend = async (_, request) => { assert.equal(request.session, null); assert.equal(request.history.length, 2); return { text: 'Answer\n<abstractin-record>{"title":"Note","summary":"Conclusion","openQuestions":[]}</abstractin-record>' }; };
 const result = await p.ask(ctx, 'Continue', { backend: 'codex', progress() {} }); assert.equal(result.error, undefined);
});

test("workspace recap renders discussion and open-question formulas with KaTeX", async () => {
 const { plugin: p, ctx, view } = await setup();
 await p.saveReadingRecord(ctx, 'Question', null, { title: 'Bayes $x$', summary: 'Conclusion $x^2=1$.\n\n$$\\pi(x)=1$$', openQuestions: ['Why $x$?'] });
 p.openReadingWorkspace(view);
 assert.ok(view.root.querySelectorAll('.zs-workspace-recap math').length >= 3);
});

test("New chat and Previous chat preserve reading artifacts/mode while resetting agent sessions", async () => {
 const { plugin: p, ctx, view, prefs, notes, response, dir, window } = await setup();
 window.OS.File.remove = async () => {};
 prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 await p.saveReadingAction(ctx, 'contents', response);
 await p.saveReadingRecord(ctx, 'Prior', null, { title: 'Prior', summary: 'Persistent conclusion $x$', openQuestions: [] });
 const history = [{ role: 'user', text: 'Previous question', ts: 100 }, { role: 'assistant', text: 'Previous answer', ts: 101 }];
 await p.saveHistory(dir, history); await p.saveSessions(dir, { codex: { id: 'old-thread' } });
 let archived; p.archiveHistory = async (_, messages) => { if (messages.length) archived = messages; };
 await p.newChat(view.root);
 assert.equal((await p.loadHistory(dir)).length, 0); assert.equal(Object.keys(await p.loadSessions(dir)).length, 0);
 assert.equal(notes.length, 2); assert.equal(ctx.reading.type, 'book'); assert.equal(p.getReadingEvidenceMode(), 'knowledge');
 const path = join(dir, 'previous.json'); await writeFile(path, JSON.stringify(archived));
 await p.restoreChat(view.root, { path });
 assert.equal((await p.loadHistory(dir))[0].text, 'Previous question'); assert.equal(Object.keys(await p.loadSessions(dir)).length, 0); assert.equal(notes.length, 2);
});

test("a chat transition blocks a concurrent send or second transition", async () => {
 const { plugin: p, ctx, view } = await setup();
 let finish; p.loadHistory = () => new Promise(resolve => { finish = resolve; });
 p.ask = async () => { throw new Error('A transition cannot start an answer'); };
 const transition = p.newChat(view.root);
 assert.equal(p._chatTransitions.has(ctx.dir), true);
 p.startRequest(view, 'Do not send during transition'); assert.equal(p._pending.has(ctx.dir), false);
 finish([]); await transition; assert.equal(p._chatTransitions.has(ctx.dir), false);
});

test("an explicit no-document-search request overrides source mode for that turn", async () => {
 const { plugin: p, ctx } = await setup();
 p.exportReadingSource = async () => { throw new Error('Must not extract PDF'); };
 p.runBackend = async (_, request) => { assert.equal(request.ctx.reading.evidenceMode, 'knowledge'); return { text: 'Intuition\n<abstractin-record>{"title":"Intuition","summary":"Explanation","openQuestions":[]}</abstractin-record>' }; };
 const result = await p.ask(ctx, '不要搜索文档，根据已有知识解释一下', { backend: 'codex', progress() {} }); assert.equal(result.error, undefined);
});

test("knowledge notes verify only the supplied page and never reread full PDF text", async () => {
 const { plugin: p, ctx, notes } = await setup();
 ctx.reading.evidenceMode = 'knowledge'; ctx.reading.pdfSource = { status: 'context-only' };
 ctx.reading.currentPage = { pageIndex: 2, verified: true, text: 'Supplied argument' };
 p.readNativeReadingPage = async () => { throw new Error('Record saving must not retrieve another page'); };
 const record = { title: 'Knowledge', summary: 'Independent explanation', openQuestions: [], sources: [{ pageIndex: 2, quote: 'Supplied argument' }, { pageIndex: 1, quote: 'Supplied argument' }] };
 await p.saveReadingRecord(ctx, 'Explain', null, record);
 assert.match(notes[0].html, /page=3/); assert.ok(!notes[0].html.includes('page=2')); assert.match(record.saveNotice, /omitted/);
});

test("explicit paper-summary actions still verify the source while knowledge preference remains selected", async () => {
 const { plugin: p, prefs, window, ctx } = await setup('paper');
 prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge'; p.prepareReadingSkills = async ctx => ctx.reading;
 let extractions = 0; window.Zotero.PDFWorker = { getFullText: async () => { extractions++; return { text: 'Title\fMethods\fResults', extractedPages: 3, totalPages: 3 }; } };
 p.runBackend = async (_, request) => { assert.equal(request.ctx.reading.evidenceMode, 'source'); return { text: 'Summary\n<abstractin-workspace>{"kind":"summary","coverage":"Methods and results"}</abstractin-workspace>' }; };
 const result = await p.ask(ctx, 'Summarize the paper', { backend: 'codex', readingAction: 'summary', progress() {} });
 assert.equal(result.error, undefined); assert.equal(extractions, 1); assert.equal(p.getReadingEvidenceMode(), 'knowledge');
});

test("ordinary knowledge follow-ups neither prepare PDF pages nor show PDF preparation", async () => {
 const { plugin: p, prefs, ctx } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 p.currentReadingLocation = () => ({ pageIndex: 2 });
 p.prepareCurrentReadingPage = async () => { throw new Error('Unrequested PDF page read'); };
 p.exportReadingSource = async () => { throw new Error('Unrequested full PDF read'); };
 p.runBackend = async () => ({ text: 'General intuition' });
 const statuses = []; const result = await p.ask(ctx, 'Give a simple intuition', { backend: 'codex', progress: event => statuses.push(event.status || '') });
 assert.equal(result.error, undefined); assert.ok(statuses.includes('using saved discussion context'));
 assert.ok(!statuses.includes('preparing PDF text'));
});

test("knowledge mode automatically verifies numbered document references with targeted source instructions", async () => {
 const { plugin: p, prefs, ctx } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 p.prepareReadingSkills = async ctx => ctx.reading;
 let checks = 0; p.exportReadingSource = async () => { checks++; return ctx.reading.pdfSource; };
 p.runBackend = async (_, request) => {
  assert.equal(request.ctx.reading.evidenceMode, 'source'); assert.equal(request.ctx.reading.sourceLookup, true);
  assert.match(request.question, /Search the exact requested theorem\/section\/claim/);
  return { text: 'The verified statement' };
 };
 const result = await p.ask(ctx, 'What does theorem 1.1 say?', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(checks, 1); assert.equal(p.getReadingEvidenceMode(), 'knowledge');
 for (const q of ['Explain Lemma 2.3', '第1.1节讲什么', '定理 1.1 说明什么', 'Go read the section about consistency']) assert.equal(p.requestsReadingSource(q), true, q);
 assert.equal(p.requestsReadingSource('Explain Bayes theorem generally'), false);
});

test("missing document evidence triggers one source lookup without saving the preliminary reply", async () => {
 const { plugin: p, prefs, ctx, dir } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 p.prepareReadingSkills = async ctx => ctx.reading; p.exportReadingSource = async () => ctx.reading.pdfSource;
 let calls = 0; const pending = { backend: 'codex', progress() {} };
 p.runBackend = async (_, request) => {
  calls++; if (calls === 1) {
   assert.equal(request.ctx.reading.evidenceMode, 'knowledge');
   return { text: '<abstractin-source-needed>The author-specific argument is missing</abstractin-source-needed>' };
  }
  assert.equal(request.ctx.reading.evidenceMode, 'source'); request.onSpawn({ kill() {} });
  return { text: 'Verified from the requested passage' };
 };
 const result = await p.ask(ctx, 'Why did the author make that assumption?', pending);
 assert.equal(result.error, undefined); assert.equal(calls, 2); assert.ok(pending.proc);
 const history = await p.loadHistory(dir); assert.equal(history.filter(m => m.role === 'assistant').length, 1);
 assert.ok(!JSON.stringify(history).includes('abstractin-source-needed')); assert.equal(p.getReadingEvidenceMode(), 'knowledge');
});

test("explicit prohibition prevents both current-page reads and automatic verification", async () => {
 const { plugin: p, prefs, ctx } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 p.currentReadingLocation = () => ({ pageIndex: 2 });
 p.prepareCurrentReadingPage = p.exportReadingSource = async () => { throw new Error('PDF access forbidden'); };
 let calls = 0; p.runBackend = async (_, request) => {
  calls++; assert.equal(request.ctx.reading.evidenceMode, 'knowledge'); assert.match(request.question, /explicitly prohibited document access/);
  return { text: '<abstractin-source-needed>Unavailable theorem</abstractin-source-needed>' };
 };
 const result = await p.ask(ctx, '不要读取pdf，theorem 1.1 在当前页是什么？', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(calls, 1);
});

test("a current-page question reads only that page in knowledge mode", async () => {
 const { plugin: p, prefs, ctx } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 p.currentReadingLocation = () => ({ pageIndex: 2 });
 let reads = 0; p.prepareCurrentReadingPage = async ctx => { reads++; ctx.reading.currentPage = { pageIndex: 2, verified: true, text: 'Current-page statement' }; };
 p.exportReadingSource = async () => { throw new Error('No full PDF read'); };
 p.runBackend = async (_, request) => { assert.match(request.question, /Current-page statement/); return { text: 'From the supplied page' }; };
 const result = await p.ask(ctx, '解释当前页的这个推导', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(reads, 1);
});
