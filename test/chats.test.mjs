import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, access, stat, readdir, rename } from "node:fs/promises";
import { join, basename, normalize } from "node:path";
import { tmpdir } from "node:os";
import { webcrypto } from "node:crypto";
import { loadPlugin } from "./load-plugin.mjs";

async function setup(type = "book") {
 const env = loadPlugin({ prefs: { "extensions.abstractin.onboarded": true, "extensions.abstractin.readingEvidenceMode": "knowledge" } });
 const { plugin: p, window, document } = env;
 const data = await mkdtemp(join(tmpdir(), "abstractin-discussions-")); p.getDataDir = () => data;
 Object.defineProperty(window, "crypto", { value: webcrypto });
 window.OS = { Path: { join, basename, normalize }, File: { stat, copy: copyFile, exists: async path => { try { await access(path); return true; } catch { return false; } },
  writeAtomic: async (path, bytes, { tmpPath }) => { await writeFile(tmpPath, bytes); await rename(tmpPath, path); } } };
 window.Zotero.File = { createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }), getContentsAsync: path => readFile(path, "utf8"), putContentsAsync: writeFile,
  iterateDirectory: async (path, callback) => { for (const entry of await readdir(path, { withFileTypes: true })) callback({ name: entry.name, path: join(path, entry.name), isDir: entry.isDirectory() }); } };
 const notes = [], parent = { id: 1, libraryID: 1, key: "BOOK1234", getNotes: () => notes.map(n => n.id), getField: () => "Book", getCreators: () => [] };
 const pdfPath = join(data, "original.pdf"); await writeFile(pdfPath, "%PDF");
 const attachment = { id: 7, key: "PDF12345", getFilePathAsync: async () => pdfPath, isPDFAttachment: () => true };
 window.Zotero.Items = { get: id => notes.find(n => n.id === id), getByLibraryAndKey: () => parent };
 window.Zotero.Libraries = { get: () => ({ libraryType: "user" }) };
 window.Zotero.Item = class {
  constructor() { this.id = notes.length + 100; this.key = "NOTE" + this.id; this.tags = []; }
  setNote(text) { this.html = text; } getNote() { return this.html; }
  addTag(tag) { if (!this.tags.includes(tag)) this.tags.push(tag); } getTags() { return this.tags.map(tag => ({ tag })); }
  async saveTx() { if (!notes.includes(this)) notes.push(this); }
 };
 const toc = { entries: [
  { id: "ch-01", title: "1 Set function", pageIndex: 0 },
  { id: "ch-02", title: "2 Continuity", pageIndex: 5 },
  { id: "app-a", title: "Appendix A Proofs", pageIndex: 10 },
  { id: "app-01", title: "Appendix 1 Tables", pageIndex: 12 },
 ] };
 const artifactNotes = p.readingArtifactNotes.bind(p), artifactData = p.readingArtifactData.bind(p);
 p.readingArtifactNotes = (ctx, kind) => kind === "Contents" && type === "book" ? [{ fixture: toc }] : artifactNotes(ctx, kind);
 p.readingArtifactData = note => note?.fixture || artifactData(note);
 let location = { pageIndex: 1 };
 p.currentReadingLocation = () => location;
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 15, getOutline: async () => [] } });
 p.prepareReadingSkills = async ctx => ({ ...ctx.reading, skillPath: "/original-skill/SKILL.md" });
 p.rememberReadingPosition = async () => {};
 const dir = join(data, "1-BOOK1234", "reading-PDF12345"); await mkdir(dir, { recursive: true });
 await writeFile(join(dir, "reading.json"), JSON.stringify({ type, itemKey: parent.key, attachmentKey: attachment.key }));
 const ctx = await p.ensureDiscussion({ dir, paperItem: parent, attachmentItem: attachment, reading: { type, title: "Test book" } });
 const body = document.createElement("div"); document.body.append(body); p.renderSkeleton(document, body);
 const root = body.querySelector(".abstractin-root"), view = { doc: document, root, ctx, input: root.querySelector(".abstractin-input"), logEl: root.querySelector(".abstractin-log") };
 p._views.set(root, view); p.renderMessages(view, []);
 const requests = []; let threads = 0;
 p.runBackend = async (_, request) => { requests.push(request); return { text: "Answer: " + request.question.split("\n")[0], sessionId: request.session?.id || "thread-" + ++threads }; };
 async function send(question, options = {}) {
  await p.startRequest(view, question, [], [], options);
  const pending = p._pending.get(view.ctx.dir); if (pending) await pending.promise;
  await new Promise(resolve => setTimeout(resolve, 20));
 }
 return { ...env, p, ctx, view, dir, notes, parent, attachment, toc, requests, send, setLocation: value => { location = value; } };
}

test("chapter routing creates independent transcripts and restores the original agent thread", async () => {
 const { p, view, send, requests } = await setup();
 await send("Chapter 1: set definition"); const firstDir = view.ctx.dir, firstID = view.ctx.discussion.id;
 assert.match(requests.at(-1).history.length.toString(), /^0$/);
 const firstSession = (await p.loadSessions(firstDir)).codex.id;
 await send("Chapter 2: explain continuity"); const secondDir = view.ctx.dir;
 assert.notEqual(firstDir, secondDir); assert.equal(requests.at(-1).history.length, 0);
 await send("Chapter 1: continue the definition");
 assert.equal(view.ctx.dir, firstDir); assert.equal(view.ctx.discussion.id, firstID);
 assert.equal(requests.at(-1).session.id, firstSession);
 assert.equal((await p.loadHistory(secondDir)).length, 2);
 assert.equal((await p.loadHistory(firstDir)).length, 4);
 assert.ok(!requests.at(-1).question.includes("continuity"));
});

test("new discussion stays in its chapter and never clears the previous session", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: set definition");
 const dir = view.ctx.dir, sessions = JSON.stringify(await p.loadSessions(dir));
 await p.newChat(view.root); assert.equal(view.ctx.discussion.chapterID, "ch-01"); assert.equal(view.ctx.discussion.number, 2);
 assert.equal((await p.loadHistory(view.ctx.dir)).length, 0); assert.equal(JSON.stringify(await p.loadSessions(dir)), sessions);
 const index = await p.discussionIndex(view.ctx), old = index.chats.find(c => p.discussionContext(view.ctx, c).dir === dir);
 await p.switchDiscussion(view, old, index); assert.equal(JSON.stringify(await p.loadSessions(view.ctx.dir)), sessions);
});

test("selection, local page, follow-up and reference evidence follow subject-based routing", async () => {
 const { p, view, send, setLocation } = await setup(); await send("Chapter 1: sets");
 setLocation({ pageIndex: 7 }); const index = await p.discussionIndex(view.ctx);
 assert.equal(p.resolveDiscussionChapter(view.ctx, index, "What about theorem 2.1?", null, { pageIndex: 7 }).chapterID, "ch-01");
 assert.equal(p.resolveDiscussionChapter(view.ctx, index, "This step?", { position: { pageIndex: 7 } }, null).chapterID, "ch-02");
 assert.equal(p.resolveDiscussionChapter(view.ctx, index, "Explain this page", null, { pageIndex: 7 }).chapterID, "ch-02");
 assert.equal(p.resolveDiscussionChapter(view.ctx, index, "Here uses theorem 2.1; look up its proof in chapter 2", null, null).chapterID, "ch-01");
 view.ctx.reading.referenceNavigation = true;
 assert.equal(p.resolveDiscussionChapter(view.ctx, index, "Explain this page", null, { pageIndex: 7 }).chapterID, "ch-01");
 await send("Continue the explanation"); assert.equal(view.ctx.discussion.chapterID, "ch-01");
});

test("unverified chapter ranges require an explicit choice without losing the draft", async () => {
 const { p, view, toc } = await setup(); toc.entries[1].pageIndex = null;
 const index = await p.discussionIndex(view.ctx); index.chapters.find(c => c.id === "ch-02").pageIndex = null; await p.writeDiscussionIndex(view.ctx, index);
 view.input.value = "Explain this page";
 const sending = p.startRequest(view, view.input.value, [], [], { selection: { attachmentID: 7, position: { pageIndex: 7 }, text: "passage" } });
 for (let i = 0; i < 30 && !view.root.querySelector(".abstractin-chapter-choice"); i++) await new Promise(r => setTimeout(r, 5));
 const buttons = [...view.root.querySelectorAll(".abstractin-chapter-choice button")];
 assert.ok(buttons.length); buttons.find(b => b.textContent === "Cancel").click(); await sending;
 assert.equal(view.input.value, "Explain this page"); assert.equal(p._pending.size, 0);
});

test("appendix names, stable IDs and per-chapter discussion numbers survive renaming", async () => {
 const { p, view, send } = await setup(); await send("Appendix A: proof details");
 let index = await p.discussionIndex(view.ctx);
 assert.match(p.discussionName(view.ctx, view.ctx.discussion, index), /^chap-app-A_/);
 const id = view.ctx.discussion.id; await p.renameDiscussion(view, "Alternative proof");
 assert.equal(view.ctx.discussion.id, id);
 index = await p.discussionIndex(view.ctx); assert.match(p.discussionName(view.ctx, view.ctx.discussion, index), /alternative-proof$/);
 await send("Appendix 1: table question"); index = await p.discussionIndex(view.ctx);
 assert.match(p.discussionName(view.ctx, view.ctx.discussion, index), /^chap-app-01_/);
});

test("legacy migration preserves complete records and sessions, retains originals and is idempotent", async () => {
 const { p, view, dir } = await setup();
 const history = [{ role: "user", text: "old question", ts: 1 }, { role: "assistant", text: "$x=1$ and details", ts: 2 }];
 const source = join(dir, "chat.json"), archive = join(dir, "chat-2025.json");
 await writeFile(source, JSON.stringify(history)); await writeFile(archive, JSON.stringify(history));
 await p.saveSessions(dir, { codex: { id: "old-thread", seen: 2 } });
 const oldActive = view.ctx.discussion.id;
 await p.migrateLegacyDiscussions(view);
 let index = await p.discussionIndex(view.ctx), imported = index.chats.filter(c => c.migrated);
 assert.equal(imported.length, 1); assert.equal(index.active, oldActive); assert.equal(imported[0].chapterID, null);
 const next = p.discussionContext(view.ctx, imported[0]); assert.deepEqual(JSON.parse(JSON.stringify(await p.loadHistory(next.dir))), history);
 assert.equal((await p.loadSessions(next.dir)).codex.id, "old-thread");
 assert.equal(await readFile(source, "utf8"), JSON.stringify(history)); assert.equal(await readFile(archive, "utf8"), JSON.stringify(history));
 await p.migrateLegacyDiscussions(view); index = await p.discussionIndex(view.ctx); assert.equal(index.chats.filter(c => c.migrated).length, 1);
});

test("failed migration can resume without duplicating a transcript or losing the active selection", async () => {
 const { p, view, dir } = await setup(); const active = view.ctx.discussion.id;
 await writeFile(join(dir, "chat.json"), JSON.stringify([{ role: "user", text: "old" }]));
 const save = p.saveSessions; p.saveSessions = async () => { throw new Error("disk full"); };
 await assert.rejects(p.migrateLegacyDiscussions(view), /disk full/);
 assert.equal((await p.discussionIndex(view.ctx)).active, active);
 p.saveSessions = save; await p.migrateLegacyDiscussions(view);
 assert.equal((await p.discussionIndex(view.ctx)).chats.filter(c => c.migrated).length, 1);
});

test("history shows chapter groups and only offers migration when legacy transcripts exist", async () => {
 const { p, view, send, dir } = await setup(); await send("Chapter 2: question"); await send("Chapter 1: question");
 await writeFile(join(dir, "chat.json"), JSON.stringify([{ role: "user", text: "legacy" }]));
 p.openHistoryMenu(view.root); await new Promise(r => setTimeout(r, 40));
 let text = view.root.textContent;
 assert.ok(text.indexOf("1 Set function", text.indexOf("Chapters & discussions")) < text.indexOf("2 Continuity", text.indexOf("Chapters & discussions")));
 assert.match(text, /Migrate legacy discussions/); p.closeMenu(view.root);
 await p.migrateLegacyDiscussions(view); p.openHistoryMenu(view.root); await new Promise(r => setTimeout(r, 40));
 assert.doesNotMatch(view.root.querySelector(".abstractin-menu")?.textContent || "", /Migrate legacy discussions/);
});

test("plain text search covers chapter chats and jumps without deleting records or resetting sessions", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: a unique search phrase"); const firstDir = view.ctx.dir;
 const sessions = JSON.stringify(await p.loadSessions(firstDir)); await send("Chapter 2: another question");
 const results = p.searchChats(await p.loadAllChats(), "unique search phrase"); assert.ok(results.length);
 p.applyJump = v => { assert.equal(v.ctx.dir, firstDir); p._jump = null; };
 await p.openSearchResult(view.root, results[0]); assert.equal(view.ctx.dir, firstDir);
 assert.equal(JSON.stringify(await p.loadSessions(firstDir)), sessions); assert.ok(await readFile(join(firstDir, "chat.json"), "utf8"));
 assert.match(p.chatTitle(results[0].chat), /^chap-01_set-function_chat-01_/);
});

test("knowledge mode never reads other notes, extracts the PDF or escalates missing evidence automatically", async () => {
 const { p, view, send, requests } = await setup(); await send("Chapter 1: first topic");
 p.exportReadingSource = async () => { throw new Error("unrequested source access"); };
 p.readNativeReadingPage = async () => { throw new Error("unrequested page access"); };
 p.reuseCurrentReadingPage = async () => { throw new Error("unrequested cached page access"); };
 p.runBackend = async (_, request) => { requests.push(request); return { text: "<abstractin-source-needed>missing theorem</abstractin-source-needed>", sessionId: request.session?.id }; };
 const count = requests.length; await send("What does theorem 2.3 say?");
 assert.equal(requests.length, count + 1); assert.equal(requests.at(-1).ctx.reading.evidenceMode, "knowledge");
 assert.doesNotMatch(requests.at(-1).question, /verify the original source automatically|saved notes and previous conversation/);
 assert.match((await p.loadHistory(view.ctx.dir)).at(-1).text, /provide the passage or allow source verification/);
});

test("scoped source files expose only the selected chapter page and explicit cross-chapter evidence", async () => {
 const { p, view, send, window, dir } = await setup(); await send("Chapter 1: sets");
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15,
  text: Array.from({ length: 15 }, (_, i) => i === 6 ? "Theorem 2.3: proof from continuity." : "PAGE-" + i).join("\f") }) };
 const ctx = { ...view.ctx, reading: { ...view.ctx.reading, evidenceMode: "source", action: "discuss", currentPage: { pageIndex: 1 }, sourceQuestion: "Explain this step" } };
 const source = await p.exportReadingSource(ctx); assert.equal(source.status, "ready");
 let text = await readFile(join(ctx.dir, "source-text.md"), "utf8"); assert.match(text, /PAGE-1/); assert.doesNotMatch(text, /PAGE-5|Theorem 2.3/);
 assert.equal(await window.OS.File.exists(join(ctx.dir, "source.pdf")), false); assert.equal(await window.OS.File.exists(join(dir, "source.pdf")), true);
 ctx.reading.explicitSourceRequest = true; ctx.reading.sourceQuestion = "Here uses theorem 2.3; look up its proof in the book";
 await p.exportReadingSource(ctx); text = await readFile(join(ctx.dir, "source-text.md"), "utf8"); assert.match(text, /Theorem 2.3/); assert.doesNotMatch(text, /PAGE-12/);
 assert.equal(ctx.discussion.chapterID, "ch-01");
});

test("native agent tool flags prevent cross-directory file reads in scoped discussions", async () => {
 const { p, view } = await setup();
 const request = { ctx: { ...view.ctx, reading: { ...view.ctx.reading, evidenceMode: "source" } }, question: "q", history: [], session: { id: "session", seen: 0 } };
 const args = p.codexArgs(request); assert.ok(args.includes("features.shell_tool=false")); assert.ok(args.includes("features.unified_exec=false"));
 assert.deepEqual(Array.from(args.slice(-3, -1)), ["resume", "session"]);
 const claude = p.claudeArgs(request); assert.equal(claude[claude.indexOf("--tools") + 1], "");
});

test("Zotero sync metadata reconstructs discussion groups without borrowing another chat", async () => {
 const { p, view, send, dir, notes } = await setup(); await send("Chapter 1: portable discussion");
 const selected = view.ctx.discussion.id; await send("Chapter 2: separate question");
 assert.ok(notes.some(n => n.html.includes('discussionID')));
 const local = await p.discussionIndex(view.ctx), recoveryDir = join(dir, "new-computer"); await mkdir(recoveryDir);
 const recovered = await p.ensureDiscussion({ ...view.ctx, discussion: undefined, documentDir: undefined, dir: recoveryDir });
 const index = await p.discussionIndex(recovered); assert.ok(index.chats.some(c => c.id === selected)); assert.equal(index.chats.length, local.chats.filter(c => c.topic !== "discussion").length);
 const first = p.discussionContext(recovered, index.chats.find(c => c.id === selected)); const history = await p.loadHistory(first.dir);
 assert.equal(history.length, 2); assert.match(history[0].text, /Chapter 1/); assert.doesNotMatch(history[0].text, /Chapter 2/);
 assert.equal(Object.keys(await p.loadSessions(first.dir)).length, 0);
});

test("papers keep a topic discussion across pages and long chats require a user choice", async () => {
 const { p, view, send, setLocation } = await setup("paper"); await send("Research question"); const id = view.ctx.discussion.id;
 setLocation({ pageIndex: 7 }); await send("Explain this page"); assert.equal(view.ctx.discussion.id, id);
 const history = [{ role: "user", text: "A".repeat(50000), ts: 1 }, { role: "assistant", text: "Keep this result", ts: 2 }];
 p.renderMessages(view, history); assert.ok(view.root.querySelector(".abstractin-discussion-budget")); assert.equal(view.ctx.discussion.id, id);
 p.chooseDiscussionTransfer(view, history); const checks = view.root.querySelectorAll(".abstractin-discussion-transfer input");
 assert.ok([...checks].every(c => !c.checked)); checks[1].checked = true;
 view.root.querySelector(".abstractin-discussion-transfer button").click(); await new Promise(r => setTimeout(r, 50));
 assert.notEqual(view.ctx.discussion.id, id); const copied = await p.loadHistory(view.ctx.dir);
 assert.equal(copied.length, 1); assert.equal(copied[0].text, "Keep this result"); assert.equal(copied[0].carriedFrom, id);
 assert.equal(Object.keys(await p.loadSessions(view.ctx.dir)).length, 0);
});

test("damaged index is reported and preserved instead of replacing all discussions", async () => {
 const { p, view, dir } = await setup(); const path = join(dir, "discussions.json"); await writeFile(path, "{damaged");
 await assert.rejects(p.discussionIndex(view.ctx)); assert.equal(await readFile(path, "utf8"), "{damaged");
});

test("an explicit source verification preserves the knowledge thread for the next turn", async () => {
 const { p, view, send, requests, window } = await setup(); await send("Chapter 1: sets");
 const id = requests.at(-1).session?.id || (await p.loadSessions(view.ctx.dir)).codex.id;
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15, text: Array.from({ length: 15 }, (_, i) => "PAGE " + i).join("\f") }) };
 await send("Here, look up the proof in the book"); assert.equal(requests.at(-1).ctx.reading.evidenceMode, "source");
 assert.equal(view.ctx.discussion.chapterID, "ch-01"); assert.equal(p.getReadingEvidenceMode(), "knowledge");
 await send("Continue with an intuitive explanation"); assert.equal(requests.at(-1).session.id, id);
 assert.equal(requests.at(-1).ctx.reading.evidenceMode, "knowledge");
});

test("PDF selection drafts follow the active discussion and survive a cold panel restore", async () => {
 const { p, view, send, attachment, parent } = await setup(); attachment.parentItem = parent; attachment.isAttachment = () => true;
 await send("Chapter 1: sets"); assert.equal(p.contextDirFor(attachment), view.ctx.dir);
 const draft = { text: "About this passage", send: false, selection: { attachmentID: 7, position: { pageIndex: 2 }, text: "Selected text" } };
 p._drafts.set(view.ctx.documentDir, draft); p.applyDraft(view);
 assert.equal(view.input.value, draft.text); assert.equal(view.draftSelection.selection.text, "Selected text");
 assert.equal(p._drafts.has(view.ctx.documentDir), false);
});

test("reading notes with the same topic stay independent in different discussions", async () => {
 const { p, view, send, notes } = await setup(); await send("Chapter 1: sets");
 const record = () => ({ title: "Definition", summary: "A result", openQuestions: [], sources: [], topicKey: "definition", scope: { level: "chapter", id: "ch-02", title: "Continuity" } });
 const first = record(); await p.saveReadingRecord({ ...view.ctx, reading: { ...view.ctx.reading, evidenceMode: "knowledge" } }, "q", null, first);
 assert.equal(first.scope.id, "ch-01", "question ownership takes precedence over a model's evidence chapter");
 await p.newChat(view.root); await p.saveReadingRecord({ ...view.ctx, reading: { ...view.ctx.reading, evidenceMode: "knowledge" } }, "q", null, record());
 const discussionNotes = notes.filter(n => !n.tags.includes("AbstractIn:Chat")); assert.equal(discussionNotes.length, 2);
 assert.ok(discussionNotes.every(n => n.html.includes("Discussion:")));
});

test("legacy search previews preserve archives and never replace the active discussion", async () => {
 const { p, view, dir } = await setup(); const id = view.ctx.discussion.id;
 const history = [{ role: "user", text: "legacy search text" }], path = join(dir, "chat-legacy.json"); await writeFile(path, JSON.stringify(history));
 const results = p.searchChats(await p.loadAllChats(), "legacy search text"); assert.equal(results.length, 1);
 await p.openSearchResult(view.root, results[0]); assert.equal(view.ctx.discussion.id, id);
 assert.ok(view.root.querySelector('[aria-label="Legacy discussion preview"]')); assert.equal(await readFile(path, "utf8"), JSON.stringify(history));
});
