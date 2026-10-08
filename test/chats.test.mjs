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
 const next = p.discussionContext(view.ctx, imported[0]); assert.deepEqual(JSON.parse(JSON.stringify(await p.loadHistory(next.dir))).map(({ referenceID, results, ...message }) => message), history);
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

test("history redraws the conversation area with chapter groups and legacy classification", async () => {
 const { p, view, send, dir } = await setup(); await send("Chapter 2: question"); await send("Chapter 1: question");
 await writeFile(join(dir, "chat.json"), JSON.stringify([{ role: "user", text: "legacy" }]));
 p.openHistoryMenu(view.root); await new Promise(r => setTimeout(r, 40));
 let text = view.root.textContent;
 assert.ok(text.indexOf("1 Set function", text.indexOf("Chapters & discussions")) < text.indexOf("2 Continuity", text.indexOf("Chapters & discussions")));
 assert.match(text, /Classify \/ reimport legacy discussions/); assert.equal(view.root.querySelector(".abstractin-menu"), null); await p.returnFromHistoryBrowser(view);
 await p.migrateLegacyDiscussions(view); p.openHistoryMenu(view.root); await new Promise(r => setTimeout(r, 40));
 assert.ok(view.root.querySelector(".abstractin-history-browser"));
});

test("plain text search covers chapter chats and jumps without deleting records or resetting sessions", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: a unique search phrase"); const firstDir = view.ctx.dir;
 const sessions = JSON.stringify(await p.loadSessions(firstDir)); await send("Chapter 2: another question");
 const results = p.searchChats(await p.loadAllChats(), "unique search phrase"); assert.ok(results.length);
 p.applyJump = v => { assert.equal(v.ctx.dir, firstDir); p._jump = null; };
 await p.openSearchResult(view.root, results[0]); assert.equal(view.ctx.dir, firstDir);
 assert.equal(JSON.stringify(await p.loadSessions(firstDir)), sessions); assert.ok(await readFile(join(firstDir, "chat.json"), "utf8"));
 assert.match(p.chatTitle(results[0].chat), /^chap-01_chat-01_/);
});

test("ordinary knowledge discussion stays local unless original evidence is missing", async () => {
 const { p, view, send, requests, window } = await setup(); await send("Chapter 1: first topic");
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15, text: Array.from({ length: 15 }, (_, i) => i === 6 ? "Theorem 2.3: verified proof." : "PAGE-" + i).join("\f") }) };
 let calls = 0;
 p.runBackend = async (_, request) => {
  calls++; requests.push(request);
  if (calls === 1) {
   assert.equal(request.ctx.reading.evidenceMode, "knowledge");
   assert.match(request.question, /verify the original source automatically/);
   assert.doesNotMatch(request.question, /saved notes and previous conversation/);
   return { text: "<abstractin-source-needed>Theorem 2.3 proof is missing</abstractin-source-needed>" };
  }
  assert.equal(request.ctx.reading.evidenceMode, "source");
  assert.match(request.question, /Theorem 2.3: verified proof/);
  assert.match(request.question, /original-source verification is authorized/);
  assert.doesNotMatch(request.question, /Do not open or search the PDF|using local file tools/);
  assert.equal(request.session, null);
  return { text: "Verified proof answer" };
 };
 await send("Why did the author use that index set?"); assert.equal(calls, 2);
 const history = await p.loadHistory(view.ctx.dir);
 assert.equal(history.at(-1).text, "Verified proof answer");
 assert.ok(!JSON.stringify(history).includes("abstractin-source-needed"));
 assert.equal(p.getReadingEvidenceMode(), "knowledge");
});

test("a selected appendix theorem verifies automatically and a follow-up lookup finds its original page", async () => {
 const { p, view, send, requests, window, attachment, setLocation } = await setup();
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15, text: Array.from({ length: 15 }, (_, i) => i === 11 ? "Theorem A.78. The index family may be uncountable. Proof: only countably many terms are nonzero." : i === 5 ? "Theorem A.780. Wrong statement." : "PAGE-" + i).join("\f") }) };
 const run = p.runBackend.bind(p);
 p.runBackend = async (backend, request) => {
  if (request.ctx.reading.evidenceMode === "knowledge") {
   requests.push(request);
   return { text: "<abstractin-source-needed>Theorem A.78 statement and proof are missing</abstractin-source-needed>" };
  }
  return run(backend, request);
 };
 await send("这里的 ci 的 index 集合是可数的吗？", { selection: { text: "Theorem A.78.", attachmentID: attachment.id, position: { pageIndex: 11 } } });
 assert.equal(requests.at(-1).ctx.reading.evidenceMode, "source");
 assert.match(requests.at(-1).question, /only countably many terms/);
 assert.doesNotMatch(requests.at(-1).question, /Wrong statement/);
 const owner = view.ctx.discussion.id;
 setLocation({ pageIndex: 1 });
 await send("请去搜索原文核对刚才的证明");
 assert.equal(requests.at(-1).ctx.reading.evidenceMode, "source");
 assert.match(requests.at(-1).question, /only countably many terms/);
 assert.equal(view.ctx.discussion.id, owner);
 assert.equal(p.requestsReadingSource("去原文里查一下"), true);
 assert.equal(p.requestsReadingSource("请查找原文"), true);
});

test("a numbered theorem with sufficient discussion evidence answers without another PDF lookup", async () => {
 const { p, view, send, requests } = await setup();
 await p.saveHistory(view.ctx.dir, [{ role: "user", text: "Theorem A.78 proof" }, { role: "assistant", text: "Verified proof: only countably many terms are nonzero." }]);
 p.exportReadingSource = async () => { throw new Error("Unnecessary source lookup"); };
 await send("解释 Theorem A.78 中已经确认的可数性结论");
 assert.equal(requests.at(-1).ctx.reading.evidenceMode, "knowledge");
 assert.match(requests.at(-1).history.at(-1).text, /only countably many terms/);
 assert.match(requests.at(-1).question, /answer directly without requesting source retrieval/);
});

test("an explicit no-source request prevents automatic checks of numbered appendix theorems", async () => {
 const { p, send, requests } = await setup();
 p.exportReadingSource = async () => { throw new Error("Document access prohibited"); };
 await send("不要搜索原文，根据已有知识解释 Theorem A.78");
 assert.equal(requests.at(-1).ctx.reading.evidenceMode, "knowledge");
 assert.match(requests.at(-1).question, /explicitly prohibited document access/);
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

test("unmapped full text still verifies the selected theorem through native reader pages", async () => {
 const { p, view, send, requests, window, attachment, setLocation } = await setup();
 setLocation({ pageIndex: 6 });
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15, text: "Extracted text with unverified boundaries" }) };
 const calls = [];
 const pdf = { numPages: 15, getPage: async number => {
  calls.push(number - 1);
  return { getTextContent: async () => ({ items: [{ str: number === 7 ? "Theorem A.78. An index family can be uncountable." : number === 8 ? "Proof: only countably many coefficients are nonzero." : "NEARBY-" + number }] }) };
 } };
 p.readingPDFApplication = () => ({ pdfDocument: pdf });
 await send("你看一下这个定理，为什么指标集的可不可数会影响证明？", { selection: { text: "Theorem A.78.34", attachmentID: attachment.id, position: { pageIndex: 6 } } });
 const request = requests.at(-1);
 assert.equal(request.ctx.reading.pdfSource.status, "ready");
 assert.equal(request.ctx.reading.pdfSource.pageMapping, false);
 assert.match(request.question, /Theorem A.78\. An index family/);
 assert.match(request.question, /only countably many coefficients/);
 assert.match(request.question, /PDF page 7; pageIndex 6/);
 assert.deepEqual(calls, [5, 6, 7, 8]);
 assert.equal(await window.OS.File.exists(join(view.ctx.dir, "source.pdf")), false);
});

test("unmapped cached text supports bounded theorem lookup without inventing a page index", async () => {
 const { p, view, send, requests, window } = await setup();
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15, text: "Preface. " + "irrelevant ".repeat(3000) + "Theorem A.78. Exact statement. Proof: countable support." + " nearby ".repeat(3000) + "UNRELATED-END" }) };
 p.readNativeReadingPage = async () => { throw new Error("Reader not available"); };
 await send("查看定理 A.78 的原文证明");
 const request = requests.at(-1);
 assert.equal(request.ctx.reading.pdfSource.status, "ready");
 assert.equal(request.ctx.reading.pdfSource.allowedPages.length, 0);
 assert.match(request.question, /Exact statement\. Proof: countable support/);
 assert.match(request.question, /physical page location unverified/);
 const excerpt = await readFile(join(view.ctx.dir, "source-text.md"), "utf8");
 assert.doesNotMatch(excerpt, /## PDF page|UNRELATED-END/);
 assert.ok(excerpt.length < 14000);
});

test("scoped export recovers trimmed blank-page mapping in the private document cache", async () => {
 const { p, view, send, requests, window, dir } = await setup();
 window.Zotero.PDFWorker = { getFullText: async () => ({ totalPages: 15, extractedPages: 15, text: Array.from({ length: 14 }, (_, i) => "CONTENT-" + (i + 1)).join("\f") }) };
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 15, getPage: async number => ({ getTextContent: async () => ({ items: [{ str: number === 1 ? "" : "CONTENT-" + (number - 1) }] }) }) } });
 await send("查看原文当前页");
 assert.equal(requests.at(-1).ctx.reading.pdfSource.status, "ready");
 assert.equal(requests.at(-1).ctx.reading.pdfSource.pageMapping, true);
 assert.match(await readFile(join(dir, "source-text.md"), "utf8"), /## PDF page 1; pageIndex 0\n\n\[No extractable text/);
 assert.match(await readFile(join(view.ctx.dir, "source-text.md"), "utf8"), /## PDF page 2; pageIndex 1\n\nCONTENT-1/);
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

test("compact names omit chapter titles and boilerplate while preserving appendix identity", async () => {
 const { p, view } = await setup(); const index = await p.discussionIndex(view.ctx);
 const name = p.discussionName(view.ctx, { chapterID: "app-a", number: 1, topic: "About this passage (p. 591): Theorem A.57 (Dominated convergence theorem)" }, index);
 assert.equal(name, "chap-app-A_chat-01_dominated-convergence-theorem"); assert.ok(name.length < 60);
});

test("classification uses question subjects and verified selections instead of proof chapter numbers", async () => {
 const { p, view } = await setup(); const index = await p.discussionIndex(view.ctx);
 const candidates = [{ key: "old", history: [
  { role: "user", text: "What is this definition?", selection: { position: { pageIndex: 1 } } }, { role: "assistant", text: "It uses Chapter 2 as evidence" },
  { role: "user", text: "Why?" }, { role: "assistant", text: "Explanation" },
  { role: "user", text: "Chapter 2: explain continuity" }, { role: "assistant", text: "The result" },
  { role: "user", text: "Explain theorem 1.1" }, { role: "assistant", text: "See chapter 1" },
 ] }];
 const turns = p.classifyLegacyTurns(view.ctx, index, candidates);
 assert.deepEqual(Array.from(turns, t => t.chapterID), ["ch-01", "ch-01", "ch-02", null]);
});

test("classified migration combines same-chapter turns, retains originals and can be repeated safely", async () => {
 const { p, view, dir } = await setup(); const index = await p.discussionIndex(view.ctx);
 const history = [ { role: "user", text: "Chapter 1: sets", ts: 1 }, { role: "assistant", text: "Set result", ts: 2 }, { role: "user", text: "Chapter 2: continuity", ts: 3 }, { role: "assistant", text: "Continuity result", ts: 4 }, { role: "user", text: "Chapter 1: measures", ts: 5 }, { role: "assistant", text: "Measure result", ts: 6 } ];
 const path = join(dir, "chat.json"); await writeFile(path, JSON.stringify(history)); const candidates = await p.legacyDiscussions(view.ctx, index, { includeImported: true });
 const turns = p.classifyLegacyTurns(view.ctx, index, candidates); await p.importClassifiedLegacy(view, index, turns, candidates);
 let updated = await p.discussionIndex(view.ctx); const classified = updated.chats.filter(c => c.classifiedKey);
 assert.equal(classified.length, 2); const sets = classified.find(c => c.chapterID === "ch-01"); const messages = await p.loadHistory(p.discussionContext(view.ctx, sets).dir);
 assert.equal(messages.length, 4); assert.match(messages.at(-1).text, /Measure result/);
 assert.equal(Object.keys(await p.loadSessions(p.discussionContext(view.ctx, sets).dir)).length, 0);
 assert.equal(await readFile(path, "utf8"), JSON.stringify(history));
 await p.importClassifiedLegacy(view, updated, turns, candidates); updated = await p.discussionIndex(view.ctx); assert.equal(updated.chats.filter(c => c.classifiedKey).length, 2);
});

test("classification inspection supports already imported records and agent suggestions stay isolated", async () => {
 const { p, view, dir, requests } = await setup(); await writeFile(join(dir, "chat.json"), JSON.stringify([{ role: "user", text: "Explain convergence" }, { role: "assistant", text: "A conclusion" }]));
 await p.migrateLegacyDiscussions(view); const index = await p.discussionIndex(view.ctx);
 assert.equal((await p.legacyDiscussions(view.ctx, index)).length, 0);
 const candidates = await p.legacyDiscussions(view.ctx, index, { includeImported: true }); assert.ok(candidates.length);
 const turns = p.classifyLegacyTurns(view.ctx, index, candidates);
 p.runBackend = async (_, request) => { requests.push(request); return { text: JSON.stringify({ assignments: [{ key: turns[0].key, chapterID: "ch-02" }, { key: "bad", chapterID: "invented" }] }) }; };
 await p.suggestLegacyChapters(view, index, turns); assert.equal(turns[0].chapterID, "ch-02");
 const request = requests.at(-1); assert.equal(request.session, null); assert.equal(request.history.length, 0); assert.equal(request.ctx.reading.evidenceMode, "knowledge"); assert.ok(request.ctx.dir.includes("migration-reviews"));
 assert.equal(view.ctx.discussion.chapterID, null);
});

test("result citations insert only reviewed text and do not submit or restore another agent session", async () => {
 const { p, view, send, requests } = await setup(); await send("Chapter 1: result"); const oldChat = { ...view.ctx.discussion }, history = await p.loadHistory(view.ctx.dir);
 const reference = p.resultReference(oldChat, history[1], 1); await send("Chapter 2: new question"); const active = view.ctx.discussion.id, count = requests.length;
 await p.openResultReference(view, reference); const panel = view.root.querySelector(".abstractin-reference-review"); assert.ok(panel);
 const field = panel.querySelector("textarea"); field.value = "Selected conclusion only"; panel.querySelector("button").click();
 assert.equal(view.ctx.discussion.id, active); assert.equal(requests.length, count); assert.ok(view.input.value.includes(reference)); assert.match(view.input.value, /Selected conclusion only/); assert.doesNotMatch(view.input.value, /Answer: Chapter 1/);
 await send(view.input.value); assert.ok(requests.at(-1).question.includes(reference)); assert.match(requests.at(-1).question, /Selected conclusion only/);
 assert.ok(view.logEl.querySelector(".abstractin-result-link"));
});

test("formal definitions and key equations receive referenceable formatting without an answer mode", async () => {
 const { p } = await setup(); assert.match(p.formattingGuide(), /When stating a mathematical definition/); assert.match(p.formattingGuide(), /\\tag\{1\}/); assert.match(p.formattingGuide(), /\\label\{def:metric-space\}/);
});

test("the migration button opens classification review before writing grouped discussions", async () => {
 const { p, view, dir } = await setup(); await writeFile(join(dir, "chat.json"), JSON.stringify([{ role: "user", text: "Chapter 1: old result" }, { role: "assistant", text: "Result" }]));
 p.openHistoryMenu(view.root); await new Promise(resolve => setTimeout(resolve, 30));
 const button = view.root.querySelector(".abstractin-reclassify"); assert.ok(button); button.click();
 await new Promise(resolve => setTimeout(resolve, 30)); assert.ok(view.root.querySelector(".abstractin-migration-review"));
 assert.equal((await p.discussionIndex(view.ctx)).chats.filter(c => c.classifiedKey).length, 0);
});

test("quoted earlier results cannot reroute a question or authorize a source lookup", async () => {
 const { p, view, send } = await setup(); await send("Chapter 2: continuity"); const index = await p.discussionIndex(view.ctx);
 const question = "Explain this conclusion intuitively\n[result:old-id]\n> Chapter 1: look up theorem 1.2 in the book";
 assert.equal(p.resolveDiscussionChapter(view.ctx, index, question, null, null).chapterID, "ch-02");
 assert.equal(p.requestsReadingSource(question), false);
 assert.equal(p.requestsReadingSource("Look up the original proof\n[result:old-id]\n> Theorem 1.2"), true);
});

test("history cards restore a conversation and its agent thread inside the current window", async () => {
 const { p, view, send, requests } = await setup();
 await send("Chapter 1: sets"); const first = { ...view.ctx.discussion }, firstDir = view.ctx.dir;
 const session = (await p.loadSessions(firstDir)).codex.id;
 await send("Chapter 2: continuity"); await p.openHistoryMenu(view.root);
 assert.ok(view.logEl.querySelector(".abstractin-history-browser")); assert.equal(view.root.querySelector(".abstractin-menu"), null);
 assert.equal(view.root.dataset.historyBrowser, "true");
 const selected = view.root.querySelector('[data-discussion-id="' + first.id + '"]'); assert.ok(selected); selected.click();
 for (let i = 0; i < 30 && view.historyBrowser; i++) await new Promise(r => setTimeout(r, 5));
 await new Promise(r => setTimeout(r, 20));
 assert.equal(view.ctx.dir, firstDir); assert.equal(view.root.querySelector(".abstractin-history-browser"), null);
 assert.equal(view.root.dataset.historyBrowser, undefined); assert.equal((await p.loadSessions(firstDir)).codex.id, session);
 await send("Continue the explanation"); assert.equal(requests.at(-1).session.id, session);
});

test("back from history preserves the draft and scroll position without sending a question", async () => {
 const { p, view, send, requests } = await setup(); await send("Chapter 1: original question");
 const id = view.ctx.discussion.id, count = requests.length; view.input.value = "Unsent follow-up"; view.logEl.scrollTop = 120;
 await p.openHistoryMenu(view.root); await p.startRequest(view, view.input.value); assert.equal(requests.length, count);
 const back = [...view.logEl.querySelectorAll("button")].find(b => b.textContent === "Back to discussion"); assert.ok(back); back.click();
 await new Promise(r => setTimeout(r, 20));
 assert.equal(view.ctx.discussion.id, id); assert.equal(view.input.value, "Unsent follow-up"); assert.equal(view.logEl.scrollTop, 120);
 assert.equal(view.root.dataset.historyBrowser, undefined); assert.equal(requests.length, count);
});

test("deleting discussions hides them from history, search and routing while retaining local originals", async () => {
 const { p, view, send } = await setup();
 await send("Chapter 1: removable topic"); const removed = { ...view.ctx.discussion }, path = view.ctx.dir;
 const original = await readFile(join(path, "chat.json"), "utf8");
 await send("Chapter 2: remaining topic"); const active = view.ctx.discussion.id;
 await p.deleteDiscussions(view, [removed.id]);
 const index = await p.discussionIndex(view.ctx);
 assert.ok(index.chats.find(c => c.id === removed.id).deletedAt);
 assert.equal(view.ctx.discussion.id, active);
 assert.equal(await readFile(join(path, "chat.json"), "utf8"), original);
 assert.ok(!(await p.loadAllChats()).some(c => c.discussionID === removed.id));
 await assert.rejects(p.switchDiscussion(view, removed, index), /unavailable/);
 await send("Chapter 1: new topic"); assert.notEqual(view.ctx.discussion.id, removed.id);
});

test("deleting the final discussion creates a usable empty replacement and sync recovery excludes tombstones", async () => {
 const { p, view, dir } = await setup(); const id = view.ctx.discussion.id;
 await p.deleteDiscussions(view, [id]);
 const index = await p.discussionIndex(view.ctx);
 assert.equal(p.visibleDiscussions(index).length, 1); assert.notEqual(view.ctx.discussion.id, id);
 assert.equal((await p.loadHistory(view.ctx.dir)).length, 0);
 const recoveryDir = join(dir, "recovered-delete"); await mkdir(recoveryDir);
 const recovered = await p.ensureDiscussion({ ...view.ctx, discussion: undefined, documentDir: undefined, dir: recoveryDir });
 const remote = await p.discussionIndex(recovered);
 assert.ok(remote.chats.find(c => c.id === id).deletedAt); assert.notEqual(recovered.discussion.id, id);
});

test("merging retains complete transcript blocks and reference IDs, automatically names and starts a fresh thread", async () => {
 const { p, view, send } = await setup();
 await send("Chapter 1: sets"); const first = { ...view.ctx.discussion }, firstDir = view.ctx.dir;
 const firstHistory = await p.loadHistory(firstDir), firstSessions = await p.loadSessions(firstDir);
 await p.newChat(view.root); await send("measures"); const second = { ...view.ctx.discussion }, secondDir = view.ctx.dir;
 const secondHistory = await p.loadHistory(secondDir);
 const merged = await p.mergeDiscussions(view, [second.id, first.id]);
 assert.equal(merged.chapterID, "ch-01"); assert.equal(merged.topic, "sets + measures");
 assert.equal(view.ctx.discussion.id, merged.id);
 assert.equal(p.discussionName(view.ctx, merged, await p.discussionIndex(view.ctx)), "chap-01_chat-01_sets+measures");
 const history = await p.loadHistory(view.ctx.dir);
 assert.deepEqual(Array.from(history, m => m.text), [...firstHistory, ...secondHistory].map(m => m.text));
 assert.equal(history[1].referenceID, firstHistory[1].referenceID);
 assert.equal(history[1].results[0].number, "1.1.1.1"); assert.equal(history[3].results[0].number, "1.1.2.1");
 assert.equal(history[0].mergedFrom, first.id);
 assert.equal(Object.keys(await p.loadSessions(view.ctx.dir)).length, 0);
 assert.equal(JSON.stringify(await p.loadSessions(firstDir)), JSON.stringify(firstSessions));
 assert.equal((await p.loadHistory(secondDir)).length, secondHistory.length);
 const index = await p.discussionIndex(view.ctx);
 assert.equal(p.visibleDiscussions(index).filter(c => c.chapterID === "ch-01").length, 1);
 assert.equal(index.chapters.find(c => c.id === "ch-01").activeChat, merged.id);
 assert.ok(!(await p.loadAllChats()).some(c => [first.id, second.id].includes(c.discussionID)));
});

test("cross-chapter merges go to Unassigned, sync as merged records, and reject stale or busy selections", async () => {
 const { p, view, send, dir } = await setup();
 await send("Chapter 1: sets"); const first = { ...view.ctx.discussion }, firstDir = view.ctx.dir;
 await send("Chapter 2: continuity"); const second = { ...view.ctx.discussion };
 p._pending.set(firstDir, {});
 await assert.rejects(p.mergeDiscussions(view, [first.id, second.id]), /Stop/);
 p._pending.delete(firstDir);
 await assert.rejects(p.mergeDiscussions(view, [first.id, first.id]), /at least two/);
 const merged = await p.mergeDiscussions(view, [first.id, second.id]); assert.equal(merged.chapterID, null);
 await assert.rejects(p.mergeDiscussions(view, [first.id, merged.id]), /available/);
 const recoveryDir = join(dir, "recovered-merge"); await mkdir(recoveryDir);
 const recovered = await p.ensureDiscussion({ ...view.ctx, discussion: undefined, documentDir: undefined, dir: recoveryDir });
 const index = await p.discussionIndex(recovered);
 assert.equal(p.visibleDiscussions(index).length, 1); assert.equal(recovered.discussion.id, merged.id);
 assert.equal(recovered.discussion.mergedFrom.length, 2);
 assert.equal((await p.loadHistory(recovered.dir)).length, 4);
});

test("failed merge index writes leave source discussions usable", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: sets"); const first = view.ctx.discussion.id;
 await p.newChat(view.root); await send("measures"); const second = view.ctx.discussion.id;
 const write = p.writeDiscussionIndex; p.writeDiscussionIndex = async () => { throw new Error("disk full"); };
 await assert.rejects(p.mergeDiscussions(view, [first, second]), /disk full/); p.writeDiscussionIndex = write;
 const index = await p.discussionIndex(view.ctx);
 assert.ok(p.visibleDiscussions(index).some(c => c.id === first)); assert.ok(p.visibleDiscussions(index).some(c => c.id === second));
 assert.equal(view.ctx.discussion.id, second); assert.equal(p._discussionLocks.size, 0);
});

test("history selection enables merge and deletion only after an explicit review", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: sets"); const first = view.ctx.discussion.id;
 await p.newChat(view.root); await send("measures"); await p.openHistoryMenu(view.root);
 const merge = view.logEl.querySelector(".abstractin-history-merge"), remove = view.logEl.querySelector(".abstractin-history-delete");
 assert.ok(merge.disabled); assert.ok(remove.disabled);
 const checks = view.logEl.querySelectorAll(".abstractin-history-check"); checks[0].click();
 assert.ok(merge.disabled); assert.ok(!remove.disabled); checks[1].click(); assert.ok(!merge.disabled);
 merge.click(); await new Promise(r => setTimeout(r, 10));
 let panel = view.logEl.querySelector(".abstractin-history-confirm"); assert.ok(panel);
 [...panel.querySelectorAll("button")].find(b => b.textContent === "Cancel").click();
 assert.ok(p.visibleDiscussions(await p.discussionIndex(view.ctx)).some(c => c.id === first));
 merge.click(); await new Promise(r => setTimeout(r, 10));
 panel = view.logEl.querySelector(".abstractin-history-confirm"); panel.querySelector("button").click();
 for (let i = 0; i < 100 && (!view.ctx.discussion.mergedFrom || !view.historyBrowser); i++) await new Promise(r => setTimeout(r, 10));
 await new Promise(r => setTimeout(r, 30));
 assert.ok(view.ctx.discussion.mergedFrom); assert.ok(view.historyBrowser);
 assert.equal(view.logEl.querySelectorAll(".abstractin-history-check").length, 2); // Unassigned plus merged chapter discussion.
 const row = view.logEl.querySelector('[data-discussion-id="' + view.ctx.discussion.id + '"]').parentElement;
 row.querySelector(".abstractin-history-row-delete").click(); await new Promise(r => setTimeout(r, 10));
 panel = view.logEl.querySelector(".abstractin-history-confirm"); panel.querySelector("button").click();
 for (let i = 0; i < 50 && view.ctx.discussion.mergedFrom; i++) await new Promise(r => setTimeout(r, 10));
 assert.ok(!view.ctx.discussion.mergedFrom);
});

test("formal results share numbering and keep IDs when a merge updates numbers", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: sets");
 const first = { ...view.ctx.discussion }, dir = view.ctx.dir;
 const text = "\\begin{theorem}[First]\\label{thm:first}\nOne.\n\\end{theorem}\n\\begin{theorem}[Second]\nTwo.\n\\end{theorem}\n\\begin{definition}[Metric]\nThree.\n\\end{definition}";
 await p.saveHistory(dir, [{ role: "user", text: "question" }, { role: "assistant", text }, { role: "user", text: "continue" }, { role: "assistant", text: "An ordinary conclusion." }]);
 let history = await p.loadHistory(dir);
 assert.deepEqual(Array.from(history[1].results, r => r.kind + " " + r.number), ["Theorem 1.1.1.1", "Theorem 1.1.1.2", "Definition 1.1.1.3"]);
 assert.equal(history[3].results[0].number, "1.1.2.1"); assert.equal(history[3].results[0].kind, "Result");
 const id = history[1].results[0].id;
 await p.assignDiscussionChapter(view, "ch-02");
 history = await p.loadHistory(dir); assert.equal(history[1].results[0].number, "1.1.1.1");
 await p.newChat(view.root); await send("new question"); const second = view.ctx.discussion.id;
 await p.mergeDiscussions(view, [first.id, second]); history = await p.loadHistory(view.ctx.dir);
 assert.equal(history[1].results[0].id, id); assert.equal(history[1].results[0].number, "2.1.1.1");
 p.renderMessages(view, history);
 assert.equal(view.logEl.querySelector(".abstractin-env-num").textContent.trim(), "2.1.1.1");
 assert.match(view.logEl.querySelector(".abstractin-env-label").textContent, /Chat Theorem 2\.1\.1\.1/);
 p.linkTheorems(view.logEl); assert.equal(view.logEl.querySelector(".abstractin-env-num").textContent.trim(), "2.1.1.1");
});

test("Quote navigates chapter, discussion and numbered result with preview before insertion", async () => {
 const { p, view, send, requests } = await setup(); await send("Chapter 1: sets");
 await p.saveHistory(view.ctx.dir, [{ role: "user", text: "q" }, { role: "assistant", text: "\\begin{theorem}[Set result]\nSelected theorem.\n\\end{theorem}\n\\begin{definition}[Other result]\nExcluded definition.\n\\end{definition}" }]);
 const source = view.ctx.discussion.id; await send("Chapter 2: continuity"); const active = view.ctx.discussion.id, count = requests.length;
 p.updateReadingControls(view);
 const button = view.root.querySelector(".abstractin-result-picker");
 assert.equal(button.querySelector(".abstractin-label").textContent, "Quote");
 assert.ok(button.querySelector('[data-icon="chevron"]')); assert.ok(view.root.querySelector(".abstractin-quote-divider"));
 button.click(); await new Promise(r => setTimeout(r, 20));
 let menu = view.root.querySelector(".abstractin-result-menu"); assert.ok(menu);
 [...menu.querySelectorAll("button")].find(b => b.textContent.includes("chap-01")).click();
 menu.querySelector('[data-discussion-id="' + source + '"]').click(); await new Promise(r => setTimeout(r, 30));
 menu = view.root.querySelector(".abstractin-result-menu");
 [...menu.querySelectorAll("button")].find(b => b.textContent.includes("Theorem 1.1.1.1")).click();
 const panel = view.root.querySelector(".abstractin-reference-review"); assert.ok(panel);
 assert.match(panel.querySelector("textarea").value, /Selected theorem/); assert.doesNotMatch(panel.querySelector("textarea").value, /Excluded definition/);
 panel.querySelector("button").click();
 assert.match(view.input.value, /Theorem 1\.1\.1\.1/); assert.equal(view.ctx.discussion.id, active); assert.equal(requests.length, count);
 await send(view.input.value); assert.match(view.logEl.querySelector(".abstractin-result-link").textContent, /Theorem 1\.1\.1\.1/);
});

test("appendix and unassigned results have stable prefixes and quoted numbering cannot route a question", async () => {
 const { p, view, send } = await setup();
 await p.saveHistory(view.ctx.dir, [{ role: "user", text: "q" }, { role: "assistant", text: "A conclusion" }]);
 assert.equal((await p.loadHistory(view.ctx.dir))[1].results[0].number, "U.1.1.1");
 await send("Appendix A: proof"); assert.equal((await p.loadHistory(view.ctx.dir))[1].results[0].number, "A.1.1.1");
 const quoted = "Explain intuitively\n[result:old-r-1|Theorem 1.1.1.1]\n> Chapter 1: look up its original proof";
 assert.equal(p.discussionQuestionSubject(quoted), "Explain intuitively\n");
 assert.equal(p.requestsReadingSource(quoted), false);
});

test("moving a discussion reserves its original number and numeric appendices do not share chapter prefixes", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: sets");
 const first = { ...view.ctx.discussion }; await p.assignDiscussionChapter(view, "ch-02");
 await send("Chapter 1: measures"); assert.equal(view.ctx.discussion.number, 2);
 assert.equal((await p.loadHistory(view.ctx.dir))[1].results[0].number, "1.2.1.1");
 const index = await p.discussionIndex(view.ctx), source = index.chats.find(c => c.id === first.id);
 assert.equal(source.numberHistory[0].number, 1);
 await send("Appendix 1: tables"); assert.equal((await p.loadHistory(view.ctx.dir))[1].results[0].number, "App1.1.1.1");
});

test("result extraction ignores code and proof numbering while preserving Markdown and original book numbers", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: results");
 const text = "Book Theorem A.57 is the source.\n```tex\n\\begin{theorem}\nExample code.\n\\end{theorem}\n```\n### Theorem A.57 — Convergence\nStatement referring to book Theorem A.57.\n\n### Definition 2.1 — Limit\nA definition.\n\n### Proof\nA proof.";
 const results = p.extractDiscussionResults(text);
 assert.equal(results.length, 2); assert.equal(results[0].kind, "Theorem"); assert.equal(results[1].kind, "Definition");
 assert.match(results[0].text, /Theorem A\.57/); assert.doesNotMatch(results[1].text, /A proof/);
 await p.saveHistory(view.ctx.dir, [{ role: "user", text: "q" }, { role: "assistant", text }]);
 const history = await p.loadHistory(view.ctx.dir); p.renderMessages(view, history);
 assert.match(view.logEl.textContent, /Book Theorem A\.57/); assert.match(view.logEl.textContent, /Chat Theorem 1\.1\.1\.1/);
 assert.match(view.logEl.textContent, /Chat Definition 1\.1\.1\.2/);
});

test("deleting compacts surviving chats and results and refreshes citation labels without changing IDs", async () => {
 const { p, view, send } = await setup(); await send("Chapter 1: first"); const first = view.ctx.discussion.id;
 await p.newChat(view.root); await send("second"); const second = view.ctx.discussion.id;
 const result = (await p.loadHistory(view.ctx.dir))[1].results[0];
 await p.newChat(view.root); await send("third"); const third = view.ctx.discussion.id;
 await p.saveHistory(view.ctx.dir, [{ role: "user", text: "Use [result:" + result.id + "|Chat Result 1.2.1.1]\n> selected text" }, { role: "assistant", text: "Third result" }]);
 await p.deleteDiscussions(view, [first]); const index = await p.discussionIndex(view.ctx);
 assert.equal(index.chats.find(c => c.id === second).number, 1); assert.equal(index.chats.find(c => c.id === third).number, 2);
 const secondHistory = await p.loadHistory(p.discussionContext(view.ctx, index.chats.find(c => c.id === second)).dir);
 assert.equal(secondHistory[1].results[0].number, "1.1.1.1"); assert.equal(secondHistory[1].results[0].id, result.id);
 const history = await p.loadHistory(view.ctx.dir); assert.equal(history[1].results[0].number, "1.2.1.1");
 assert.match(history[0].text, /Chat Result 1\.1\.1\.1/);
 await p.newChat(view.root); assert.equal(view.ctx.discussion.number, 3);
});

test("deleting a middle turn removes its pair, compacts result numbers and resets all model threads", async () => {
 const { p, view, send } = await setup();
 await send("Chapter 1: discussion");
 await p.saveHistory(view.ctx.dir, [
  { role: "user", text: "First question" }, { role: "assistant", text: "### Definition — First\nFirst statement." },
  { role: "user", text: "Second question" }, { role: "assistant", text: "### Definition — Second\nSecond statement." },
  { role: "user", text: "Third question" }, { role: "assistant", text: "### Theorem — Third\nThird statement." },
 ]);
 const before = await p.loadHistory(view.ctx.dir), survivor = before[5].results[0];
 await p.saveSessions(view.ctx.dir, { codex: { id: "old" }, "codex:knowledge": { id: "old" }, "codex:source": { id: "source-old" } });
 view.input.value = "Unsent draft";
 p.renderMessages(view, before);
 const more = view.logEl.querySelectorAll('.abstractin-more')[1]; more.click();
 const remove = [...view.root.querySelectorAll('.abstractin-menu-item')].find(item => item.textContent.includes('Delete this turn'));
 assert.ok(remove); remove.click();
 for (let tries = 0; tries < 100 && ((await p.loadHistory(view.ctx.dir)).length !== 4 || p._chatTransitions.has(view.ctx.dir)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
 const after = await p.loadHistory(view.ctx.dir);
 assert.deepEqual(Array.from(after, message => message.text.split('\n')[0]), ['First question', '### Definition — First', 'Third question', '### Theorem — Third']);
 assert.equal(after[3].results[0].id, survivor.id);
 assert.equal(after[3].results[0].number, '1.1.2.1');
 assert.equal(Object.keys(await p.loadSessions(view.ctx.dir)).length, 0);
 assert.equal(view.input.value, 'Unsent draft');
 assert.doesNotMatch(view.logEl.textContent, /Second question|Second statement/);
});

test("turn deletion handles the last pair and the final empty conversation", async () => {
 const { p, view, send } = await setup(); await send('First'); await send('Second');
 let history = await p.loadHistory(view.ctx.dir);
 await p.deleteConversationTurn(view, 3, history[3]);
 history = await p.loadHistory(view.ctx.dir); assert.equal(history.length, 2);
 await p.deleteConversationTurn(view, 1, history[1]);
 assert.equal((await p.loadHistory(view.ctx.dir)).length, 0);
 assert.ok(view.logEl.querySelector('.abstractin-empty'));
 assert.equal(p._chatTransitions.has(view.ctx.dir), false);
});

test("turn deletion rejects pending answers and stale indices without changing the transcript", async () => {
 const { p, view, send } = await setup(); await send('First'); await send('Second');
 const history = await p.loadHistory(view.ctx.dir);
 p._pending.set(view.ctx.dir, {});
 await assert.rejects(p.deleteConversationTurn(view, 1, history[1]), /Wait for the current answer/);
 p._pending.delete(view.ctx.dir);
 await assert.rejects(p.deleteConversationTurn(view, 1, history[3]), /turn has changed/);
 assert.equal((await p.loadHistory(view.ctx.dir)).length, 4);
 assert.equal(p._chatTransitions.has(view.ctx.dir), false);
 assert.equal(p._discussionLocks.has(p.discussionRoot(view.ctx)), false);
});
