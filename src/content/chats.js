"use strict";

// Document indexes are plugin-owned. Each agent's working directory contains
// only one discussion; chapter IDs and display names are deliberately separate.
(() => {
 const original = {};
 for (const name of ["getContext", "activateReading", "startRequest", "newChat", "openHistoryMenu", "loadAllChats", "openSearchResult", "renderMessages", "exportContext", "exportReadingRecords", "exportReadingWorkspace", "exportReadingSource", "recoverReadingPageMapping", "readingPrompt", "chatNoteParts", "hydrateChatHistory", "updateReadingControls", "agentReadingContext", "codexArgs", "claudeArgs", "chatTitle", "openReadingContentsEntry", "contextDirFor", "applyDraft", "saveReadingRecord"]) original[name] = AbstractIn[name];
 Object.assign(AbstractIn, {
  _discussionLocks: new Set(),
  _discussionInitializations: new Map(),
  _activeDiscussionDirs: new Map(),
  async listDiscussionChildren(dir) {
   if (!(await OS.File.exists(dir))) return [];
   if (Zotero.File.iterateDirectory) return this.listChildren(dir);
   const entries = [], iterator = new OS.File.DirectoryIterator(dir);
   try { await iterator.forEach(entry => entries.push({ name: entry.name, path: entry.path, isDir: !!entry.isDir, isSymLink: !!entry.isSymLink })); } finally { iterator.close(); }
   return entries;
  },
  visibleDiscussions(index) { return index.chats.filter(c => !c.deletedAt && !c.supersededBy); },
  nextDiscussionNumber(index, chapterID) {
   const numbers = (index.chats.some(c => c.numberingRevision) ? this.visibleDiscussions(index) : index.chats).flatMap(c => [...(c.chapterID === chapterID ? [c.number] : []), ...(c.numberHistory || []).filter(n => n.chapterID === chapterID).map(n => n.number)]);
   return Math.max(0, ...numbers) + 1;
  },
  discussionRoot(ctx) { return ctx.documentDir || ctx.dir; },
  async readDiscussionJSON(path, fallback = null) {
   try { return JSON.parse(await Zotero.File.getContentsAsync(path)); }
   catch (e) { if (await OS.File.exists(path)) throw e; return fallback; }
  },
  async writeDiscussionIndex(ctx, index) {
   // Atomic replacement keeps interrupted updates from destroying the index.
   const path = OS.Path.join(this.discussionRoot(ctx), "discussions.json");
   const text = JSON.stringify(index, null, 2);
   if (OS.File.writeAtomic) await OS.File.writeAtomic(path, new TextEncoder().encode(text), { tmpPath: path + ".tmp" });
   else await Zotero.File.putContentsAsync(path, text);
  },
  async discussionIndex(ctx) {
   const index = await this.readDiscussionJSON(OS.Path.join(this.discussionRoot(ctx), "discussions.json"));
   if (!index) return { version: 2, active: null, chapters: [], chats: [], migrated: {} };
   if (index.version !== 2 || !Array.isArray(index.chats) || !Array.isArray(index.chapters) || index.chats.some(c => !/^[a-z0-9-]+$/.test(c.id))) throw new Error("Invalid discussion index; original records have been preserved.");
   return index;
  },
  discussionSlug(text, fallback = "discussion") {
   return String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/g, "") || fallback;
  },
  discussionName(ctx, chat, index) {
   const chapter = index.chapters.find(c => c.id === chat.chapterID);
   const prefix = ctx.reading.type === "paper" ? "paper" : chapter ? chapter.prefix + "_" + this.discussionSlug(chapter.title.replace(/^(?:(?:chapter|appendix)\s+)?(?:\d+|[A-Z])[\s.:–—-]+/i, "")) : "unassigned";
   return prefix + "_chat-" + String(chat.number).padStart(2, "0") + "_" + this.discussionSlug(chat.topic);
  },
  async refreshDiscussionChapters(ctx, index) {
   if (ctx.reading.type !== "book") return;
   const data = this.readingArtifactData(this.readingArtifactNotes(ctx, "Contents")[0]);
   const entries = data?.entries || [];
   // Prefer top-level chapter headings; never promote theorem numbers to chapters.
   const top = entries.filter(e => /^(?:chapter\s+\d+|第.+章|\d+\s|appendix\s+[A-Z0-9]+|附录\s*[A-Z0-9]+)/i.test(e.title) || /^(?:ch|chap|chapter)-(?:\d+|app-[a-z0-9]+)$/i.test(e.id));
   const chosen = top.length ? top : entries;
   let main = 0, appendix = 0;
   for (let order = 0; order < chosen.length; order++) {
    const entry = chosen[order];
    const app = entry.title.match(/^(?:appendix|附录)\s*([A-Z]|\d+)\b/i) || entry.id.match(/(?:app|appendix)-([a-z]|\d+)$/i);
    const appLabel = app ? (/^\d+$/.test(app[1]) ? String(Number(app[1])).padStart(2, "0") : app[1].toUpperCase()) : null;
    const displayedNumber = entry.title.match(/^(?:chapter\s+)?(\d+)\s/i) || entry.id.match(/^(?:ch|chap|chapter)-(\d+)$/i);
    const prefix = app ? "chap-app-" + (appLabel || String(++appendix).padStart(2, "0")) : "chap-" + String(displayedNumber ? Number(displayedNumber[1]) : ++main).padStart(2, "0");
    const prior = index.chapters.find(c => c.id === entry.id);
    const chapter = { ...prior, id: entry.id, title: entry.title, prefix, order: app ? 10000 + order : order,
     pageIndex: Number.isInteger(entry.pageIndex) ? entry.pageIndex : prior?.pageIndex ?? null };
    if (prior) Object.assign(prior, chapter); else index.chapters.push(chapter);
   }
   // PDF bookmarks are verified page destinations. Only match known headings;
   // constructing this small map requires no page text extraction or agent call.
   const pdf = this.readingPDFApplication(ctx)?.pdfDocument;
   if (pdf?.getOutline) {
    const norm = s => String(s).normalize("NFKC").toLowerCase().replace(/^(?:chapter\s+)?\d+[\s.:–—-]+/i, "").replace(/\s+/g, " ").trim();
    const locations = new Map();
    const walk = async nodes => {
     for (const node of nodes || []) {
      const chapter = index.chapters.find(c => norm(c.title) === norm(node.title));
      if (chapter && node.dest) {
       const dest = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
       const ref = dest?.[0], page = Number.isInteger(ref) ? ref : ref ? await pdf.getPageIndex(ref) : null;
       if (Number.isInteger(page) && page >= 0 && page < pdf.numPages) {
        if (!locations.has(chapter.id)) locations.set(chapter.id, new Set());
        locations.get(chapter.id).add(page);
       }
      }
      await walk(node.items);
     }
    };
    try {
     await walk(await pdf.getOutline());
     for (const chapter of index.chapters) if (locations.get(chapter.id)?.size === 1) chapter.pageIndex = [...locations.get(chapter.id)][0];
    } catch (e) { this.logError("chapter bookmarks", e); }
   }
   const manifest = await this.readDiscussionJSON(OS.Path.join(this.discussionRoot(ctx), "source-manifest.json"));
   const totalPages = pdf?.numPages || manifest?.totalPages;
   const ordered = index.chapters.slice().sort((a, b) => a.order - b.order);
   for (let i = 0; i < ordered.length; i++) {
    const chapter = ordered[i], next = ordered[i + 1];
    // A missing intermediate boundary is not permission to guess a range.
    chapter.endPageIndex = Number.isInteger(chapter.pageIndex) && Number.isInteger(next?.pageIndex) && next.pageIndex > chapter.pageIndex ? next.pageIndex - 1 :
     !next && totalPages ? totalPages - 1 : null;
   }
  },
  async createDiscussion(ctx, index, chapterID = null, topic = "discussion", seed = [], metadata = {}, { persist = true } = {}) {
   const number = this.nextDiscussionNumber(index, chapterID);
   const chat = { id: this.chatSyncID(), chapterID, number, topic, createdAt: Date.now(), updatedAt: Date.now(), ...metadata };
   const root = this.discussionRoot(ctx), container = OS.Path.join(root, "discussions");
   await Zotero.File.createDirectoryIfMissingAsync(container);
   const dir = OS.Path.join(container, chat.id); await Zotero.File.createDirectoryIfMissingAsync(dir);
   await Zotero.File.putContentsAsync(OS.Path.join(dir, "chat.json"), JSON.stringify(seed));
   index.chats.push(chat); if (!metadata.migrated) index.active = chat.id;
   if (chapterID) index.chapters.find(c => c.id === chapterID).activeChat = chat.id;
   if (persist) await this.writeDiscussionIndex(ctx, index);
   return chat;
  },
  discussionContext(ctx, chat) {
   const documentDir = this.discussionRoot(ctx);
   return this.registerChatContext({ ...ctx, documentDir, discussion: { ...chat }, reading: { ...ctx.reading },
    dir: OS.Path.join(documentDir, "discussions", chat.id) });
  },
  async ensureDiscussion(ctx) {
   if (!ctx?.reading || ctx.discussion) return ctx;
   const dir = this.discussionRoot(ctx);
   if (this._discussionInitializations.has(dir)) { const active = await this._discussionInitializations.get(dir); return { ...active, ...ctx, documentDir: dir, dir: active.dir, discussion: active.discussion, reading: { ...ctx.reading } }; }
   const initialization = this.initializeDiscussion(ctx); this._discussionInitializations.set(dir, initialization);
   try { const result = await initialization; this._activeDiscussionDirs.set(dir, result.dir); return result; }
   finally { this._discussionInitializations.delete(dir); }
  },
  async initializeDiscussion(ctx) {
   if (!ctx?.reading || ctx.discussion) return ctx;
   const index = await this.discussionIndex(ctx);
   await this.refreshDiscussionChapters(ctx, index);
   // Recover discussion metadata carried by Zotero sync notes on a new device.
   const parts = original.chatNoteParts.call(this, ctx), remote = new Map();
   for (const { data } of parts) if (data.discussionID && /^[a-z0-9-]+$/.test(data.discussionID) && data.discussion?.id === data.discussionID &&
    (!remote.has(data.discussionID) || data.updatedAt > remote.get(data.discussionID).updatedAt)) remote.set(data.discussionID, data);
   for (const data of remote.values()) {
    const record = data.discussion;
    const existing = index.chats.find(c => c.id === data.discussionID);
    if (existing) {
     if (record.deletedAt) existing.deletedAt = record.deletedAt;
     if (record.supersededBy) existing.supersededBy = record.supersededBy;
     continue;
    }
    if (!Number.isInteger(record.number) || record.number < 1) continue;
    if (data.chapter && !index.chapters.some(c => c.id === data.chapter.id)) index.chapters.push(data.chapter);
    index.chats.push({ id: record.id, chapterID: record.chapterID || null, number: record.number, topic: String(record.topic || "discussion"), createdAt: record.createdAt || data.updatedAt, updatedAt: data.updatedAt, ...(record.numberingRevision ? { numberingRevision: record.numberingRevision } : {}), ...(record.numberHistory ? { numberHistory: record.numberHistory } : {}), ...(record.mergedFrom ? { mergedFrom: record.mergedFrom } : {}), ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}), ...(record.supersededBy ? { supersededBy: record.supersededBy } : {}) });
    const container = OS.Path.join(this.discussionRoot(ctx), "discussions"); await Zotero.File.createDirectoryIfMissingAsync(container);
    await Zotero.File.createDirectoryIfMissingAsync(OS.Path.join(container, record.id));
   }
   let chat = this.visibleDiscussions(index).find(c => c.id === index.active) || this.visibleDiscussions(index).slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
   if (!chat) chat = await this.createDiscussion(ctx, index);
   else { index.active = chat.id; await this.writeDiscussionIndex(ctx, index); }
   return this.discussionContext(ctx, chat);
  },
  contextDirFor(item) {
   const dir = original.contextDirFor.call(this, item);
   const documentDir = item.isAttachment?.() ? OS.Path.join(this.getDataDir(), (item.parentItem || item).libraryID + "-" + (item.parentItem || item).key, "reading-" + item.key) : dir;
   return this._activeDiscussionDirs.get(documentDir) || this._activeDiscussionDirs.get(dir) || dir;
  },
  applyDraft(view) {
   if (view.ctx.documentDir && !this._drafts.has(view.ctx.dir) && this._drafts.has(view.ctx.documentDir)) {
    this._drafts.set(view.ctx.dir, this._drafts.get(view.ctx.documentDir)); this._drafts.delete(view.ctx.documentDir);
   }
   return original.applyDraft.call(this, view);
  },
  async getContext(item) { return this.ensureDiscussion(await original.getContext.call(this, item)); },
  async activateReading(view, attachment, options) {
   await original.activateReading.call(this, view, attachment, options);
   const oldDir = view.ctx.dir;
   view.ctx = await this.ensureDiscussion(view.ctx);
   const draft = this._drafts.get(oldDir);
   if (draft) { this._drafts.delete(oldDir); this._drafts.set(view.ctx.dir, draft); }
   this.renderMessages(view, await this.loadHistory(view.ctx.dir));
   this.updateReadingControls(view); this.applyDraft(view);
  },
  chapterAtPage(index, pageIndex) {
   if (!Number.isInteger(pageIndex)) return null;
   const matches = index.chapters.filter(c => Number.isInteger(c.pageIndex) && Number.isInteger(c.endPageIndex) && pageIndex >= c.pageIndex && pageIndex <= c.endPageIndex);
   return matches.length === 1 ? matches[0].id : null;
  },
  resolveDiscussionChapter(ctx, index, question, selection, location) {
   if (ctx.reading.type !== "book") return { chapterID: null };
   const page = selection?.position?.pageIndex ?? selection?.pageIndex;
   if (Number.isInteger(page)) return { chapterID: this.chapterAtPage(index, page), ambiguous: !this.chapterAtPage(index, page) };
   // The question's subject wins over the location of supporting evidence.
   if (this.requestsReadingSource(question) && /(?:这里|此处|这一步|上述|\bhere\b|\bthis\b)/i.test(question)) return { chapterID: ctx.discussion.chapterID };
   const explicit = question.match(/\bchapter\s+(\d+)\b|第\s*(\d+)\s*章|\bappendix\s+([A-Z]|\d+)\b|附录\s*([A-Z]|\d+)/i);
   if (explicit) {
    const app = explicit[3] || explicit[4], number = explicit[1] || explicit[2];
    const prefix = app ? "chap-app-" + (/^\d+$/.test(app) ? String(Number(app)).padStart(2, "0") : app.toUpperCase()) : "chap-" + String(Number(number)).padStart(2, "0");
    const matches = index.chapters.filter(c => c.prefix === prefix);
    return matches.length === 1 ? { chapterID: matches[0].id } : { ambiguous: true };
   }
   const named = index.chapters.filter(c => c.title.length > 3 && question.toLowerCase().includes(c.title.toLowerCase()));
   if (named.length === 1) return { chapterID: named[0].id };
   const local = /(?:这里|此处|这页|这一页|当前页|当前章节|这一步|\bhere\b|\bthis\s+(?:page|chapter|step|proof|equation)\b)/i.test(question);
   if (local && !ctx.reading.referenceNavigation) return { chapterID: this.chapterAtPage(index, location?.pageIndex), ambiguous: !this.chapterAtPage(index, location?.pageIndex) };
   return { chapterID: ctx.discussion.chapterID };
  },
  chooseDiscussionChapter(view, index) {
   return new Promise(resolve => {
    const panel = this.el(view.doc, "div", "abstractin-panel abstractin-chapter-choice");
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Choose the chapter this question is about");
    panel.append(this.el(view.doc, "p", null, "Which chapter is this question about? No source search is needed."));
    const finish = value => { panel.remove(); resolve(value); };
    for (const chapter of index.chapters.slice().sort((a, b) => a.order - b.order)) {
     const button = this.el(view.doc, "button", "abstractin-btn", chapter.prefix + " · " + chapter.title);
     button.addEventListener("click", () => finish(chapter.id)); panel.append(button);
    }
    for (const [label, value] of [["Keep in current discussion", view.ctx.discussion.chapterID], ["Unassigned", null], ["Cancel", undefined]]) {
     const button = this.el(view.doc, "button", "abstractin-btn", label); button.addEventListener("click", () => finish(value)); panel.append(button);
    }
    view.root.querySelector(".abstractin-log-wrap").append(panel);
   });
  },
  async switchDiscussion(view, chat, index, { locked = false } = {}) {
   const documentDir = this.discussionRoot(view.ctx);
   if (!locked && this._discussionLocks.has(documentDir)) throw new Error("A discussion change is already in progress.");
   if (!locked) this._discussionLocks.add(documentDir);
   try {
   index = await this.discussionIndex(view.ctx);
   chat = index.chats.find(c => c.id === chat?.id);
   if (!chat || chat.deletedAt || chat.supersededBy) throw new Error("This discussion is unavailable.");
   if (this._pending.has(view.ctx.dir)) throw new Error("Stop the current answer before changing discussions.");
   index.active = chat.id;
   const chapter = index.chapters.find(c => c.id === chat.chapterID); if (chapter) chapter.activeChat = chat.id;
   await this.writeDiscussionIndex(view.ctx, index);
   const oldDir = view.ctx.dir;
   const ctx = this.discussionContext(view.ctx, chat);
   this._activeDiscussionDirs.set(documentDir, ctx.dir);
   // Views for the same document follow the active discussion, without ever
   // copying another discussion's history into its working directory.
   const roots = new Set([view.root]);
   for (const win of new Set([...(Zotero.getMainWindows?.() || [Zotero.getMainWindow()]), ...this._readerPanelWindows.keys()])) {
    for (const root of win.document.querySelectorAll(".abstractin-root")) roots.add(root);
   }
   for (const root of roots) {
    const other = this._views.get(root);
    if (other?.ctx.dir !== oldDir) continue;
    other.ctx = { ...ctx, reader: other.ctx.reader };
    other.pageImageSource = null;
    this.renderMessages(other, await this.loadHistory(ctx.dir)); this.renderAttachments(other); this.updateReadingControls(other);
   }
   return ctx;
   } finally { if (!locked) this._discussionLocks.delete(documentDir); }
  },
  async startRequest(view, text, images = [], modes = [], options = {}) {
   if (!view.ctx.discussion) return original.startRequest.call(this, view, text, images, modes, options);
   const documentDir = this.discussionRoot(view.ctx), question = (text || "").trim();
   const sendTimeLocation = this.currentReadingLocation(view.ctx);
   if ((!question && !images.length) || this._pending.has(view.ctx.dir) || this._discussionLocks.has(documentDir)) return;
   this._discussionLocks.add(documentDir);
   try {
    const index = await this.discussionIndex(view.ctx); await this.refreshDiscussionChapters(view.ctx, index);
    const location = sendTimeLocation;
    const selection = options.selection || (view.pageImageSource && images.includes(view.pageImageSource.path) ? view.pageImageSource.selection : null);
    if (selection && selection.attachmentID !== view.ctx.attachmentItem.id) throw new Error("The selection belongs to a different PDF.");
    let route = options.readingAction ? { chapterID: view.ctx.discussion.chapterID } : this.resolveDiscussionChapter(view.ctx, index, question, selection, location);
    if (route.ambiguous) {
     const chapterID = await this.chooseDiscussionChapter(view, index);
     if (chapterID === undefined) return;
     route = { chapterID };
    }
    let chat = index.chats.find(c => c.id === view.ctx.discussion.id);
    if (chat.chapterID !== route.chapterID) {
     const chapter = index.chapters.find(c => c.id === route.chapterID);
     chat = this.visibleDiscussions(index).find(c => c.id === chapter?.activeChat && c.chapterID === route.chapterID) || this.visibleDiscussions(index).filter(c => c.chapterID === route.chapterID).sort((a, b) => b.updatedAt - a.updatedAt)[0];
     if (!chat) chat = await this.createDiscussion(view.ctx, index, route.chapterID, question);
     // Image staging belongs to the submitted turn, and must survive routing.
     const staged = this._staged.get(view.ctx.dir);
     await this.switchDiscussion(view, chat, index, { locked: true });
     if (staged) this._staged.set(view.ctx.dir, staged);
    }
    if (chat.topic === "discussion" && !options.readingAction) chat.topic = question || "image-question";
    chat.updatedAt = Date.now(); view.ctx.discussion = { ...chat };
    await this.writeDiscussionIndex(view.ctx, index); this.updateReadingControls(view);
    return original.startRequest.call(this, view, text, images, modes, { ...options, selection, currentPage: sendTimeLocation });
   } catch (e) { this.appendError(view, e.message || String(e)); }
   finally { this._discussionLocks.delete(documentDir); }
  },
  async newChat(root, seed = []) {
   const view = this._views.get(root);
   if (!view?.ctx.discussion) return original.newChat.call(this, root);
   const dir = this.discussionRoot(view.ctx);
   if (this._pending.has(view.ctx.dir) || this._discussionLocks.has(dir)) return;
   this._discussionLocks.add(dir);
   try {
    const index = await this.discussionIndex(view.ctx);
    const chat = await this.createDiscussion(view.ctx, index, view.ctx.discussion.chapterID, "discussion", seed);
    await this.switchDiscussion(view, chat, index, { locked: true }); view.input.value = ""; view.input.focus();
   } finally { this._discussionLocks.delete(dir); }
  },
  async renameDiscussion(view, title, chatID = view.ctx.discussion.id) {
   if (!title.trim() || this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx))) return;
   const index = await this.discussionIndex(view.ctx), chat = this.visibleDiscussions(index).find(c => c.id === chatID);
   if (!chat) throw new Error("This discussion is unavailable.");
   chat.topic = title.trim().slice(0, 200); await this.writeDiscussionIndex(view.ctx, index);
   if (chat.id === view.ctx.discussion.id) view.ctx.discussion = { ...chat }; this.updateReadingControls(view);
  },
  async assignDiscussionChapter(view, chapterID) {
   if (this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx))) throw new Error("Wait for the current answer before moving this discussion.");
   const index = await this.discussionIndex(view.ctx);
   if (chapterID !== null && !index.chapters.some(c => c.id === chapterID)) throw new Error("Unknown chapter");
   const chat = index.chats.find(c => c.id === view.ctx.discussion.id);
   if (chat.chapterID === chapterID) return;
   chat.numberHistory ||= []; chat.numberHistory.push({ chapterID: chat.chapterID, number: chat.number });
   const oldChapter = index.chapters.find(c => c.id === chat.chapterID);
   if (oldChapter?.activeChat === chat.id) oldChapter.activeChat = this.visibleDiscussions(index).filter(c => c.id !== chat.id && c.chapterID === chat.chapterID).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id || null;
   const number = this.nextDiscussionNumber(index, chapterID);
   chat.chapterID = chapterID; chat.number = number;
   await this.writeDiscussionIndex(view.ctx, index);
   await this.switchDiscussion(view, chat, index);
  },
  async changeDiscussions(view, ids, operation) {
   const root = this.discussionRoot(view.ctx);
   if (this._discussionLocks.has(root)) throw new Error("A discussion change is already in progress.");
   this._discussionLocks.add(root);
   try {
    const index = await this.discussionIndex(view.ctx), unique = [...new Set(ids)];
    const chats = unique.map(id => this.visibleDiscussions(index).find(c => c.id === id));
    if (!chats.length || chats.some(c => !c)) throw new Error("Select available discussions first.");
    if ([view.ctx.dir, ...this.visibleDiscussions(index).map(c => this.discussionContext(view.ctx, c).dir)].some(dir => this._pending.has(dir))) throw new Error("Stop the current answer before changing discussions.");
    if (operation !== "delete" && operation !== "merge") throw new Error("Unknown discussion action.");
    let next;
    if (operation === "merge") {
     if (chats.length < 2) throw new Error("Select at least two discussions to merge.");
     // Keep each complete transcript together, ordered by chapter and number.
     chats.sort((a, b) => (index.chapters.find(c => c.id === a.chapterID)?.order ?? 20000) - (index.chapters.find(c => c.id === b.chapterID)?.order ?? 20000) || a.number - b.number || a.id.localeCompare(b.id));
     const seed = [], topics = [];
     for (const chat of chats) {
      const history = await this.loadHistory(this.discussionContext(view.ctx, chat).dir);
      for (let at = 0; at < history.length; at++) {
       const message = history[at];
       seed.push({ ...message, referenceID: message.referenceID || chat.id + "-" + at, mergedFrom: message.mergedFrom || chat.id });
      }
      const topic = this.shortDiscussionTopic(chat.topic === "discussion" ? history.find(m => m.role === "user")?.text : chat.topic);
      if (topic !== "discussion" && !topics.includes(topic)) topics.push(topic);
     }
     const chapterID = chats.every(c => c.chapterID === chats[0].chapterID) ? chats[0].chapterID : null;
     const topic = topics.length ? topics.slice(0, 3).join(" + ") : "Merged discussion";
     next = await this.createDiscussion(view.ctx, index, chapterID, topic, seed, { mergedFrom: chats.map(c => c.id) }, { persist: false });
     for (const chat of chats) chat.supersededBy = [next.id];
    } else {
     for (const chat of chats) chat.deletedAt = Date.now();
     next = this.visibleDiscussions(index).find(c => c.id === index.active) || this.visibleDiscussions(index).slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
     if (!next) next = await this.createDiscussion(view.ctx, index, view.ctx.discussion.chapterID, "discussion", [], {}, { persist: false });
    }
    index.active = next.id;
    for (const chapter of index.chapters) {
     const active = this.visibleDiscussions(index).filter(c => c.chapterID === chapter.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
     chapter.activeChat = active?.id || null;
    }
    const revision = this.chatSyncID();
    for (const chapterID of new Set(this.visibleDiscussions(index).map(c => c.chapterID))) {
     const group = this.visibleDiscussions(index).filter(c => c.chapterID === chapterID).sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
     group.forEach((chat, at) => { chat.number = at + 1; chat.numberHistory = []; chat.numberingRevision = revision; });
    }
    await this.writeDiscussionIndex(view.ctx, index);
    await this.refreshRenumberedDiscussions(view, index);
    await this.switchDiscussion(view, next, index, { locked: true });
    // Sync terminal metadata too, so a recovered index cannot resurrect sources.
    for (const chat of [...chats, ...(operation === "merge" ? [next] : [])]) {
     const ctx = this.discussionContext(view.ctx, chat);
     try { await this.saveChatNotes(ctx.dir, await this.loadHistory(ctx.dir)); }
     catch (e) { this.logError("discussion change sync", e); }
    }
    return next;
   } finally { this._discussionLocks.delete(root); }
  },
  deleteDiscussions(view, ids) { return this.changeDiscussions(view, ids, "delete"); },
  mergeDiscussions(view, ids) { return this.changeDiscussions(view, ids, "merge"); },
  async legacyDiscussions(ctx, index) {
   const base = this.discussionRoot(ctx), parent = OS.Path.join(this.getDataDir(), ctx.paperItem.libraryID + "-" + ctx.paperItem.key);
   const candidates = [];
   for (const dir of new Set([base, parent])) {
    for (const file of await this.listDiscussionChildren(dir)) {
     if (!file.isDir && /^chat(?:-.+)?\.json$/.test(file.name)) {
      const history = await this.readDiscussionJSON(file.path);
      if (Array.isArray(history) && history.length && !index.migrated[file.path]) candidates.push({ key: file.path, history, dir, current: file.name === "chat.json" });
     }
    }
   }
   // Read sync notes without materializing archives or deleting any originals.
   const legacyCtx = { ...ctx, dir: base }; delete legacyCtx.discussion;
   const parentCtx = { ...legacyCtx, reading: undefined };
   for (const remote of [...this.chatNoteHistories(legacyCtx), ...this.chatNoteHistories(parentCtx)]) {
    const key = "note:" + remote.chatID + ":" + remote.revision;
    if (remote.history.length && !index.migrated[key]) candidates.push({ key, history: remote.history, remote });
   }
   return candidates;
  },
  async migrateLegacyDiscussions(view) {
   const ctx = view.ctx, dir = this.discussionRoot(ctx);
   if (this._pending.has(ctx.dir) || this._discussionLocks.has(dir)) return;
   this._discussionLocks.add(dir);
   try {
    const index = await this.discussionIndex(ctx), candidates = await this.legacyDiscussions(ctx, index), active = index.active;
    for (const old of candidates) {
     const fingerprint = await this.hashAgentText(JSON.stringify(old.history));
     const duplicate = index.chats.find(c => c.legacyFingerprint === fingerprint);
     let chat = duplicate;
     if (!chat) {
      chat = await this.createDiscussion(ctx, index, null, old.history.find(m => m.role === "user")?.text || "legacy-discussion", old.history, { legacyFingerprint: fingerprint, migrated: true });
      chat.legacyFingerprint = fingerprint; chat.migrated = true;
      // Attachment paths continue to point to retained originals.
     }
     if (old.current) await this.saveSessions(this.discussionContext(ctx, chat).dir, await this.loadSessions(old.dir));
     index.migrated[old.key] = chat.id;
     index.active = active;
     await this.writeDiscussionIndex(ctx, index);
    }
    this.updateReadingControls(view);
    this.appendError(view, "Migration complete. Original files were retained; imported discussions appear under Unassigned.", { title: "Legacy discussions migrated" });
   } finally { this._discussionLocks.delete(dir); }
  },
  openHistoryMenu(root) {
   const view = this._views.get(root); if (!view?.ctx.discussion) return original.openHistoryMenu.call(this, root);
   let index = null, legacy = [];
   const menu = this.openMenu(root, root.querySelector(".abstractin-history"), menu => {
    this.menuSection(view.doc, menu, "Chapters & discussions");
    if (!index) { menu.append(this.el(view.doc, "div", "abstractin-menu-note", "Loading…")); return; }
    for (const chapter of [...index.chapters.slice().sort((a, b) => a.order - b.order), { id: null, title: view.ctx.reading.type === "paper" ? "Paper discussions" : "Unassigned" }]) {
     const chats = index.chats.filter(c => c.chapterID === chapter.id && !c.supersededBy && !c.deletedAt).sort((a, b) => a.number - b.number);
     if (!chats.length) continue;
     this.menuSection(view.doc, menu, chapter.title);
     for (const chat of chats) this.menuItem(view.doc, menu, { label: this.discussionName(view.ctx, chat, index), checked: chat.id === view.ctx.discussion.id,
      disabled: this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx)), onSelect: async () => {
       this.closeMenu(root); try { await this.switchDiscussion(view, chat, index); } catch (e) { this.appendError(view, e.message); }
      } });
    }
    this.menuItem(view.doc, menu, { label: "Rename current discussion", onSelect: () => {
     this.closeMenu(root); const field = this.el(view.doc, "input", "abstractin-input"); field.value = view.ctx.discussion.topic;
     const panel = this.el(view.doc, "div", "abstractin-panel"), save = this.el(view.doc, "button", "abstractin-btn", "Save"), cancel = this.el(view.doc, "button", "abstractin-btn", "Cancel");
     field.setAttribute("aria-label", "Discussion topic"); save.onclick = async () => { try { await this.renameDiscussion(view, field.value); panel.remove(); } catch (e) { this.appendError(view, e.message); } };
     cancel.onclick = () => panel.remove(); panel.append(field, save, cancel); root.querySelector(".abstractin-log-wrap").append(panel); field.focus();
    } });
    if (view.ctx.reading.type === "book") this.menuItem(view.doc, menu, { label: "Move current discussion to a chapter", onSelect: async () => {
     this.closeMenu(root); const chapter = await this.chooseDiscussionChapter(view, index);
     if (chapter !== undefined) { try { await this.assignDiscussionChapter(view, chapter); } catch (e) { this.appendError(view, e.message); } }
    } });
    if (legacy.length) this.menuItem(view.doc, menu, { label: "Migrate legacy discussions (" + legacy.length + ")", desc: "Keep complete transcripts and available agent sessions; retain originals.", onSelect: () => {
     this.closeMenu(root); this.migrateLegacyDiscussions(view).catch(e => this.appendError(view, e.message));
    } });
   }, { placement: "below", align: "end" });
   if (menu) (async () => {
    index = await this.discussionIndex(view.ctx); await this.refreshDiscussionChapters(view.ctx, index);
    legacy = await this.legacyDiscussions(view.ctx, index); if (menu.isConnected) menu.refresh();
   })().catch(e => this.appendError(view, e.message));
  },
  chatTitle(chat) { return chat.title || original.chatTitle.call(this, chat); },
  async loadAllChats() {
   const results = await original.loadAllChats.call(this), root = this.getDataDir();
   if (!(await OS.File.exists(root))) return results;
   for (const folder of await this.listDiscussionChildren(root)) {
    const identity = folder.isDir && folder.name.match(/^(\d+)-([A-Z0-9]{8})$/); if (!identity) continue;
    for (const document of await this.listDiscussionChildren(folder.path)) {
     if (!document.isDir || !document.name.startsWith("reading-")) continue;
     const index = await this.readDiscussionJSON(OS.Path.join(document.path, "discussions.json"));
     for (const file of await this.listDiscussionChildren(document.path)) {
      if (file.isDir || !/^chat(?:-.+)?\.json$/.test(file.name) || index?.migrated?.[file.path]) continue;
      const history = await this.readDiscussionJSON(file.path, []);
      if (Array.isArray(history) && history.length) results.push({ dir: document.path, documentDir: document.path, attachmentKey: document.name.slice(8), libraryID: Number(identity[1]), key: identity[2], path: file.path, current: file.name === "chat.json", legacy: true, history });
     }
     if (!index?.chats) continue;
     const reading = await this.readDiscussionJSON(OS.Path.join(document.path, "reading.json"), { type: "book" });
     for (const chat of this.visibleDiscussions(index)) {
      if (!/^[a-z0-9-]+$/.test(chat.id)) continue;
      const dir = OS.Path.join(document.path, "discussions", chat.id), history = await this.readDiscussionJSON(OS.Path.join(dir, "chat.json"), []);
      if (history.length) results.push({ dir, documentDir: document.path, discussionID: chat.id, attachmentKey: document.name.slice(8),
       libraryID: Number(identity[1]), key: identity[2], path: OS.Path.join(dir, "chat.json"), current: true, history,
       topic: chat.topic, documentTitle: reading.title || "", title: this.discussionName({ reading }, chat, index) });
     }
    }
   }
   return results;
  },
  async openSearchResult(root, result) {
   const chat = result.chat;
   if (!chat.discussionID) {
    // Legacy search results are previews until explicitly migrated. Opening
    // search must not replace the active transcript or erase an old archive.
    const doc = root.ownerDocument, panel = this.el(doc, "div", "abstractin-panel abstractin-discussion-transfer");
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Legacy discussion preview");
    const close = this.el(doc, "button", "abstractin-btn", "Close"); close.onclick = () => panel.remove();
    panel.append(this.el(doc, "p", null, "Legacy discussion — preserved original. Use Chats → Classify / reimport legacy discussions to continue it."), close);
    let target;
    for (let i = 0; i < chat.history.length; i++) {
     const message = this.el(doc, "div"); message.append(this.el(doc, "strong", null, chat.history[i].role === "user" ? "You" : "Answer"));
     const content = this.el(doc, "div"); this.renderMarkdown(doc, content, chat.history[i].text); message.append(content); panel.append(message);
     if (i === result.index) { message.classList.add("abstractin-flash"); target = message; }
    }
    root.querySelector(".abstractin-log-wrap").append(panel); target?.scrollIntoView?.({ block: "center" }); return;
   }
   const view = this._views.get(root);
   if (view?.ctx.documentDir === chat.documentDir) {
    const index = await this.discussionIndex(view.ctx), selected = index.chats.find(c => c.id === chat.discussionID);
    if (selected) { await this.switchDiscussion(view, selected, index); this._jump = { dir: chat.dir, index: result.index }; this.applyJump(view); }
    return;
   }
   const item = Zotero.Items.getByLibraryAndKey(chat.libraryID, chat.key); if (!item) return;
   const attachment = (item.getAttachments?.() || []).map(id => Zotero.Items.get(id)).find(a => a?.key === chat.attachmentKey);
   if (!attachment) throw new Error("This discussion's PDF attachment is unavailable.");
   const ctx = { paperItem: item, attachmentItem: attachment, dir: chat.documentDir }, index = await this.discussionIndex(ctx);
   index.active = chat.discussionID; await this.writeDiscussionIndex(ctx, index);
   this._jump = { dir: chat.dir, index: result.index };
   const reader = await Zotero.Reader.open(attachment.id);
   if (reader._initPromise) await reader._initPromise;
   await this.openReaderPanel(reader);
   const entry = this._readerPanelWindows.get(this.readerPanelWindow(reader))?.views.get(reader);
   if (entry?.render) await entry.render;
   const targetView = entry && this._views.get(entry.root);
   if (targetView) { const next = await this.discussionIndex(targetView.ctx); await this.switchDiscussion(targetView, next.chats.find(c => c.id === chat.discussionID), next); this.applyJump(targetView); }
  },
  updateReadingControls(view) {
   original.updateReadingControls.call(this, view);
   if (!view.ctx.discussion) return;
   const button = view.root.querySelector(".abstractin-new-chat");
   if (button) { button.title = view.ctx.reading.type === "book" ? "New discussion in this chapter" : "New discussion for this paper"; button.setAttribute("aria-label", button.title); }
   let name = view.root.querySelector(".abstractin-discussion-name");
   if (!name) { name = this.el(view.doc, "div", "abstractin-discussion-name"); view.root.querySelector(".abstractin-log-wrap")?.before(name); }
   this.discussionIndex(view.ctx).then(index => {
    if (!name.isConnected) return;
    const chat = index.chats.find(c => c.id === view.ctx.discussion.id); if (chat) name.textContent = this.discussionName(view.ctx, chat, index);
   }).catch(e => this.logError("discussion name", e));
  },
  estimateDiscussionTokens(history) {
   return Math.ceil(history.reduce((sum, m) => sum + (String(m.text || "").match(/[\u3000-\u9fff]/g)?.length || 0) + String(m.text || "").replace(/[\u3000-\u9fff]/g, "").length / 4, 0));
  },
  renderMessages(view, history) {
   original.renderMessages.call(this, view, history);
   view.root.querySelector(".abstractin-discussion-budget")?.remove();
   if (!view.ctx.discussion || view.ctx.reading.type !== "paper" || this.estimateDiscussionTokens(history) < 12000) return;
   const notice = this.el(view.doc, "div", "abstractin-discussion-budget");
   notice.append(this.el(view.doc, "span", null, "This discussion is long (estimated " + this.estimateDiscussionTokens(history).toLocaleString() + " text tokens)."));
   for (const [label, action] of [["Continue current discussion", () => notice.remove()], ["New discussion", () => this.newChat(view.root).catch(e => this.appendError(view, e.message))], ["Choose messages to carry", () => this.chooseDiscussionTransfer(view, history)]]) {
    const button = this.el(view.doc, "button", "abstractin-btn", label); button.onclick = action; notice.append(button);
   }
   view.root.querySelector(".abstractin-log-wrap")?.after(notice);
  },
  chooseDiscussionTransfer(view, history) {
   const panel = this.el(view.doc, "div", "abstractin-panel abstractin-discussion-transfer");
   panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Choose context for the new discussion");
   panel.append(this.el(view.doc, "p", null, "Only the checked messages will be copied into the new discussion. You can review their complete text below."));
   const choices = history.map(message => {
    const label = this.el(view.doc, "label"), check = this.el(view.doc, "input"); check.type = "checkbox";
    label.append(check, this.el(view.doc, "pre", null, message.role + ": " + message.text)); panel.append(label); return { message, check };
   });
   const create = this.el(view.doc, "button", "abstractin-btn", "Create with selected messages"), cancel = this.el(view.doc, "button", "abstractin-btn", "Cancel");
   create.onclick = async () => { try { await this.newChat(view.root, choices.filter(c => c.check.checked).map(c => ({ ...c.message, carriedFrom: view.ctx.discussion.id }))); panel.remove(); } catch (e) { this.appendError(view, e.message); } };
   cancel.onclick = () => panel.remove(); panel.append(create, cancel); view.root.querySelector(".abstractin-log-wrap").append(panel);
  },
  // Scope Zotero sync hydration to the discussion ID. A new empty discussion
  // must never hydrate the newest transcript of a different chapter.
  chatNoteParts(ctx) {
   return original.chatNoteParts.call(this, ctx).filter(part => ctx.discussion ? part.data.discussionID === ctx.discussion.id : !part.data.discussionID);
  },
  async hydrateChatHistory(dir, local, exists) {
   const ctx = this._chatContexts.get(dir);
   if (ctx?.discussion) {
    if (exists) return local;
    const chat = this.chatNoteHistories(ctx)[0];
    if (!chat) return local;
    const history = chat.history.map(message => ({ ...message, ...(message.selection ? { selection: { ...message.selection, attachmentID: ctx.attachmentItem.id } } : {}) }));
    await Zotero.File.putContentsAsync(OS.Path.join(dir, "chat.json"), JSON.stringify(history));
    await this.writeChatSyncState(dir, { chatID: chat.chatID, writerID: chat.writerID, revision: chat.revision });
    return history;
   }
   return original.hydrateChatHistory.call(this, dir, local, exists);
  },
  async saveReadingRecord(ctx, question, selection, record) {
   if (ctx.discussion) {
    const index = await this.discussionIndex(ctx), chapter = index.chapters.find(c => c.id === ctx.discussion.chapterID);
    record.scope = chapter ? { level: "chapter", id: chapter.id, title: chapter.title } : { level: ctx.reading.type === "book" ? "book" : "paper", id: "", title: "" };
   }
   return original.saveReadingRecord.call(this, ctx, question, selection, record);
  },
  async exportContext(ctx) {
   if (!ctx.discussion) return original.exportContext.call(this, ctx);
   const metadata = "# " + (ctx.reading.title || this.safeField(ctx.paperItem, "title")) + "\nAttachment: " + ctx.attachmentItem.key;
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "metadata.md"), metadata);
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "annotations.md"), "");
   return { metadata, annotations: "" };
  },
  async exportReadingRecords(ctx) {
   if (!ctx.discussion) return original.exportReadingRecords.call(this, ctx);
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "records.md"), "# Current discussion only\nNo other discussion records are included."); return "";
  },
  async exportReadingWorkspace(ctx) {
   if (!ctx.discussion || ctx.reading.action === "contents" || ctx.reading.action === "summary") return original.exportReadingWorkspace.call(this, ctx);
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "workspace.md"), "# Current discussion\nNo other chapter notes or summaries are included."); return "";
  },
  readingPrompt(ctx, selection) {
   let text = original.readingPrompt.call(this, ctx, selection);
   if (!ctx.discussion) return text;
   text = text.replace("saved notes and previous conversation", "this discussion's messages")
    .replace(/Current editable Zotero notes take precedence over older chat: .*?\. /, "")
    .replace(/Existing contents and paper summary are in workspace\.md[\s\S]*?PDF source status:/, "PDF source status:")
    .replace(/When PDF source status is ready, source\.pdf is the exact attachment and source-text\.md contains its extracted text in this working directory\./, "source-text.md contains only the plugin-authorized original-source excerpt for this turn; the complete PDF is not available in this directory.")
    .replace(/Read records\.md only when previous discussions[\s\S]*?Current Zotero notes take precedence over old conversation text when the user has corrected a record\. /, "");
   if (ctx.reading.evidenceMode !== "knowledge") {
    text = text.replace(/Read and follow the original skill at .*?\. Resolve its supporting resources relative to that skill directory; preserve the skill and its files\. /, "Follow the original skill resources supplied inline below. ")
     .replace(/Use the original scientific-information-extraction skill at .*? for narrow local checks\. /, "Use the supplied scientific-information-extraction resources for narrow checks. ")
     .replace("Its complete text is in current-page.md when file is specified.", "Its complete text is supplied by the plugin.")
     .replace(/Read the requested portions of source-text\.md using local file tools; you do not need a Zotero browser or reader tool to access it\./, "The plugin has already located the requested original-source passages and supplied them in <authorized-source-excerpt> below. Read that excerpt directly; no file tools are required.");
    text += "\nFor this turn, original-source verification is authorized. This supersedes earlier context-only instructions in the conversation. Verify the requested statement and proof against the supplied original-source excerpt before answering. Do not refuse verification because local tools are disabled: the original text is supplied inline. If the excerpt is insufficient, identify precisely what is missing.";
   }
   return text + "\nContext boundary: use only this discussion, this turn's supplied passage/page, and authorized original-source excerpts. Supporting passages from another chapter are permitted when supplied by the plugin for this question. Do not read parent directories, other chats, unrelated notes or external sources. The current question's subject determines chapter ownership; supporting evidence never moves this discussion.";
  },
  async discussionSourceTarget(ctx) {
   let question = (ctx.reading.sourceQuestion || "") + "\n" + (ctx.reading.sourceSelection || "") + "\n" + (ctx.reading.missingSourceEvidence || "");
   let references = this.readingSourceReferences(question);
   if (!references.length) {
    const history = await this.loadHistory(ctx.dir);
    for (const previous of [...history].reverse().filter(message => message.role === "user")) {
     const candidate = (previous.text || "") + "\n" + (previous.selection?.text || "");
     references = this.readingSourceReferences(candidate);
     if (references.length) { question += "\n" + candidate; break; }
    }
   }
   return { question, references };
  },
  sourceStatementMatches(text, references) {
   const hits = [];
   for (const number of references) {
    const pattern = new RegExp("(?:theorem|lemma|proposition|corollary|definition|定理|引理|命题|推论|定义)\\s*" + number.split(".").join("\\s*\\.\\s*") + "(?!\\d|\\.\\d)", "ig");
    for (const match of text.matchAll(pattern)) {
     const before = text.slice(Math.max(0, match.index - 100), match.index);
     const after = text.slice(match.index + match[0].length, match.index + match[0].length + 12000);
     // An inline citation is weaker evidence than the actual statement heading.
     const heading = /(?:^|\n)\s*$/.test(before);
     const proof = /(?:^|\n)\s*(?:proof\b|证明)/im.test(after);
     const score = (heading ? 100 : 0) + (/^\s*[.(：:]/.test(after) ? 20 : 0) + (proof ? 10 : 0);
     hits.push({ index: match.index, score });
    }
   }
   return hits.sort((a, b) => b.score - a.score || a.index - b.index);
  },
  async unmappedDiscussionSource(ctx, source, full) {
   // Text extraction and page-link verification are separate capabilities.
   // Native reader pages have exact indices even when full-text boundaries do not.
   const sections = [], allowedPages = [];
   const current = ctx.reading.selectedPageIndex ?? ctx.reading.currentPage?.pageIndex;
   if (Number.isInteger(current)) {
    for (const index of [current, current - 1, current + 1, current + 2]) {
     if (index < 0 || index >= source.totalPages) continue;
     try {
      const page = await this.readNativeReadingPage(ctx, index);
      if (page.text.trim()) {
       allowedPages.push(index);
       sections.push("## PDF page " + (index + 1) + "; pageIndex " + index + "\n\n" + page.text);
      }
     } catch (e) { this.logError("scoped native source page", e); }
    }
   }
   if (ctx.reading.explicitSourceRequest || ctx.reading.sourceLookup) {
    const { references } = await this.discussionSourceTarget(ctx);
    // Preserve source offsets; allow line wrapping between heading/number components.
    // These excerpts establish original wording, never physical page indices.
    const ranges = [];
    const hasNativeStatement = () => sections.some(section => this.sourceStatementMatches(section.replace(/^## PDF page.*\n\n/, ""), references).some(hit => hit.score >= 100));
    if (!hasNativeStatement() && references.length && Number.isInteger(current)) {
     for (const index of [current - 2, current - 3, current + 3, current - 4, current + 4]) {
      if (index < 0 || index >= source.totalPages) continue;
      try {
       const page = await this.readNativeReadingPage(ctx, index);
       if (page.text.trim()) {
        allowedPages.push(index);
        sections.push("## PDF page " + (index + 1) + "; pageIndex " + index + "\n\n" + page.text);
       }
      } catch (e) { this.logError("nearby native source page", e); }
     }
    }
    if (!hasNativeStatement() && references.length && Number.isInteger(current) && this.readingPDFApplication(ctx)?.pdfDocument?.getPage) {
     const index = await this.discussionIndex(ctx); await this.refreshDiscussionChapters(ctx, index);
     const chapter = index.chapters.find(c => c.id === this.chapterAtPage(index, current));
     if (Number.isInteger(chapter?.pageIndex) && Number.isInteger(chapter?.endPageIndex)) {
      for (let pageIndex = chapter.pageIndex; pageIndex <= chapter.endPageIndex; pageIndex++) {
       if (allowedPages.includes(pageIndex)) continue;
       let page;
       try { page = await this.readNativeReadingPage(ctx, pageIndex); }
       catch (e) { this.logError("native chapter source lookup", e); continue; }
       if (!this.sourceStatementMatches(page.text, references).some(hit => hit.score >= 100)) continue;
       for (let near = Math.max(0, pageIndex - 1); near <= Math.min(source.totalPages - 1, pageIndex + 2); near++) {
        if (allowedPages.includes(near)) continue;
        try {
         const evidence = await this.readNativeReadingPage(ctx, near);
         if (evidence.text.trim()) {
          allowedPages.push(near);
          sections.push("## PDF page " + (near + 1) + "; pageIndex " + near + "\n\n" + evidence.text);
         }
        } catch (e) { this.logError("native chapter proof page", e); }
       }
       break;
      }
     }
    }
    for (const match of hasNativeStatement() ? [] : this.sourceStatementMatches(full, references)) {
     if (ranges.length >= 3) break;
     const start = Math.max(0, match.index - 600), end = Math.min(full.length, match.index + 12000);
     if (ranges.some(range => start >= range.start && end <= range.end)) continue;
     ranges.push({ start, end });
    }
    for (const range of ranges) sections.push("## Original PDF text excerpt — physical page location unverified\n\n" + full.slice(range.start, range.end));
   }
   if (!sections.length) return { ...source, status: "unavailable", error: "The original text could not be located and native reader page text is unavailable. Open the relevant PDF page or provide its image." };
   const bounded = { ...source, pdf: undefined, text: "source-text.md", scoped: true, allowedPages, pageMapping: false };
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-text.md"), sections.join("\n\n"));
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-manifest.json"), JSON.stringify(bounded));
   return bounded;
  },
  async exportReadingSource(ctx) {
   if (!ctx.discussion) return original.exportReadingSource.call(this, ctx);
   // The complete PDF cache is plugin-private and never copied into an agent
   // discussion directory. Only bounded, authorized text is exposed there.
   const documentCtx = { ...ctx, dir: ctx.documentDir }; delete documentCtx.discussion;
   let source = await original.exportReadingSource.call(this, documentCtx);
   if (source.status !== "ready") return source;
   source = await original.recoverReadingPageMapping.call(this, documentCtx, source);
   const full = await Zotero.File.getContentsAsync(OS.Path.join(ctx.documentDir, "source-text.md"));
   let excerpt = "", allowed = [];
   const nativePages = new Map();
   if (ctx.reading.action === "contents") excerpt = this.contentsExcerpt(full);
   else if (ctx.reading.action === "summary" && ctx.reading.type === "paper") excerpt = full;
   else {
    if (!source.pageMapping) return this.unmappedDiscussionSource(ctx, source, full);
    const index = await this.discussionIndex(ctx); await this.refreshDiscussionChapters(ctx, index);
    const chapter = index.chapters.find(c => c.id === ctx.discussion.chapterID);
    if (ctx.reading.type === "book" && /(?:chapter|章节|第.+章|本章)/i.test(ctx.reading.sourceQuestion || "") && Number.isInteger(chapter?.pageIndex) && Number.isInteger(chapter?.endPageIndex)) {
     for (let page = chapter.pageIndex; page <= chapter.endPageIndex; page++) allowed.push(page);
    } else if (Number.isInteger(ctx.reading.selectedPageIndex ?? ctx.reading.currentPage?.pageIndex)) allowed.push(ctx.reading.selectedPageIndex ?? ctx.reading.currentPage.pageIndex);
    // Explicit source requests permit a narrowly bounded lookup. Match an
    // explicit chapter, theorem or exact quoted phrase locally, without tokens.
    if (ctx.reading.explicitSourceRequest || ctx.reading.sourceLookup) {
     const { question: q, references: requested } = await this.discussionSourceTarget(ctx);
     const route = this.resolveDiscussionChapter({ ...ctx, reading: { ...ctx.reading } }, index, q.replace(/这里|此处|这一步|\bhere\b|\bthis\b/ig, ""), null, null);
     const target = !route.ambiguous && index.chapters.find(c => c.id === route.chapterID);
     if (target && target.id !== chapter?.id && Number.isInteger(target.pageIndex) && Number.isInteger(target.endPageIndex)) for (let page = target.pageIndex; page <= target.endPageIndex; page++) allowed.push(page);
     const current = ctx.reading.selectedPageIndex ?? ctx.reading.currentPage?.pageIndex;
     const localPages = [];
     if (Number.isInteger(current)) {
      for (const page of [current, current - 1, current + 1, current + 2]) {
       if (page < 0 || page >= source.totalPages) continue;
       localPages.push(page);
       try { const native = await this.readNativeReadingPage(ctx, page); if (native.text.trim()) nativePages.set(page, native.text); }
       catch (e) { this.logError("current-page source lookup", e); }
      }
     }
     const hasLocalStatement = () => localPages.some(page => this.sourceStatementMatches(nativePages.get(page) || this.pdfPageText(full, page), requested).some(hit => hit.score >= 100));
     // A proof can start before the visible page; widen nearby before searching the book.
     if (!hasLocalStatement() && requested.length && Number.isInteger(current)) {
      for (const page of [current - 2, current - 3, current + 3, current - 4, current + 4]) {
       if (page < 0 || page >= source.totalPages) continue;
       localPages.push(page);
       try { const native = await this.readNativeReadingPage(ctx, page); if (native.text.trim()) nativePages.set(page, native.text); }
       catch (e) { this.logError("nearby source lookup", e); }
      }
     }
     const localStatement = hasLocalStatement();
     const candidates = [];
     const currentChapter = index.chapters.find(c => c.id === this.chapterAtPage(index, current)) || chapter;
     const scan = (start, end) => {
      for (let page = start; page <= end && requested.length; page++) {
       const hits = this.sourceStatementMatches(this.pdfPageText(full, page), requested);
       if (hits.length) candidates.push({ page, score: hits[0].score });
      }
     };
     if (!localStatement) {
      if (Number.isInteger(currentChapter?.pageIndex) && Number.isInteger(currentChapter?.endPageIndex)) scan(currentChapter.pageIndex, currentChapter.endPageIndex);
      if (!candidates.some(candidate => candidate.score >= 100)) {
       candidates.length = 0;
       scan(0, source.totalPages - 1);
      }
     }
     candidates.sort((a, b) => b.score - a.score || a.page - b.page);
     const targetPages = [];
     for (const { page } of candidates.slice(0, 3)) {
      for (let near = Math.max(0, page - 1); near <= Math.min(source.totalPages - 1, page + 2); near++) targetPages.push(near);
     }
     // Put the target ahead of contextual pages so prompt limits cannot hide it.
     allowed = localStatement ? [...localPages, ...allowed] : [...targetPages, ...localPages, ...allowed];
    }
    allowed = [...new Set(allowed)].filter(page => page >= 0 && page < source.totalPages);
    excerpt = allowed.map(page => "## PDF page " + (page + 1) + "; pageIndex " + page + "\n\n" + (nativePages.get(page) || this.pdfPageText(full, page))).join("\n\n");
   }
   if (!excerpt.trim()) return { ...source, status: "unavailable", error: "No authorized source excerpt is located. Select a passage or explicitly request the relevant chapter." };
   const bounded = { ...source, pdf: undefined, text: "source-text.md", scoped: true, allowedPages: allowed };
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-text.md"), excerpt);
   await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-manifest.json"), JSON.stringify(bounded));
   return bounded;
  },
  codexArgs(request) {
   const args = original.codexArgs.call(this, request);
   if (request.ctx.discussion && request.ctx.reading.evidenceMode !== "knowledge") args.splice(args.length - (request.session ? 3 : 1), 0,
    "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.apps=false", "-c", 'web_search="disabled"');
   return args;
  },
  claudeArgs(request) {
   const args = original.claudeArgs.call(this, request);
   if (request.ctx?.discussion) for (const flag of ["--tools", "--allowedTools"]) args[args.indexOf(flag) + 1] = "";
   return args;
  },
  async agentReadingContext(id, ctx) {
   let text = await original.agentReadingContext.call(this, id, ctx);
   if (!ctx.discussion) return text;
   if (id === "codex" && ctx.reading.evidenceMode !== "knowledge") {
    for (const path of [ctx.reading.skillPath, ctx.reading.extractionSkillPath].filter(Boolean)) {
     const root = path.replace(/[\\/]SKILL\.md$/, "");
     const walk = async dir => {
      for (const entry of await this.listDiscussionChildren(dir)) {
       if (entry.isSymLink) throw new Error("Skill resources cannot be symbolic links.");
       if (entry.isDir) await walk(entry.path);
       else text += "\n<original-skill-resource file=" + JSON.stringify(entry.path.slice(root.length + 1)) + ">\n" + await Zotero.File.getContentsAsync(entry.path) + "\n</original-skill-resource>";
      }
     };
     await walk(root);
    }
   }
   if (ctx.reading.evidenceMode !== "knowledge") {
    const path = OS.Path.join(ctx.dir, "source-text.md");
    const source = await OS.File.exists(path) ? await Zotero.File.getContentsAsync(path) : "No original-source excerpt is available; use only the supplied passage or image.";
    this.log("Reading excerpt delivered: " + JSON.stringify({ diagnostics: "native-xray-v1", attachmentKey: ctx.attachmentItem.key, pageIndices: ctx.reading.pdfSource?.allowedPages, characters: source.length, truncated: source.length > 80000, beginning: source.slice(0, 240) }));
    text += "\n<authorized-source-excerpt>\n" + source.slice(0, 80000) + "\n</authorized-source-excerpt>" + (source.length > 80000 ? "\nThis excerpt is truncated. Do not claim complete coverage; ask for a narrower passage." : "");
   }
   return text;
  },
  async openReadingContentsEntry(view, entry) {
   await original.openReadingContentsEntry.call(this, view, entry);
   if (!view.ctx.discussion) return;
   const location = this.currentReadingLocation(view.ctx), index = await this.discussionIndex(view.ctx);
   const chapter = index.chapters.find(c => c.id === entry.id);
   if (chapter && Number.isInteger(location?.pageIndex)) { chapter.pageIndex = location.pageIndex; await this.writeDiscussionIndex(view.ctx, index); }
  },
  async recoverReadingPageMapping(ctx, source) { return ctx.discussion ? source : original.recoverReadingPageMapping.call(this, ctx, source); },
 });
})();
