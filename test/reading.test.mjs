import test from "node:test";
import assert from "node:assert/strict";
import { loadPlugin } from "./load-plugin.mjs";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("reading routes books and papers, leaving unknown materials for the user", () => {
	const { plugin: p } = loadPlugin();
	assert.equal(p.readingType({ itemType: "book" }), "book");
	assert.equal(p.readingType({ itemType: "journalArticle" }), "paper");
	assert.equal(p.readingType({ itemType: "conferencePaper" }), "paper");
	assert.equal(p.readingType({ itemType: "document" }), "");
	assert.equal(p.readingType({ itemType: "bookSection" }), "");
});

test("skill discovery uses the local Windows directory and never substitutes a missing skill", async () => {
	const { plugin: p, window } = loadPlugin();
	window.Subprocess.getEnvironment = () => ({ USERPROFILE: "C:/Users/SZhang" });
	const expected = "C:/Users/SZhang/.codex/skills/book-reading/SKILL.md";
	window.OS.File = { exists: async path => path === expected };
	window.Zotero.File = { getContentsAsync: async () => "# Book reading\nAnswer only user questions." };
	assert.equal((await p.findReadingSkill("book")).path, expected);
	await assert.rejects(() => p.findReadingSkill("paper"), /scientific-paper-reading/);
});

test("reading prompts name the original skill and exact attachment, without whole-document exports", () => {
	const { plugin: p } = loadPlugin({ prefs: { "extensions.abstractin.language": "中文" } });
	const ctx = { paperItem: { key: "BOOK1234", libraryID: 1 }, attachmentItem: { key: "PDF12345" },
		reading: { type: "book", language: "中文", skillPath: "C:/skills/book-reading/SKILL.md" } };
	const prompt = p.readingPrompt(ctx, { text: "A proof", pageLabel: "xiv", position: { pageIndex: 17 } });
	assert.match(prompt, /C:\/skills\/book-reading\/SKILL.md/);
	assert.match(prompt, /PDF12345/);
	assert.match(prompt, /xiv/);
	assert.match(prompt, /17/);
	assert.match(prompt, /中文/);
	assert.match(prompt, /not by reading the whole book by default/);
});

test("record envelopes keep mathematical answers separate from concise saved records", () => {
	const { plugin: p } = loadPlugin();
	const text = 'Use $x^2$.\n<abstractin-record>{"title":"A limit","summary":"The bound uses continuity.","openQuestions":["Check the hypothesis."]}</abstractin-record>';
	const result = p.parseReadingAnswer(text);
	assert.equal(result.answer, "Use $x^2$.");
	assert.equal(result.record.summary, "The bound uses continuity.");
	assert.equal(p.readingVisibleText(text), "Use $x^2$.");
	assert.equal(p.parseReadingAnswer("An answer without a record").record, null);
	assert.equal(p.parseReadingAnswer('Answer\n<abstractin-record>{"summary":""}</abstractin-record>').record, null);
	assert.equal(p.readingVisibleText('Answer\n<abstractin-rec'), "Answer");
});

test("saved reading notes use the correct library, parent and verifiable PDF locations", async () => {
	const { plugin: p, window } = loadPlugin();
	const saved = [];
	window.Zotero.Libraries = { get: () => ({ libraryType: "user" }) };
	window.Zotero.Item = class {
		constructor(type) { this.type = type; this.key = "NOTE1234"; }
		setNote(html) { this.html = html; }
		addTag(tag) { this.tag = tag; }
		async saveTx() { saved.push(this); }
	};
	const ctx = { paperItem: { id: 9, key: "BOOK1234", libraryID: 1 }, attachmentItem: { key: "PDF12345" }, reading: { type: "book" } };
	const key = await p.saveReadingRecord(ctx, "Why <script>?", { text: "Quoted <text>", pageLabel: "xiv", position: { pageIndex: 17 } },
		{ title: "Continuity", summary: "Use $x_1$.", openQuestions: [] });
	assert.equal(key, "NOTE1234");
	assert.equal(saved[0].parentID, 9);
	assert.equal(saved[0].libraryID, 1);
	assert.match(saved[0].html, /zotero:\/\/open-pdf\/library\/items\/PDF12345\?page=18/);
	assert.match(saved[0].html, /Printed page label: xiv/);
	assert.match(saved[0].html, /&lt;script&gt;/);
	assert.match(saved[0].html, /&lt;text&gt;/);
	assert.match(saved[0].html, /<span class="math">/);
});

for (const fallback of [false, true]) test("selected-passage flow saves exactly one concise record" + (fallback ? " after model fallback" : ""), async () => {
	const { plugin: p } = loadPlugin();
	let request, record, runs = 0, saves = 0;
	const history = [];
	p.exportContext = async () => ({ metadata: "# Book", annotations: "" });
	p.exportReadingRecords = async () => "# Existing records";
	p.exportReadingWorkspace = async () => {};
	p.loadHistory = async () => history;
	p.loadSessions = async () => ({});
	p.appendHistory = async (dir, messages) => history.push(...messages);
	p.saveSessions = async () => {};
	p.appendClarification = async () => {};
	p.findReadingSkill = async () => ({ path: "C:/skills/book-reading/SKILL.md" });
	p.stageReadingSkill = async (ctx, skill) => skill.path;
	p.runBackend = async (backend, req) => {
		assert.equal(backend, "codex"); request = req;
		if (++runs === 1 && fallback) return { text: "", error: "The selected model is not supported when using Codex with a ChatGPT account." };
		return { text: 'Answer $x$.\n<abstractin-record>{"title":"Proof","summary":"A local argument.","openQuestions":[]}</abstractin-record>', sessionId: "s1" };
	};
	p.saveReadingRecord = async (ctx, question, selection, value) => { saves++; record = value; return "NOTE1234"; };
	const ctx = { dir: "/tmp/book/pdf", paperItem: { id: 9, key: "BOOK1234", libraryID: 1 },
		attachmentItem: { id: 7, key: "PDF12345" }, reading: { type: "book", language: "English", skillPath: "C:/skills/book-reading/SKILL.md" } };
	const pending = { backend: "codex", model: "gpt-6.1-sol", selection: { attachmentID: 7, text: "A proof", pageLabel: "3", position: { pageIndex: 8 } }, progress() {} };
	const result = await p.ask(ctx, "Why?", pending);
	assert.equal(result.recordKey, "NOTE1234");
	assert.match(request.question, /book-reading\/SKILL.md/);
	assert.equal(history[1].text, "Answer $x$.");
	assert.equal(record.summary, "A local argument.");
	assert.equal(history[1].recordKey, "NOTE1234");
	assert.equal(saves, 1);
	assert.equal(runs, fallback ? 2 : 1);
	assert.equal(!!result.modelFallback, fallback);
});

test("a passage from another attachment cannot reach the agent or be saved under the current one", async () => {
	const { plugin: p } = loadPlugin();
	p.exportContext = async () => { throw new Error("Must not export"); };
	const result = await p.ask({ dir: "/tmp/a", attachmentItem: { id: 7 }, reading: { type: "book" } }, "Why?",
		{ backend: "codex", selection: { attachmentID: 8 } });
	assert.match(result.error, /attachment/);
});

function filesystem(window) {
	window.OS.Path.join = join;
	window.OS.File = {
		exists: async path => { try { await stat(path); return true; } catch { return false; } },
		copy: copyFile,
		stat,
		DirectoryIterator: class {
			constructor(path) { this.path = path; }
			async forEach(callback) {
				for (const entry of await readdir(this.path, { withFileTypes: true })) {
					callback({ name: entry.name, path: join(this.path, entry.name), isDir: entry.isDirectory(), isSymLink: entry.isSymbolicLink() });
				}
			}
			close() {}
		},
	};
	window.Zotero.File = {
		createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }),
		getContentsAsync: path => readFile(path, "utf8"),
		putContentsAsync: (path, text) => writeFile(path, text),
	};
}

for (const type of ["book", "paper"]) {
	test(type + ": real skill files, mocked CLI transport, rendered answer and Zotero child note form one reading loop", async () => {
		const skillRoot = fileURLToPath(new URL("../skills/", import.meta.url));
		const { plugin: p, window, document } = loadPlugin({ prefs: {
			"extensions.abstractin.onboarded": true, "extensions.abstractin.readingSkillsDir": skillRoot,
			"extensions.abstractin.language": "English",
		} });
		filesystem(window);
		window.Zotero.DataDirectory = { dir: await mkdtemp(join(tmpdir(), "abstractin-loop-")) };
		const notes = [];
		const parent = { id: 9, key: "ITEM0001", libraryID: 1, itemType: type === "book" ? "book" : "journalArticle",
			isRegularItem: () => true, getField: field => field === "title" ? "Source title" : "",
			getCreators: () => [], getNotes: () => notes.map(note => note.id) };
		const attachment = { id: 7, key: "PDF00001", parentItem: parent, isAttachment: () => true,
			isPDFAttachment: () => true, isFileAttachment: () => true, getAnnotations: () => [] };
		const pdfPath = join(window.Zotero.DataDirectory.dir, "test.pdf");
		await writeFile(pdfPath, "%PDF-1.7 test transport");
		attachment.getFilePathAsync = async () => pdfPath;
		window.Zotero.PDFWorker = { getFullText: async () => ({ text: "Title\fContents\fOriginal proof", totalPages: 3, extractedPages: 3 }) };
		parent.getBestAttachment = async () => attachment;
		window.Zotero.Items = { get: id => notes.find(note => note.id === id) };
		window.Zotero.Libraries = { get: () => ({ libraryType: "user" }) };
		window.Zotero.Item = class {
			constructor() { this.key = "NOTE" + String(notes.length + 1).padStart(4, "0"); this.id = 30 + notes.length; this.tags = []; }
			setNote(html) { this.html = html; }
			getNote() { return this.html; }
			addTag(tag) { if (!this.tags.includes(tag)) this.tags.push(tag); }
			getTags() { return this.tags.map(tag => ({ tag })); }
			async saveTx() { if (!notes.includes(this)) notes.push(this); }
		};
		window.Subprocess.getEnvironment = () => ({ HOME: "/local", PATH: "/bin" });
		window.Subprocess.pathSearch = async () => "/bin/codex";
		let invocation, submittedPrompt;
		window.Subprocess.call = async options => {
			invocation = options;
			let output = [JSON.stringify({ type: "thread.started", thread_id: "THREAD1" }) + "\n" +
				JSON.stringify({ type: "item.completed", item: { type: "agent_message", text:
					'由所选段落的假设可得 $x_1=0$（印刷页 xiv）。\n<abstractin-record>{"title":"Local proof","summary":"The hypothesis implies $x_1=0$.","openQuestions":[]}</abstractin-record>' } }) + "\n", ""];
			return { stdin: { write: async buffer => { submittedPrompt = new TextDecoder().decode(buffer); }, close() {} }, stdout: { readString: async () => output.shift() || "" },
				stderr: { readString: async () => "" }, wait: async () => ({ exitCode: 0 }) };
		};
		const body = document.createElement("div"); document.body.appendChild(body);
		p.renderSkeleton(document, body);
		const root = body.querySelector(".zs-root");
		const ctx = await p.getContext(parent);
		const view = { doc: document, root, ctx, input: root.querySelector(".zs-input"), logEl: root.querySelector(".zs-log"),
			send: (text, images) => p.sendText(view, text, images) };
		p._views.set(root, view);
		await p.activateReading(view, attachment, { type, language: "中文" });
		p.startRequest(view, "Why does this step work?", [], [], { selection: {
			text: "The hypothesis", attachmentID: 7, pageLabel: "xiv", position: { pageIndex: 8 },
		} });
		const pending = p._pending.get(view.ctx.dir);
		const result = await pending.promise;
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.equal(result.recordKey, "NOTE0001");
		assert.equal(invocation.workdir, view.ctx.dir);
		assert.equal(invocation.arguments[invocation.arguments.indexOf("--sandbox") + 1], "read-only");
		assert.equal(invocation.arguments.at(-1), "-");
		assert.match(submittedPrompt, /Always reply in English/);
		assert.doesNotMatch(submittedPrompt, /Reply in 中文/);
		assert.match(submittedPrompt, type === "book" ? /book-reading/ : /scientific-information-extraction/);
		assert.match(submittedPrompt, /source-text.md/);
		assert.match(await readFile(join(view.ctx.dir, "source-text.md"), "utf8"), /Original proof/);
		assert.equal(notes.filter(n => !n.tags.includes("AbstractIn:Chat")).length, 1);
		assert.equal(notes[0].parentID, 9);
		assert.match(notes[0].html, /PDF00001\?page=9/);
		assert.ok(root.querySelector("math"), "the final answer renders real mathematics");
		assert.ok(root.textContent.includes("Reading record saved"));
		assert.ok(!root.textContent.includes("abstractin-record"));
		const path = join(view.ctx.dir, ".agents", "skills", type === "book" ? "book-reading" : "scientific-paper-reading", "SKILL.md");
		const original = join(skillRoot, type === "book" ? "scientific-book-reading" : "scientific-paper-reading", "SKILL.md");
		assert.equal(await readFile(path, "utf8"), await readFile(original, "utf8"));
		// User edits to Zotero notes are visible to later questions through a derived snapshot.
		notes[0].html += "<p>User corrected the hypothesis.</p>";
		assert.match(await p.exportReadingRecords(view.ctx), /User corrected the hypothesis/);
	});
}

test("group-library source links keep the stable Zotero group identity", () => {
	const { plugin: p, window } = loadPlugin();
	window.Zotero.Libraries = { get: () => ({ libraryType: "group" }) };
	window.Zotero.Groups = { getGroupIDFromLibraryID: () => 12345 };
	assert.equal(p.readingPDFLink({ paperItem: { libraryID: 5 }, attachmentItem: { key: "PDF12345" } }, { position: { pageIndex: 1 } }),
		"zotero://open-pdf/groups/12345/items/PDF12345?page=2");
});

test("Windows npm shims resolve to the native executable without a shell", async () => {
	const { plugin: p, window } = loadPlugin();
	filesystem(window);
	const folder = await mkdtemp(join(tmpdir(), "abstractin-codex-"));
	const native = join(folder, "node_modules", "@openai", "codex", "vendor", "target", "codex", "codex.exe");
	await mkdir(join(native, ".."), { recursive: true });
	await writeFile(native, "fixture");
	assert.equal(await p.windowsCodexExecutable(join(folder, "codex.cmd")), native);
	await assert.rejects(() => p.windowsCodexExecutable(join(folder, "missing", "codex.cmd")), /native codex.exe/);
});

test("Start Reading uses the shared language setting without a separate language selector", async () => {
	const { plugin: p, window, document } = loadPlugin({ prefs: { "extensions.abstractin.onboarded": true, "extensions.abstractin.language": "中文" } });
	p.findBinary = async () => "/bin/codex";
	p.findReadingSkill = async () => ({ path: "/skills/book-reading/SKILL.md" });
	const parent = { id: 9, key: "BOOK1234", libraryID: 1, itemType: "document", getAttachments: () => [7, 8] };
	const attachments = [7, 8].map(id => ({ id, key: "PDF0000" + id, isPDFAttachment: () => true, getField: () => "PDF " + id }));
	window.Zotero.Items = { get: id => attachments.find(item => item.id === id) };
	const body = document.createElement("div"); document.body.appendChild(body); p.renderSkeleton(document, body);
	const root = body.querySelector(".zs-root");
	const view = { doc: document, root, ctx: { paperItem: parent, attachmentItem: attachments[0], dir: "/tmp/a" } };
	p._views.set(root, view);
	let chosen;
	p.activateReading = async (view, item, options) => { chosen = { item, options }; };
	await p.openReadingSetup(root);
	const selects = root.querySelectorAll(".zs-reading-panel select");
	assert.equal(selects.length, 2);
	assert.ok(!root.querySelector(".zs-reading-panel").textContent.includes("Conversation language"));
	assert.equal(selects[1].value, "", "unknown document types are never silently classified");
	root.querySelector(".zs-reading-confirm").click();
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.ok(root.textContent.includes("Choose Book or Scientific paper"));
	assert.equal(chosen, undefined);
	selects[0].value = "8"; selects[1].value = "book";
	root.querySelector(".zs-reading-confirm").click();
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.equal(chosen.item.id, 8);
	assert.equal(chosen.options.language, undefined);
	assert.equal(root.querySelector(".zs-reading-panel"), null);
});

test("reading language follows shared preferences even with an older saved reading language", () => {
	const { plugin: p } = loadPlugin({ prefs: { "extensions.abstractin.language": "Français" } });
	const ctx = { reading: { type: "book", language: "English", skillPath: "/skill/SKILL.md" }, paperItem: {}, attachmentItem: {} };
	assert.match(p.readingPrompt(ctx), /Always reply in Français/);
	assert.match(p.systemPrompt(ctx), /Always reply in Français/);
	p.setPref("language", "中文");
	assert.match(p.codexPrompt({ ctx, history: [], files: {}, question: "Why?", session: { id: "session", seen: 0 } }), /Always reply in 中文/);
	p.setPref("language", "");
	assert.match(p.readingPrompt(ctx), /Reply in the language the user writes in/);
	assert.ok(!p.systemPrompt(ctx).includes("Reply in English"));
});

test("bundled fallback reads the current source checkout and preserves every original resource", async () => {
	const { plugin: p, window } = loadPlugin();
	filesystem(window);
	window.Zotero.DataDirectory = { dir: await mkdtemp(join(tmpdir(), "abstractin-bundle-")) };
	await mkdir(p.getDataDir());
	p.rootURI = new URL("../src/", import.meta.url).href;
	window.Subprocess.getEnvironment = () => ({ HOME: "/nonexistent/abstractin-test-home" });
	window.fetch = async url => ({ ok: true, text: () => readFile(fileURLToPath(url), "utf8") });
	const skill = await p.findReadingSkill("book");
	assert.equal(skill.content, await readFile(new URL("../skills/scientific-book-reading/SKILL.md", import.meta.url), "utf8"));
	const paper = await p.findReadingSkill("paper");
	assert.match(await readFile(join(paper.path, "..", "REPORT-FORMAT.md"), "utf8"), /four major sections/);
	assert.match((await p.findReadingSkill("extraction")).content, /inference-depth budget/);
});

test("a failed Zotero save keeps the answer and reports the failure instead of claiming persistence", async () => {
	const { plugin: p } = loadPlugin();
	const history = [];
	p.prepareReadingSkills = async ctx => ctx.reading;
	p.exportContext = async () => ({});
	p.exportReadingRecords = async () => "";
	p.exportReadingWorkspace = async () => {};
	p.exportReadingSource = async () => ({ status: "ready" });
	p.loadHistory = async () => history;
	p.loadSessions = async () => ({});
	p.appendHistory = async (dir, messages) => history.push(...messages);
	p.runBackend = async () => ({ text: 'An answer.\n<abstractin-record>{"title":"Record","summary":"Conclusion.","openQuestions":[]}</abstractin-record>' });
	p.saveReadingRecord = async () => { throw new Error("Library is read-only"); };
	const result = await p.ask({ dir: "/tmp/a", reading: { type: "book", skillPath: "/skill/SKILL.md" }, paperItem: { key: "A", libraryID: 1 }, attachmentItem: { key: "B" } },
		"Why?", { backend: "codex", progress() {} });
	assert.match(result.recordWarning, /Library is read-only/);
	assert.equal(result.recordKey, undefined);
	assert.equal(history[1].text, "An answer.");
	assert.equal(history[1].recordWarning, result.recordWarning);
});
