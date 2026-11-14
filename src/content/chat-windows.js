"use strict";

// A standalone window owns a fresh discussion, never a moved or cloned view.
// Its transcript and agent sessions use the normal document/workspace store.
(() => {
 const closeNotes = AbstractIn.closeMarkdownNoteWindows, storageViews = AbstractIn.noteStorageViews;
 Object.assign(AbstractIn, {
  _chatWindows: new Map(),
  async newChatWindowContext({ view = null, noteState = null, ctx = null } = {}) {
   const source = ctx || view?.ctx || noteState?.readingLayout?.readingContext || noteState?.sourceView?.ctx;
   let paperItem = source?.paperItem, attachmentItem = source?.attachmentItem;
   const data = noteState && this.markdownNoteData(noteState.note);
   const documents = noteState?.documents || source?.workspaceDocuments || data?.documents;
   const workspace = noteState?.readingWorkspace || source?.readingWorkspace || data?.workspace;
   if (!attachmentItem || source?.noteWorkspace) {
    paperItem = documents?.length ? await this.resolveNoteDocument(documents[0]) : noteState?.parent;
    attachmentItem = await paperItem?.getBestAttachment?.();
   }
   if (!paperItem || !attachmentItem?.isPDFAttachment?.()) throw new Error("Choose a document with a PDF before opening a chat window.");
   const documentDir = workspace ? OS.Path.join(this.getDataDir(), "workspaces", paperItem.libraryID + "-" + workspace.id) :
    source?.discussion && !source.noteWorkspace ? this.discussionRoot(source) : OS.Path.join(this.getDataDir(), paperItem.libraryID + "-" + paperItem.key, "reading-" + attachmentItem.key);
   await Zotero.File.createDirectoryIfMissingAsync(documentDir);
   const saved = source?.reading || this._readingStates.get(attachmentItem.id) || await this.syncedReadingState(paperItem, attachmentItem);
   const reading = {};
   for (const key of ["type", "title", "goal", "skillPath", "extractionSkillPath"]) if (saved?.[key] !== undefined) reading[key] = saved[key];
   reading.type ||= this.readingType(paperItem) || "paper"; reading.title ||= this.safeField(paperItem, "title");
   const fresh = { paperItem, attachmentItem, documentDir, dir: documentDir, reading, chatWindowID: this.chatSyncID(),
    ...(workspace ? { readingWorkspace: { ...workspace }, workspaceNote: source?.workspaceNote || noteState?.note } : {}),
    ...(documents ? { workspaceDocuments: documents.map(ref => ({ ...ref })) } : {}),
    ...(noteState?.note ? { activeNoteKey: noteState.note.key } : {}) };
   if (!reading.skillPath) Object.assign(reading, await this.prepareReadingSkills(fresh));
   return fresh;
  },
  async openNewChatWindow(options = {}) {
   const ctx = await this.newChatWindowContext(options), root = this.discussionRoot(ctx);
   if (this._discussionLocks.has(root)) throw new Error("Wait for the current discussion change to finish.");
   this._discussionLocks.add(root);
   let fresh;
   try {
    await this.loadScopedDiscussionNotes(ctx);
    const index = await this.discussionIndex(ctx);
    await this.refreshSyncedDiscussionIndex(ctx, index); await this.refreshDiscussionChapters(ctx, index);
    const source = options.ctx || options.view?.ctx || options.noteState?.readingLayout?.readingContext || options.noteState?.sourceView?.ctx;
    const chapterID = index.chapters.some(chapter => chapter.id === source?.discussion?.chapterID) ? source.discussion.chapterID : null;
    const active = index.active, chapter = index.chapters.find(entry => entry.id === chapterID), activeChat = chapter?.activeChat;
    const chat = await this.createDiscussion(ctx, index, chapterID, "discussion", [], {}, { persist: false });
    // Creating a window must not replace the main view's last active chat.
    index.active = active; if (chapter) chapter.activeChat = activeChat;
    await this.writeDiscussionIndex(ctx, index);
    fresh = this.discussionContext(ctx, chat); await this.saveSessions(fresh.dir, {});
   } finally { this._discussionLocks.delete(root); }
   const state = { id: ctx.chatWindowID, ctx: fresh, view: null, win: null };
   this._chatWindows.set(state.id, state);
   try {
    const win = options.win || options.view?.doc.defaultView || options.noteState?.win || Zotero.getMainWindow();
    state.win = win.openDialog((this.resourceURI || "chrome://abstractin/content/") + "chat-window.xhtml", "abstractin-chat-" + state.id,
     "chrome,dialog=no,titlebar,centerscreen,resizable=yes,width=650,height=850", { chatWindowID: state.id });
    state.win.focus(); return state;
   } catch (error) { this._chatWindows.delete(state.id); throw new Error("The new chat was saved, but its window could not open: " + (error.message || error)); }
  },
  async mountChatWindow(state, win) {
   if (state.disposed) return;
   state.win = win;
   const doc = win.document, host = doc.getElementById("abstractin-chat-window-root");
   const scope = this.el(doc, "header", "abstractin-layout-toolbar abstractin-chat-window-scope", state.ctx.readingWorkspace?.name || this.safeField(state.ctx.paperItem, "title"));
   host.append(scope); this.renderSkeleton(doc, host);
   const root = host.querySelector(".abstractin-root"), input = root.querySelector(".abstractin-input");
   const view = { doc, root, input, logEl: root.querySelector(".abstractin-log"), ctx: this.registerChatContext(state.ctx) };
   state.view = view; view.send = (text, images) => this.sendText(view, text, images); this._views.set(root, view);
   state.dispose = () => {
    if (state.disposed) return; state.disposed = true; view.disposed = true;
    this.rememberChatPosition(view); this._pending.get(view.ctx.dir)?.cancel(); root.disposeUI?.(); this._views.delete(root); this._chatWindows.delete(state.id);
    if (!this.noteStorageViews().some(other => other.ctx?.dir === view.ctx.dir && !other.disposed && other.root?.isConnected)) this.endNoteSession(view.ctx.dir);
   };
   win.addEventListener("unload", state.dispose, { once: true });
   root.dataset.sharedSources = "true"; root.dataset.readingTheme = "neutral";
   root.querySelector(".abstractin-header-title").textContent = "Discussion";
   this.updateReadingControls(view); this.renderAttachments(view);
   const history = await this.loadHistory(view.ctx.dir); if (state.disposed || win.closed) return;
   this.renderMessages(view, history); this.setBusy(view, false);
   input.addEventListener("input", () => { this.autoGrow(input); if (!this._pending.has(view.ctx.dir)) root.querySelector(".abstractin-send").disabled = !this.canSend(view); });
   input.addEventListener("keydown", event => {
    if (this.isSendKey(event) && !event.isComposing) { event.preventDefault(); this.sendOrStop(root); }
    else if (event.key === "Escape") this._pending.get(view.ctx.dir)?.cancel();
   });
   input.addEventListener("paste", event => this.onPasteOrDrop(view, event, event.clipboardData));
   const composer = root.querySelector(".abstractin-composer");
   composer.addEventListener("dragover", event => { if ([...(event.dataTransfer?.types || [])].includes("Files")) event.preventDefault(); });
   composer.addEventListener("drop", event => this.onPasteOrDrop(view, event, event.dataTransfer));
   win.document.title = "AbstractIn — " + (state.ctx.readingWorkspace?.name || this.safeField(state.ctx.paperItem, "title")) + " — Discussion";
   input.focus();
  },
  noteStorageViews() { return [...new Set([...storageViews.call(this), ...[...this._chatWindows.values()].map(state => state.view).filter(view => view?.root.isConnected)])]; },
  async closeMarkdownNoteWindows() {
   for (const state of [...this._chatWindows.values()]) { this._pending.get(state.view?.ctx.dir)?.cancel(); state.dispose?.(); if (state.win && !state.win.closed) state.win.close(); }
   this._chatWindows.clear(); return closeNotes.call(this);
  }
 });
})();
