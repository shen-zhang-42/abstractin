import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPlugin } from "./load-plugin.mjs";

async function setup(type = "book") {
	const env = loadPlugin({ prefs: { "extensions.abstractin.onboarded": true, "extensions.abstractin.readingEvidenceMode": "source" } });
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
	const root = body.querySelector(".abstractin-root");
	const view = { root, doc: document, ctx, input: root.querySelector(".abstractin-input"), logEl: root.querySelector(".abstractin-log") };
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
	view.root.querySelector(".abstractin-workspace-actions button").click();
	assert.equal(requests[0][4].readingAction, "summary");
	let text = '## Research question\nA tested hypothesis with $x$.\n<abstractin-workspace>{"kind":"summary","coverage":"All 3 PDF pages"}</abstractin-workspace>';
	await p.saveReadingAction(ctx, "summary", text);
	await p.saveReadingAction(ctx, "summary", text.replace("A tested", "An updated"));
	assert.equal(notes.filter(n => !n.tags.includes("AbstractIn:Chat")).length, 1);
	assert.ok(notes[0].tags.includes("AbstractIn:Summary"));
	notes[0].html = notes[0].html.replace("updated", "corrected");
	await p.exportReadingWorkspace(ctx);
	assert.match(await readFile(join(dir, "workspace.md"), "utf8"), /corrected/);
	p.openReadingWorkspace(view);
	assert.match(view.root.textContent, /View summary/);
	assert.match(view.root.textContent, /Update summary/);
	view.root.querySelector(".abstractin-workspace-actions button").click();
	assert.ok(view.root.querySelector(".abstractin-workspace-view math"));
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
	assert.equal(notes.filter(n => !n.tags.includes("AbstractIn:Chat")).length, 1);
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

test("contents initialization supplies complete detected contents in a fresh context without chapter scans", async () => {
	const { plugin: p, window, ctx, notes, dir } = await setup();
	p.prepareReadingSkills = async ctx => ctx.reading;
	p.loadSessions = async () => ({ codex: { id: "old", model: "", sourceSignature: "old" } });
	window.Zotero.PDFWorker = { getFullText() { throw new Error('Contents must not extract the whole PDF'); } };
	p.readingPDFApplication = () => ({ pdfDocument: { numPages: 3 } });
	p.readNativeReadingPage = async (_, pageIndex) => ({ pageIndex, text: ['Contents\n1 Foundations .... 3', 'Preface', '1 Foundations\nArgument'][pageIndex] });
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

test("contents preparation supplies original directory pages inline without requiring file tools", async () => {
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
	view.root.querySelector(".abstractin-workspace-actions button").click();
	assert.equal(view.root.querySelectorAll(".abstractin-workspace-view math").length, 2);
	assert.ok(view.root.querySelector(".abstractin-workspace-view table"));
	assert.ok(!view.root.querySelector(".abstractin-workspace-view").textContent.includes("abstractin-workspace-v1"));
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
  assert.match(request.question, /Original-source retrieval is handled by the plugin/); assert.ok(!request.question.includes('Read and follow the original skill'));
  return { text: 'A supplementary explanation\n<abstractin-record>{"title":"Intuition","summary":"Supplementary explanation","openQuestions":[],"sources":[]}</abstractin-record>', sessionId: 'knowledge-thread' };
 };
 let result = await p.ask(ctx, 'Why does this work?', { backend: 'codex', progress() {} }); assert.equal(result.error, undefined); assert.ok(result.recordKey);
 let calls = 0; p.runBackend = async (_, request) => { calls++; assert.equal(request.session.id, 'knowledge-thread'); return { text: 'Follow-up\n<abstractin-record>{"title":"Follow-up","summary":"More intuition","openQuestions":[]}</abstractin-record>' }; };
 result = await p.ask(ctx, 'Give an example', { backend: 'codex', progress() {} }); assert.equal(result.error, undefined); assert.equal(calls, 1);
 p.updateReadingControls(view); const button = view.root.querySelector('.abstractin-reading-evidence-mode');
 assert.equal(button.dataset.mode, 'balanced');
 assert.ok(button.closest('.abstractin-composer .abstractin-controls')); assert.equal(view.root.querySelector('.abstractin-header .abstractin-reading-evidence-mode'), null);
 assert.equal(button.querySelector('.abstractin-i').dataset.icon, 'readingBalanced');
 button.click(); assert.equal(button.getAttribute('aria-expanded'), 'true');
 const choices = [...view.root.querySelectorAll('.abstractin-menu-item')];
 assert.ok(choices[0].closest('.abstractin-reading-mode-menu'));
 assert.equal(choices[0].querySelector('.abstractin-reading-menu-icon').closest('.abstractin-menu-item'), choices[0]);
 assert.equal(choices[0].querySelector('.abstractin-menu-text').children.length, 2);
 assert.equal(choices[1].getAttribute('aria-checked'), 'true'); choices[2].click();
 assert.equal(p.getReadingEvidenceMode(), 'source'); assert.equal(button.dataset.mode, 'source');
 assert.equal(button.querySelector('.abstractin-i').dataset.icon, 'readingSource');
 assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(view.root.querySelector('.abstractin-menu'), null);
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
 assert.ok(view.root.querySelectorAll('.abstractin-workspace-recap math').length >= 3);
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
 assert.equal(notes.filter(n => !n.tags.includes('AbstractIn:Chat')).length, 2); assert.equal(ctx.reading.type, 'book'); assert.equal(p.getReadingEvidenceMode(), 'knowledge');
 const path = join(dir, 'previous.json'); await writeFile(path, JSON.stringify(archived));
 await p.restoreChat(view.root, { path });
 assert.equal((await p.loadHistory(dir))[0].text, 'Previous question'); assert.equal(Object.keys(await p.loadSessions(dir)).length, 0); assert.equal(notes.filter(n => !n.tags.includes('AbstractIn:Chat')).length, 2);
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

test("knowledge mode verifies only an explicit document lookup with targeted source instructions", async () => {
 const { plugin: p, prefs, ctx } = await setup(); prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 p.prepareReadingSkills = async ctx => ctx.reading;
 let checks = 0; p.exportReadingSource = async () => { checks++; return ctx.reading.pdfSource; };
 p.runBackend = async (_, request) => {
  assert.equal(request.ctx.reading.evidenceMode, 'source'); assert.equal(request.ctx.reading.sourceLookup, true);
  assert.match(request.question, /Search the exact requested theorem\/section\/claim/);
  return { text: 'The verified statement' };
 };
 const result = await p.ask(ctx, 'Look up theorem 1.1 in the book', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(checks, 1); assert.equal(p.getReadingEvidenceMode(), 'knowledge');
 for (const q of ['Explain Lemma 2.3', '第1.1节讲什么', '定理 1.1 说明什么']) assert.equal(p.requestsReadingSource(q), false, q);
 assert.equal(p.requestsReadingSource('Go read the section about consistency'), true);
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

test("complete chat text migrates to chunked Zotero notes and restores on a new computer without a PDF", async () => {
 const { plugin: p, ctx, notes, window, dir } = await setup(); p.registerChatContext(ctx);
 const messages = [{ role: 'user', text: 'Question about $x$' }, { role: 'assistant', text: '<script>inert</script>\n$$\\Theta$$\n' + '全文中文'.repeat(15000), ts: 100 }];
 assert.equal(await p.saveHistory(dir, messages), undefined);
 const chatNotes = notes.filter(n => n.tags.includes('AbstractIn:Chat')); assert.ok(chatNotes.length > 2);
 assert.ok(chatNotes.every(n => n.html.length < 150000)); assert.ok(!chatNotes.some(n => /<script>/.test(n.html)));
 const remoteDir = await mkdtemp(join(tmpdir(), 'abstractin-remote-'));
 p.registerChatContext({ ...ctx, dir: remoteDir, paperItem: { ...ctx.paperItem, id: 90, libraryID: 12 } });
 window.Zotero.PDFWorker = { getFullText: async () => { throw new Error('Restoring chats must not access PDF'); } };
 await p.saveSessions(remoteDir, { codex: { id: 'local-unrelated-thread' } });
 const restored = await p.loadHistory(remoteDir); assert.equal(JSON.stringify(restored), JSON.stringify(messages));
 assert.equal(Object.keys(await p.loadSessions(remoteDir)).length, 0);
 assert.equal(JSON.stringify(await p.loadHistory(remoteDir)), JSON.stringify(messages));
});

test("another device continues on its own chat branch and keeps original notes intact", async () => {
 const { plugin: p, prefs, ctx, dir } = await setup(); p.registerChatContext(ctx);
 const old = [{ role: 'user', text: 'Original' }, { role: 'assistant', text: 'Answer' }]; await p.saveHistory(dir, old);
 const prior = p.chatNoteParts(ctx).map(part => part.note.html);
 const remoteDir = await mkdtemp(join(tmpdir(), 'abstractin-other-writer-')); p.registerChatContext({ ...ctx, dir: remoteDir });
 await p.loadHistory(remoteDir); prefs['extensions.abstractin.chatDeviceID'] = 'other-device';
 await p.appendHistory(remoteDir, [{ role: 'user', text: 'Follow-up' }, { role: 'assistant', text: 'New answer' }]);
 assert.ok(prior.every(html => p.chatNoteParts(ctx).some(part => part.note.html === html)));
 assert.equal(new Set(p.chatNoteParts(ctx).map(part => part.data.chatID)).size, 2);
 assert.equal((await p.loadHistory(remoteDir)).length, 4); assert.equal((await p.loadHistory(dir)).length, 2);
});

test("New chat archives and synced Previous chats restore texts without losing the current document", async () => {
 const { plugin: p, ctx, view, window, dir } = await setup(); p.registerChatContext(ctx);
 window.Zotero.File.iterateDirectory = async () => {}; window.OS.File.remove = async () => {};
 await p.saveHistory(dir, [{ role: 'user', text: 'First chat' }, { role: 'assistant', text: 'First answer' }]);
 await p.newChat(view.root); assert.equal((await p.loadHistory(dir)).length, 0);
 let archives = await p.listArchives(dir); assert.equal(archives.length, 1); assert.equal(archives[0].synced, true);
 await p.restoreChat(view.root, archives[0]); assert.equal((await p.loadHistory(dir))[1].text, 'First answer');
 const remoteDir = await mkdtemp(join(tmpdir(), 'abstractin-new-chat-')); p.registerChatContext({ ...ctx, dir: remoteDir });
 assert.equal((await p.loadHistory(remoteDir))[0].text, 'First chat');
 assert.ok(p.chatNoteHistories(ctx).some(chat => chat.archived));
});

test("incomplete synced notes never restore a truncated history or overwrite local text", async () => {
 const { plugin: p, ctx, dir } = await setup(); p.registerChatContext(ctx);
 const text = 'long'.repeat(20000); await p.saveHistory(dir, [{ role: 'assistant', text }]);
 const parts = p.chatNoteParts(ctx); parts[parts.length - 1].note.deleted = true;
 const remoteDir = await mkdtemp(join(tmpdir(), 'abstractin-incomplete-chat-')); p.registerChatContext({ ...ctx, dir: remoteDir });
 assert.equal((await p.loadHistory(remoteDir)).length, 0); assert.equal((await p.loadHistory(dir))[0].text, text);
});

test("a failed chat note write preserves local history and reports a sync warning", async () => {
 const { plugin: p, ctx, dir, window } = await setup(); p.registerChatContext(ctx);
 window.Zotero.Item = class { setNote() {} addTag() {} async saveTx() { throw new Error('Library is read-only'); } };
 const warning = await p.saveHistory(dir, [{ role: 'user', text: 'Keep local answer' }]);
 assert.match(warning, /saved locally/); assert.match(warning, /read-only/);
 assert.equal((await p.loadHistory(dir))[0].text, 'Keep local answer');
});

test("synced chat notes remain isolated by exact attachment identity", async () => {
 const { plugin: p, ctx, dir } = await setup(); p.registerChatContext(ctx);
 await p.saveHistory(dir, [{ role: 'user', text: 'PDF A' }]);
 const otherDir = await mkdtemp(join(tmpdir(), 'abstractin-other-pdf-'));
 p.registerChatContext({ ...ctx, dir: otherDir, attachmentItem: { ...ctx.attachmentItem, key: 'PDF-B' } });
 assert.equal((await p.loadHistory(otherDir)).length, 0);
});

test("legacy Previous chats migrate alongside the active chat without changing its selection", async () => {
 const { plugin: p, ctx, dir, window } = await setup(); p.registerChatContext(ctx);
 const current = [{ role: 'user', text: 'Current' }], old = [{ role: 'user', text: 'Archived legacy chat' }];
 await writeFile(join(dir, 'chat.json'), JSON.stringify(current));
 await writeFile(join(dir, 'chat-legacy.json'), JSON.stringify(old));
 window.Zotero.File.iterateDirectory = async (_, visit) => { visit({ name: 'chat.json' }); visit({ name: 'chat-legacy.json' }); };
 assert.equal((await p.loadHistory(dir))[0].text, 'Current');
 assert.ok(p.chatNoteHistories(ctx).some(chat => chat.history[0]?.text === 'Archived legacy chat' && chat.archived));
 const remoteDir = await mkdtemp(join(tmpdir(), 'abstractin-legacy-chat-')); p.registerChatContext({ ...ctx, dir: remoteDir });
 window.Zotero.File.iterateDirectory = async () => {};
 assert.equal((await p.loadHistory(remoteDir))[0].text, 'Current');
});

test("restored selected passages use the new computer's attachment ID", async () => {
 const { plugin: p, ctx, dir } = await setup(); p.registerChatContext(ctx);
 await p.saveHistory(dir, [{ role: 'user', text: 'Passage', selection: { attachmentID: 7, text: 'Quoted', position: { pageIndex: 2 } } }]);
 const remoteDir = await mkdtemp(join(tmpdir(), 'abstractin-selection-chat-'));
 p.registerChatContext({ ...ctx, dir: remoteDir, attachmentItem: { ...ctx.attachmentItem, id: 200 } });
 assert.equal((await p.loadHistory(remoteDir))[0].selection.attachmentID, 200);
});

test("current page does not require a rendered page view or a getPageView method", async () => {
 const { plugin: p, ctx, window } = await setup();
 ctx.reader = { itemID: 7, type: 'pdf', _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: { currentPageNumber: 600 } } } } } };
 assert.equal(p.currentReadingLocation(ctx).pageIndex, 599);
 ctx.reader._internalReader._primaryView._iframeWindow.PDFViewerApplication.pdfViewer.getPageView = () => { throw new Error('View not rendered'); };
 assert.equal(p.currentReadingLocation(ctx).pageIndex, 599);
});

test("active split-view stats preserve current location when its iframe is unavailable", async () => {
 const { plugin: p, ctx } = await setup();
 ctx.reader = { itemID: 7, type: 'pdf', _internalReader: {
  _lastViewPrimary: false, _lastView: { _iframeWindow: null },
  _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: { currentPageNumber: 2 } } } },
  _state: { primaryViewStats: { pageIndex: 1 }, secondaryViewStats: { pageIndex: 599, pageLabel: '600' } },
 } };
 const location = p.currentReadingLocation(ctx);
 assert.equal(location.pageIndex, 599); assert.equal(location.pageLabel, '600');
});

test("reader document access falls back to a live iframe after a destroyed view", async () => {
 const { plugin: p, ctx } = await setup();
 const dead = new Proxy({}, { get() { throw new Error("can't access dead object"); } });
 const pdf = {};
 ctx.reader = { itemID: 7, type: 'pdf', _internalReader: { _lastView: dead, _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: pdf } } } } };
 assert.equal(p.readingPDFApplication(ctx).pdfDocument, pdf);
});

test("native PDF extraction unwraps cross-window promises, page methods and text content", async () => {
 const { plugin: p, ctx, window } = await setup();
 const pageWrapper = {}, pagePromiseWrapper = {}, contentWrapper = {}, contentPromiseWrapper = {};
 const page = { getTextContent: () => contentPromiseWrapper };
 const content = { items: [{ str: 'Theorem A.78.', hasEOL: true }, { str: 'Actual proof text.' }] };
 const unwrapped = new Map([[pagePromiseWrapper, Promise.resolve(pageWrapper)], [pageWrapper, page], [contentPromiseWrapper, Promise.resolve(contentWrapper)], [contentWrapper, content]]);
 window.Components = { utils: { waiveXrays: value => unwrapped.get(value) || value } };
 const pdf = { numPages: 601, getPage: number => { assert.equal(number, 600); return pagePromiseWrapper; } };
 p.readingPDFApplication = () => ({ pdfDocument: pdf });
 const result = await p.readNativeReadingPage(ctx, 599);
 assert.equal(result.pageIndex, 599);
 assert.match(result.text, /Theorem A.78/); assert.match(result.text, /Actual proof text/);
});

test("answer modes default to Balanced and preserve legacy choices", () => {
 const { plugin: p, prefs } = loadPlugin();
 assert.equal(p.getReadingAnswerMode(), 'balanced');
 prefs['extensions.abstractin.readingEvidenceMode'] = 'knowledge';
 assert.equal(p.getReadingAnswerMode(), 'balanced');
 prefs['extensions.abstractin.readingEvidenceMode'] = 'source';
 assert.equal(p.getReadingAnswerMode(), 'source');
});

test("Context only blocks PDF and note exports even for explicit source requests", async () => {
 const { plugin: p, prefs, ctx } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'context';
 ctx.reading.knowledgeContext = 'Stale note content';
 let reads = 0;
 for (const name of ['exportContext', 'knowledgeReadingSource', 'exportReadingSource', 'prepareCurrentReadingPage', 'exportReadingRecords', 'exportReadingWorkspace']) {
  p[name] = async () => { reads++; throw new Error('Context only must not retrieve material'); };
 }
 let calls = 0;
 p.runBackend = async (_, request) => {
  calls++;
  assert.equal(request.ctx.reading.answerMode, 'context');
  assert.equal(request.ctx.reading.currentPage, null);
  assert.doesNotMatch(request.question, /Stale note content/);
  assert.match(p.systemPrompt(request.ctx), /Do not access PDF files/);
  return { text: '<abstractin-source-needed>Theorem statement missing</abstractin-source-needed>' };
 };
 const result = await p.ask(ctx, '请搜索当前页的 Theorem A.78 原文', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined);
 assert.equal(reads, 0); assert.equal(calls, 1);
});

test("Balanced retrieves a selected bare theorem before answering", async () => {
 const { plugin: p, prefs, ctx } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'balanced';
 p.prepareReadingSkills = async ctx => ctx.reading;
 let reads = 0;
 p.exportReadingSource = async () => { reads++; return ctx.reading.pdfSource; };
 p.runBackend = async (_, request) => {
  assert.equal(request.ctx.reading.answerMode, 'balanced');
  assert.equal(request.ctx.reading.evidenceMode, 'source');
  return { text: 'Verified explanation' };
 };
 const result = await p.ask(ctx, '为什么证明中有不可数的指标集？', { backend: 'codex', progress() {}, selection: { attachmentID: 7, text: 'Theorem A.78.' } });
 assert.equal(result.error, undefined); assert.equal(reads, 1);
 assert.equal(p.getReadingAnswerMode(), 'balanced');
});

for (const refusal of ["I cannot access the PDF. Please provide the proof.", "目前你提供的原文只有 Theorem A.78，没有定理陈述和证明。", "请贴出原文证明，我才能判断。"]) test("Balanced retries a plain PDF refusal once: " + refusal, async () => {
 const { plugin: p, prefs, ctx, dir } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'balanced';
 p.prepareReadingSkills = async ctx => ctx.reading;
 let reads = 0, calls = 0;
 p.exportReadingSource = async () => { reads++; return ctx.reading.pdfSource; };
 p.runBackend = async (_, request) => {
  calls++;
  return { text: calls === 1 ? refusal : 'Inspected original argument' };
 };
 const result = await p.ask(ctx, 'Why that assumption?', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(reads, 1); assert.equal(calls, 2);
 const history = await p.loadHistory(dir);
 assert.equal(history.filter(m => m.role === 'assistant').length, 1);
 assert.equal(history.at(-1).text, 'Inspected original argument');
});

test("switching Context only to Balanced resets a thread even with the same evidence state", async () => {
 const { plugin: p, prefs, ctx } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'context';
 p.runBackend = async () => ({ text: 'Supplied explanation', sessionId: 'context-thread' });
 await p.ask(ctx, 'Explain this', { backend: 'codex', progress() {} });
 prefs['extensions.abstractin.readingEvidenceMode'] = 'balanced';
 let calls = 0;
 p.runBackend = async (_, request) => {
  calls++; assert.equal(request.session, null);
  assert.equal(request.ctx.reading.answerMode, 'balanced');
  assert.equal(request.history.at(-1).text, 'Supplied explanation');
  return { text: 'General explanation' };
 };
 const result = await p.ask(ctx, 'Give an example', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(calls, 1);
});

test("Source only forbids outside facts even when document access is prohibited for one turn", async () => {
 const { plugin: p, ctx } = await setup();
 ctx.reading.answerMode = 'source'; ctx.reading.evidenceMode = 'source';
 assert.match(p.readingPrompt(ctx), /Do not add external facts/);
 ctx.reading.evidenceMode = 'knowledge'; ctx.reading.forbidSource = true;
 assert.match(p.readingPrompt(ctx), /Do not supplement missing facts from your knowledge/);
 assert.doesNotMatch(p.readingPrompt(ctx), /supplemented by your existing knowledge/);
 assert.match(p.systemPrompt(ctx), /Do not add outside facts/);
});

test("vocabulary tutoring loads the supplied skill, forces English and returns to ordinary reading", async () => {
 const { plugin: p, prefs, ctx, window } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'balanced';
 prefs['extensions.abstractin.language'] = '中文';
 const skill = await readFile(new URL('../skills/english-vocabulary-tutor/SKILL.md', import.meta.url), 'utf8');
 let loads = 0;
 window.Zotero.File.getResourceAsync = async url => { loads++; assert.match(url, /english-vocabulary-tutor\/SKILL.md$/); return skill; };
 let calls = 0;
 p.runBackend = async (_, request) => {
  calls++;
  if (calls === 1) {
   assert.equal(request.ctx.reading.vocabularyTutor, true);
   assert.ok(request.question.includes(skill));
   assert.match(request.question, /IPA \(US\)/);
   const prompt = p.codexPrompt(request);
   assert.doesNotMatch(prompt, /Always reply in 中文/);
   assert.match(prompt, /Always reply in English/);
   const args = p.codexArgs({ ...request, stdin: true });
   assert.ok(args.includes('features.shell_tool=false'));
   const claude = p.claudeArgs(request);
   assert.equal(claude[claude.indexOf('--tools') + 1], '');
   return { text: 'Despite means without being prevented by something.', sessionId: 'tutor-thread' };
  }
  assert.equal(request.ctx.reading.vocabularyTutor, false);
  assert.equal(request.session, null);
  assert.doesNotMatch(request.question, /English Vocabulary Tutor/);
  assert.match(p.codexPrompt(request), /Always reply in 中文/);
  return { text: '普通阅读回答' };
 };
 let result = await p.ask(ctx, 'despite 是什么意思，怎么用？', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(loads, 1);
 result = await p.ask(ctx, 'Explain the proof argument', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined); assert.equal(calls, 2);
 assert.equal(p.getReadingAnswerMode(), 'balanced'); assert.equal(p.getLanguage(), '中文');
});

test("vocabulary routing recognizes language requests without capturing theorem comparisons", () => {
 const { plugin: p } = loadPlugin();
 assert.equal(p.isVocabularyQuestion("这是什么意思？", { text: "nonetheless" }), true);
 assert.equal(p.isVocabularyQuestion("这是什么意思？", { text: "Theorem A.78" }), false);
 for (const question of ['despite', '这个短语怎么用？', 'How do I use despite?', 'What does nonetheless mean?', 'affect 和 effect 的区别', 'Is this sentence natural?', 'How do I pronounce thorough?', '这个表达用英语怎么说？']) {
  assert.equal(p.isVocabularyQuestion(question), true, question);
 }
 for (const question of ['Why?', 'Chapter 1: sets', 'What is the difference between Theorem 1.1 and Lemma 2.3?', 'Explain the proof', 'What is the difference between Hilbert spaces and Banach spaces?']) {
  assert.equal(p.isVocabularyQuestion(question), false, question);
 }
});

test("Context only vocabulary tutoring does not access the PDF or saved notes", async () => {
 const { plugin: p, prefs, ctx } = await setup();
 prefs['extensions.abstractin.readingEvidenceMode'] = 'context';
 p.loadVocabularyTutorSkill = async () => await readFile(new URL('../skills/english-vocabulary-tutor/SKILL.md', import.meta.url), 'utf8');
 for (const name of ['exportReadingSource', 'prepareCurrentReadingPage', 'exportContext', 'exportReadingRecords', 'exportReadingWorkspace']) {
  p[name] = async () => { throw new Error('No retrieval allowed'); };
 }
 p.runBackend = async (_, request) => {
  assert.equal(request.ctx.reading.answerMode, 'context');
  assert.match(request.question, /Do not fill absent meanings/);
  return { text: 'Please provide the sentence containing this word.' };
 };
 const result = await p.ask(ctx, '解释这个单词的意思', { backend: 'codex', progress() {} });
 assert.equal(result.error, undefined);
});


test('long contents include every continuation page and entry beyond the old page and character limits',async()=>{
 const {plugin:p,ctx,dir,notes}=await setup();
 const pages=Array.from({length:18},(_,page)=>(page===0?'Contents\n':'')+Array.from({length:65},(_,row)=>{
  const number=page*65+row+1;return number+' Topic '+number+' '+('original title '.repeat(5)).trim()+' .... '+(number+20);
 }).join('\n'));
 const text=pages.map((text,page)=>'## PDF page '+(page+1)+'; pageIndex '+page+'\n'+text).join('\n\n')+'\n\n## PDF page 19; pageIndex 18\nChapter 1\nBody text starts here.\nThis narrative is not a contents entry.\nNo contents follow.';
 await writeFile(join(dir,'source-text.md'),text);ctx.reading.action='contents';ctx.reading.pdfSource.totalPages=19;
 await p.prepareContentsSource(ctx);assert.equal(ctx.reading.contentsPlan.pages.length,18);assert.equal(ctx.reading.contentsPlan.expected.length,1170);
 assert.ok(ctx.reading.contentsPlan.text.length>60000);assert.ok(!ctx.reading.contentsPlan.text.includes('Body text starts here'));
 const supplied=[];p.runBackend=async(backend,request)=>{
  assert.equal(request.session,null);assert.equal(request.history.length,0);assert.match(request.question,/No file or other tools/);
  const source=request.question.match(/<contents-source>\n([\s\S]*?)\n<\/contents-source>/)[1];supplied.push(source);
  const required=ctx.reading.contentsPlan.expected.filter(item=>source.includes(item.line));
  return {text:'Extracted.\n<abstractin-workspace>'+JSON.stringify({kind:'contents',entries:required.map(item=>({title:item.title,printedPageLabel:item.printedPageLabel,evidence:item.line}))})+'</abstractin-workspace>'};
 };
 const result=await p.runContentsInitialization('claude',{ctx,question:p.readingActionPrompt(ctx,'contents'),onProgress(){}},{progress(){}});
 assert.equal(result.error,undefined);assert.ok(supplied.length>3);
 for(const expected of ctx.reading.contentsPlan.expected)assert.ok(supplied.some(batch=>batch.includes(expected.line)));
 await p.saveReadingAction(ctx,'contents',result.text);
 const saved=p.readingArtifactData(notes[0]);assert.equal(saved.entries.length,1170);assert.equal(saved.complete,true);assert.ok(saved.entries.at(-1).title.startsWith('1170 Topic'));
});

test('literal Read invocations retry once with inline source instead of leaving initialization stuck',async()=>{
 const {plugin:p,ctx}=await setup();ctx.reading.action='contents';await p.prepareContentsSource(ctx);
 let calls=0;p.runBackend=async(_,request)=>{
  calls++;assert.match(request.question,/<contents-source>/);
  if(calls===1)return{text:'<invoke name="Read"><parameter name="file_path">contents-source.md</parameter></invoke>'};
  assert.match(request.question,/Previous extraction was incomplete/);
  return{text:'Complete.\n<abstractin-workspace>'+JSON.stringify({kind:'contents',entries:[{title:'1 Foundations',printedPageLabel:'3',evidence:'1 Foundations .... 3'}]})+'</abstractin-workspace>'};
 };
 const result=await p.runContentsInitialization('claude',{ctx,question:'Initialize',onProgress(){}},{progress(){}});
 assert.equal(calls,2);assert.equal(result.error,undefined);assert.match(result.text,/Foundations/);assert.ok(!result.text.includes('<invoke'));
 const args=p.claudeArgs({ctx,question:'Initialize',history:[],session:null});assert.equal(args[args.indexOf('--tools')+1],'');
 assert.ok(p.codexArgs({ctx,question:'Initialize',history:[],session:null,images:[]}).includes('features.shell_tool=false'));
});

test('a persistently missing chapter fails initialization without replacing the existing contents note',async()=>{
 const {plugin:p,ctx,dir,response,notes}=await setup();await p.saveReadingAction(ctx,'contents',response);const before=notes[0].html;
 await writeFile(join(dir,'source-text.md'),'Contents\n1 Foundations .... 3\n2 Probability .... 20');ctx.reading.action='contents';await p.prepareContentsSource(ctx);
 let calls=0;p.runBackend=async()=>{calls++;return{text:response};};
 const result=await p.runContentsInitialization('codex',{ctx,question:'Initialize',onProgress(){}},{progress(){}});
 assert.equal(calls,2);assert.match(result.error,/incomplete.*Probability/s);assert.equal(notes[0].html,before);
 await assert.rejects(p.saveReadingAction(ctx,'contents',response),/incomplete/);assert.equal(notes[0].html,before);
});

test('unpaginated source excludes chapter prose and unheaded directory continuations retain their last page',()=>{
 const {plugin:p}=loadPlugin();
 const unmapped=p.contentsSourcePlan('Front matter\nContents\n1 Foundations .... 3\n2 Probability .... 20\nPreface\nNarrative line one.\nNarrative line two.\nNarrative line three.');
 assert.ok(!unmapped.text.includes('Narrative line three'));assert.equal(unmapped.expected.length,2);
 const continuation=p.contentsSourcePlan('## PDF page 1; pageIndex 0\n1 Foundations .... 3\n2 Probability .... 20\n3 Measures .... 30\n## PDF page 2; pageIndex 1\n4 Integration .... 40\n## PDF page 3; pageIndex 2\nChapter 1\nProse follows.');
 assert.equal(continuation.pages.length,2);assert.equal(continuation.expected.length,4);
});


test('final evidence validation failure is a retryable initialization error rather than a success message',async()=>{
 const {plugin:p,window,ctx,contents,notes}=await setup();p.prepareReadingSkills=async ctx=>ctx.reading;
 window.Zotero.PDFWorker={getFullText(){throw new Error('Contents must not extract the whole PDF');}};
 p.readingPDFApplication=()=>({pdfDocument:{numPages:3}});
 p.readNativeReadingPage=async(_,pageIndex)=>({pageIndex,text:['Contents\n1 Foundations .... 3','Preface','1 Foundations\nArgument'][pageIndex]});
 p.runBackend=async()=>({text:'Complete.\n<abstractin-workspace>'+JSON.stringify({...contents,entries:[...contents.entries,{title:'Invented appendix',evidence:'Never supplied'}]})+'</abstractin-workspace>'});
 const result=await p.ask(ctx,'Initialize',{backend:'codex',readingAction:'contents',progress(){}});
 assert.match(result.error,/incomplete/);assert.equal(result.recordKey,undefined);assert.equal(notes.length,0);
 assert.equal((await p.loadHistory(ctx.dir)).length,0);
});


test('the book contents header button initializes after reading has started and can reinitialize saved contents',async()=>{
 const {plugin:p,view,ctx,response}=await setup();ctx.reading.contentsAttempted=true;
 p.renderMessages(view,[{role:'user',text:'Already reading'},{role:'assistant',text:'An existing answer'}]);
 const button=view.root.querySelector('.abstractin-initialize-contents');assert.equal(button.hidden,false);assert.equal(button.title,'Initialize contents');
 view.input.value='Keep this unsent draft';const calls=[];p.startRequest=async(...args)=>{calls.push(args);};
 button.click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(calls.length,1);assert.equal(calls[0][4].readingAction,'contents');assert.equal(p._drafts.get(ctx.dir).text,'Keep this unsent draft');
 await p.saveReadingAction(ctx,'contents',response);p.updateReadingControls(view);
 assert.equal(button.title,'Reinitialize contents');button.click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,2);
 p._pending.set(ctx.dir,{});p.updateReadingControls(view);assert.equal(button.disabled,true);await p.initializeBookContents(view.root);assert.equal(calls.length,2);p._pending.clear();
 ctx.reading.type='paper';p.updateReadingControls(view);assert.equal(button.hidden,true);
});


test('flattened OCR contents split into separate verified rows, including repeated directory pages', async()=>{
 const {plugin:p,ctx,dir,notes}=await setup();
 const front="Editor’s No t e ........ . — iii Preface ........ v";
 const first='§ 1. A x io m s........ 2 § 2. The relation to experimental data....... 3 §3. Notes on terminology....... 5 § 4. Immediate corollaries of the axiom s; conditional proba bilities ; Theorem of Bayes....... 6 § 5. Independence....... 8 § 6. Conditional probabilities as random variables; Markov c h a in s....... 12';
 const last='§ 1. Conditional probabilities....... 47 § 2. Explanation of a Borel paradox....... 50 § 3. Conditional probabilities with respect to a random vari able ....... 51 § 4. Conditional mathematical expectations....... 52 Appendix—Zero-or-one law in the theory of probability....... 69 Bibliography ....... 71';
 const source='## PDF page 1; pageIndex 0\nContents\n'+front+'\n'+first+'\n## PDF page 2; pageIndex 1\n'+last+'\n## PDF page 3; pageIndex 2\n'+last;
 await writeFile(join(dir,'source-text.md'),source);ctx.reading.action='contents';await p.prepareContentsSource(ctx);
 const expected=ctx.reading.contentsPlan.expected;
 assert.equal(expected.length,14);assert.equal(ctx.reading.contentsPlan.pages.length,3);
 assert.equal(expected[0].title,'Editor’s No t e');assert.equal(expected[0].printedPageLabel,'iii');
 assert.equal(expected[2].title,'§ 1. A x io m s');assert.equal(expected[2].printedPageLabel,'2');
 const corrections=new Map([['Editor’s No t e',"Editor's Note"],['§ 1. A x io m s','§ 1. Axioms'],['§ 4. Immediate corollaries of the axiom s; conditional proba bilities ; Theorem of Bayes','§ 4. Immediate corollaries of the axioms; conditional probabilities; Theorem of Bayes'],['§ 6. Conditional probabilities as random variables; Markov c h a in s','§ 6. Conditional probabilities as random variables; Markov chains'],['§ 3. Conditional probabilities with respect to a random vari able','§ 3. Conditional probabilities with respect to a random variable']]);
 let calls=0;p.runBackend=async(_,request)=>{
  calls++;for(const item of expected)assert.ok(request.question.includes(item.title));
  const entries=expected.map(item=>({title:corrections.get(item.title)||item.title,printedPageLabel:item.printedPageLabel,evidence:'OCR-normalized quotation'}));
  return{text:'Complete.\n<abstractin-workspace>'+JSON.stringify({kind:'contents',entries:[...entries,entries[0]]})+'</abstractin-workspace>'};
 };
 const result=await p.runContentsInitialization('claude',{ctx,question:'Initialize',onProgress(){}},{progress(){}});
 assert.equal(result.error,undefined);assert.equal(calls,1);
 await p.saveReadingAction(ctx,'contents',result.text);
 const saved=p.readingArtifactData(notes[0]);assert.equal(saved.entries.length,14);assert.equal(saved.complete,true);
 assert.equal(saved.entries[0].title,"Editor's Note");assert.equal(saved.entries[0].evidence,'Editor’s No t e ........ . — iii');
 assert.equal(saved.entries[2].evidence,'§ 1. A x io m s........ 2');
});

test('wrapped OCR headings keep exact evidence and cannot cover a different title or page',async()=>{
 const {plugin:p,ctx,dir,notes}=await setup();
 assert.equal(p.contentsEntryMatches({title:'Axioms',printedPageLabel:'2'},{title:'A x io m s',printedPageLabel:'2'}),true);
 const source='## PDF page 1; pageIndex 0\nContents\nChapter I\n§ 1. Conditional proba-\nbilities as random vari-\nables ....... 12\n§ 2. Independence\n....... 18\nBibliography\n71';
 await writeFile(join(dir,'source-text.md'),source);await p.prepareContentsSource(ctx);
 const expected=ctx.reading.contentsPlan.expected;assert.equal(expected.length,3);
 assert.equal(expected[0].title,'§ 1. Conditional proba- bilities as random vari- ables');
 const entries=[{title:'§ 1. Conditional probabilities as random variables',printedPageLabel:'12',evidence:'cleaned'}, {title:'§ 2. Independence',printedPageLabel:'18',evidence:'cleaned'}, {title:'Bibliography',printedPageLabel:'71',evidence:'cleaned'}];
 const response='Complete.\n<abstractin-workspace>'+JSON.stringify({kind:'contents',coverage:'Complete detected contents',entries})+'</abstractin-workspace>';
 await p.saveReadingAction(ctx,'contents',response);assert.equal(p.readingArtifactData(notes[0]).entries.length,3);
 assert.equal(p.contentsEntryMatches({...entries[0],title:'Conditional probabilities'},expected[0]),false);
 assert.equal(p.contentsEntryMatches({...entries[0],printedPageLabel:'13'},expected[0]),false);
 assert.equal(p.contentsEntryMatches({...entries[0],title:'Conditional expectations as random variables'},expected[0]),false);
 const before=notes[0].html;entries[0].title='Conditional expectations as random variables';
 await assert.rejects(p.saveReadingAction(ctx,'contents','Complete.\n<abstractin-workspace>'+JSON.stringify({kind:'contents',coverage:'Complete',entries})+'</abstractin-workspace>'),/incomplete/);
 assert.equal(notes[0].html,before);
});

test('OCR heading cleanup restores readable titles, retaining source evidence and existing chapter IDs',async()=>{
 const {plugin:p,ctx,dir,notes}=await setup();
 const titles=['V. C o n d itio n a l P r o b a b i l i t i e s a n d M a th e m a tic a l E x p ectatio n s','VI. In d e p e n d e n c e; T h e L aw o f L a r g e N u m b e rs'];
 const clean=['V. Conditional Probabilities and Mathematical Expectations','VI. Independence; The Law of Large Numbers'];
 const rows=titles.map((title,index)=>title+' .... '+(47+index*10));
 await writeFile(join(dir,'source-text.md'),'## PDF page 1; pageIndex 0\nContents\n'+rows.join('\n'));
 const old={kind:'contents',coverage:'PDF page 1',entries:titles.map((title,index)=>({id:'existing-'+index,title,printedPageLabel:String(47+index*10),evidence:rows[index]}))};
 await p.saveReadingAction(ctx,'contents','Old directory.\n<abstractin-workspace>'+JSON.stringify(old)+'</abstractin-workspace>');
 await p.prepareContentsSource(ctx);ctx.reading.action='contents';
 let calls=0;p.runBackend=async(_,request)=>{
  calls++;
  if(calls===1){assert.match(request.question,/Restore normal word spacing/);return{text:'Complete.\n<abstractin-workspace>'+JSON.stringify({...old,entries:old.entries.map((entry,index)=>({...entry,id:'new-'+index}))})+'</abstractin-workspace>'};}
  assert.match(request.question,/OCR typography pass/);assert.equal(request.session,null);assert.equal(request.history.length,0);
  return{text:'Corrected.\n<abstractin-workspace>'+JSON.stringify({kind:'contents',entries:clean.map((title,index)=>({id:'ocr-'+index,title,evidence:'must not overwrite source',printedPageLabel:'999'}))})+'</abstractin-workspace>'};
 };
 const result=await p.runContentsInitialization('claude',{ctx,question:p.readingActionPrompt(ctx,'contents'),onProgress(){}},{progress(){}});
 assert.equal(result.error,undefined);assert.equal(calls,2);await p.saveReadingAction(ctx,'contents',result.text);
 const saved=p.readingArtifactData(notes[0]);assert.equal(saved.entries.length,2);
 for(let index=0;index<2;index++){
  assert.equal(saved.entries[index].title,clean[index]);assert.equal(saved.entries[index].id,'existing-'+index);
  assert.equal(saved.entries[index].evidence,rows[index]);assert.equal(saved.entries[index].printedPageLabel,String(47+index*10));
 }
});

test('OCR heading cleanup rejects rewritten words and preserves existing contents on failure',async()=>{
 const {plugin:p,ctx,notes,response}=await setup();await p.saveReadingAction(ctx,'contents',response);const before=notes[0].html;
 const entries=[{title:'V. C o n d itio n a l P r o b a b i l i t i e s',printedPageLabel:'47',evidence:'original'}];
 let calls=0;p.runBackend=async()=>{calls++;return{text:'<abstractin-workspace>'+JSON.stringify({kind:'contents',entries:[{id:'ocr-0',title:'V. Conditional Expectations'}]})+'</abstractin-workspace>'};};
 const result=await p.repairContentsTitles('claude',{ctx,onProgress(){}},{progress(){}},entries);
 assert.match(result.error,/could not be verified/);assert.equal(calls,2);assert.equal(entries[0].title,'V. C o n d itio n a l P r o b a b i l i t i e s');assert.equal(notes[0].html,before);
 const cancelled=await p.repairContentsTitles('claude',{ctx,onProgress(){}},{cancelled:true,progress(){}},entries);
 assert.equal(cancelled.cancelled,true);assert.equal(calls,2);
 p.runBackend=async()=>({text:'<abstractin-workspace>'+JSON.stringify({kind:'contents',entries:[{id:'wrong-id',title:entries[0].title}]})+'</abstractin-workspace>'});
 assert.match((await p.repairContentsTitles('claude',{ctx,onProgress(){}},{progress(){}},entries)).error,/could not be verified/);
});


test('readable OCR titles still navigate to their original spaced chapter headings',async()=>{
 const {plugin:p,ctx,dir,view}=await setup();
 const title='V. Conditional Probabilities',raw='V. C o n d itio n a l P r o b a b i l i t i e s';
 await writeFile(join(dir,'source-text.md'),'## PDF page 1; pageIndex 0\nContents\n'+raw+' .... 47\n## PDF page 2; pageIndex 1\nPreface\n## PDF page 3; pageIndex 2\n'+raw+'\nChapter body.');
 p.readingPDFApplication=()=>null;let location;p.navigateReading=async(_,value)=>{location=value;};
 await p.openReadingContentsEntry(view,{title,printedPageLabel:'47'});assert.equal(location.pageIndex,2);
});


test('OCR-corrected unpaged chapter headings retain verified evidence alongside complete numbered sections',async()=>{
 const {plugin:p,ctx,dir,notes}=await setup();
 const raw='V. C o n d itio n a l P r o b a b i l i t i e s',title='V. Conditional Probabilities';
 const source='## PDF page 1; pageIndex 0\nContents\n'+raw+'\n§ 1. Conditional probabilities .... 47\n§ 2. Borel paradox .... 50';
 await writeFile(join(dir,'source-text.md'),source);await p.prepareContentsSource(ctx);
 assert.equal(ctx.reading.contentsPlan.expected.length,2);
 const data={kind:'contents',coverage:'Complete contents page',entries:[{id:'ch-05',title,printedPageLabel:null,evidence:raw},...ctx.reading.contentsPlan.expected.map(entry=>({...entry,evidence:entry.line}))]};
 const envelope=()=> 'Complete.\n<abstractin-workspace>'+JSON.stringify(data)+'</abstractin-workspace>';
 await p.saveReadingAction(ctx,'contents',envelope());
 let saved=p.readingArtifactData(notes[0]);assert.equal(saved.entries.length,3);assert.equal(saved.entries[0].title,title);assert.equal(saved.entries[0].evidence,raw);assert.equal(saved.complete,true);
 // Recover verbatim evidence even if the agent incorrectly cleans its quotation too.
 data.entries[0].evidence=title;await p.saveReadingAction(ctx,'contents',envelope());
 saved=p.readingArtifactData(notes[0]);assert.equal(saved.entries[0].evidence,raw);assert.equal(saved.entries[0].id,'ch-05');
 // Word substitutions remain unverified even when every required row is present.
 const before=notes[0].html;data.entries[0].title='V. Conditional Expectations';data.entries[0].evidence=raw;
 await assert.rejects(p.saveReadingAction(ctx,'contents',envelope()),error=>{
  assert.match(error.message,/1 returned entries could not be verified/);assert.match(error.message,/Conditional Expectations/);assert.doesNotMatch(error.message,/0 source entries/);return true;
 });assert.equal(notes[0].html,before);
});
