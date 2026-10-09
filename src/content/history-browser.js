"use strict";

// History is a screen in the reading window, rather than a floating menu.
(() => {
 const renderMessages = AbstractIn.renderMessages;
 const switchDiscussion = AbstractIn.switchDiscussion;
 const startRequest = AbstractIn.startRequest;
 Object.assign(AbstractIn, {
  async openManagedDiscussion(view, chat) {
   if (this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx))) throw new Error("Wait for the current answer or discussion change.");
   if (chat.id !== view.ctx.discussion.id) {
    this._drafts.set(view.ctx.dir, { text: view.input.value, selection: view.draftSelection?.selection, send: false });
    await this.switchDiscussion(view, chat, await this.discussionIndex(view.ctx));
    view.input.value = ""; view.draftSelection = null; this.applyDraft(view); this.autoGrow(view.input);
   } else if (view.historyBrowser) await this.returnFromHistoryBrowser(view);
   this.setBusy(view, false);
  },
  async openManagedSearchResult(view, result) {
   if (this._pending.has(view.ctx.dir)) throw new Error("Wait for the current answer before jumping.");
   if (result.chat.discussionID && result.chat.documentDir === this.discussionRoot(view.ctx)) {
    const index = await this.discussionIndex(view.ctx), chat = this.visibleDiscussions(index).find(chat => chat.id === result.chat.discussionID);
    if (!chat) throw new Error("This discussion is unavailable.");
    if (result.index < 0) return this.openManagedDiscussion(view, chat);
    const original = result.chat.history[result.index], history = await this.loadHistory(this.discussionContext(view.ctx, chat).dir);
    const message = history.find(message => original.referenceID ? message.referenceID === original.referenceID : message.role === original.role && message.text === original.text);
    if (!message) throw new Error("This discussion content is no longer available.");
    return this.jumpToDiscussionContent(view, chat, result.index, { kind: message.role === "user" ? "Question" : "Answer", id: message.referenceID });
   }
   this._drafts.set(view.ctx.dir, { text: view.input.value, selection: view.draftSelection?.selection, send: false });
   if (view.historyBrowser) await this.returnFromHistoryBrowser(view);
   return this.openSearchResult(view.root, result);
  },
  installChatSearch(view, screen, body, index = null) {
   const browser = view.historyBrowser, doc = view.doc, controls = this.el(doc, "div", "abstractin-chat-search");
   const field = this.el(doc, "input", "abstractin-search-input"); field.type = "search";
   field.placeholder = "Search chats and messages…"; field.setAttribute("aria-label", "Search chats and messages");
   const scope = this.select(doc, [["document", "Current document"], ["all", "All documents"]], "document", () => search());
   scope.setAttribute("aria-label", "Search scope");
   const results = this.el(doc, "div", "abstractin-chat-search-results"); results.hidden = true;
   results.setAttribute("aria-live", "polite");
   controls.append(field, scope); body.before(controls, results);
   let request = 0, timer, allChats;
   const search = async () => {
    const serial = ++request, query = field.value.trim();
    body.hidden = !!query; results.hidden = !query; results.replaceChildren();
    if (!query) return;
    results.append(this.el(doc, "p", "abstractin-menu-note", "Searching…"));
    try {
     let chats;
     if (scope.value === "document" && index) {
      chats = await Promise.all(this.visibleDiscussions(index).map(async chat => {
       const ctx = this.discussionContext(view.ctx, chat);
       return { dir: ctx.dir, documentDir: this.discussionRoot(view.ctx), discussionID: chat.id, topic: chat.topic, history: await this.loadHistory(ctx.dir), title: this.discussionName(view.ctx, chat, index) };
      }));
     } else {
      allChats ||= this.loadAllChats(); chats = await allChats;
      if (scope.value === "document") chats = chats.filter(chat => chat.dir === view.ctx.dir || chat.documentDir === this.discussionRoot(view.ctx));
     }
     if (serial !== request || view.historyBrowser !== browser || !screen.isConnected) return;
     const matches = this.searchChats(chats, query), words = query.toLowerCase().split(/\s+/);
     for (const chat of chats) {
      if (words.every(word => (chat.topic || this.chatTitle(chat)).toLowerCase().includes(word)) && !matches.some(result => result.chat === chat)) {
       matches.push({ chat, index: chat.history.length ? 0 : -1, role: chat.history[0]?.role || "chat", snippet: chat.history.length ? String(chat.history[0].text || "").slice(0, 160) : "No turns yet." });
      }
     }
     results.replaceChildren(this.el(doc, "p", "abstractin-menu-note", matches.length ? matches.length + " results" : "No chats or messages match."));
     for (const result of matches) {
      const button = this.el(doc, "button", "abstractin-btn abstractin-chat-search-result"); button.type = "button";
      const turnNumber = Math.max(1, result.chat.history.slice(0, result.index + 1).filter(message => message.role === "user").length);
      const title = (scope.value === "all" && result.chat.documentTitle ? result.chat.documentTitle + " · " : "") + this.chatTitle(result.chat);
      button.append(this.el(doc, "strong", null, title), this.el(doc, "span", null, (result.index < 0 ? "" : "Turn " + turnNumber + " · " + (result.role === "user" ? "Question: " : "Answer: ")) + result.snippet));
      button.onclick = async () => { button.disabled = true; try { await this.openManagedSearchResult(view, result); } catch (e) { button.disabled = false; this.appendError(view, e.message); } };
      results.append(button);
     }
    } catch (e) {
     if (serial === request && view.historyBrowser === browser && screen.isConnected) results.textContent = "Could not search chats: " + (e.message || String(e));
     allChats = null;
    }
   };
   field.addEventListener("input", () => { ++request; view.doc.defaultView.clearTimeout(timer); if (!field.value.trim()) search(); else timer = view.doc.defaultView.setTimeout(search, 120); });
   field.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); view.doc.defaultView.clearTimeout(timer); search(); } else if (event.key === "ArrowDown") { event.preventDefault(); results.querySelector("button")?.focus(); } });
   screen.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); this.returnFromHistoryBrowser(view).catch(e => this.appendError(view, e.message)); } });
  },
  async showManagedTurns(view, chat, container) {
   const request = {}; container._turnRequest = request;
   container.replaceChildren(this.el(view.doc, "p", "abstractin-menu-note", "Loading turns…"));
   const history = await this.loadHistory(this.discussionContext(view.ctx, chat).dir);
   if (!container.isConnected || !view.historyBrowser || container._turnRequest !== request) return;
   container.replaceChildren();
   const turns = [];
   history.forEach((message, at) => {
    if (!["user", "assistant"].includes(message.role)) return;
    if (message.role === "user" || !turns.length) turns.push({ at, question: message.role === "user" ? message : null, answers: [] });
    if (message.role === "assistant") turns.at(-1).answers.push(message);
   });
   if (!turns.length) container.append(this.el(view.doc, "p", "abstractin-menu-note", "No turns yet."));
   for (const [number, turn] of turns.entries()) {
    const message = turn.question || turn.answers[0], button = this.el(view.doc, "button", "abstractin-btn abstractin-chat-turn"); button.type = "button";
    const plain = text => String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
    button.append(this.el(view.doc, "strong", null, "Turn " + (number + 1)), this.el(view.doc, "span", null, plain(message.text)));
    if (turn.question) button.append(this.el(view.doc, "span", "abstractin-menu-note", turn.answers.length ? "Answer: " + plain(turn.answers.map(answer => answer.text).join(" ")) : "Awaiting an answer"));
    button.onclick = async () => { try { await this.jumpToDiscussionContent(view, chat, turn.at, { kind: turn.question ? "Question" : "Answer", id: message.referenceID }); } catch (e) { this.appendError(view, e.message); } };
    container.append(button);
   }
  },
  leaveHistoryBrowser(view) {
   const browser = view.historyBrowser; delete view.historyBrowser;
   delete view.root.dataset.historyBrowser;
   view.root.querySelector(".abstractin-history")?.setAttribute("aria-expanded", "false");
   return browser;
  },
  async returnFromHistoryBrowser(view) {
   const browser = view.historyBrowser; if (!browser) return;
   const history = await this.loadHistory(view.ctx.dir);
   if (view.historyBrowser !== browser || browser.dir !== view.ctx.dir) return;
   this.leaveHistoryBrowser(view); this.renderMessages(view, history);
   view.input.focus({ preventScroll: true }); view.logEl.scrollTop = browser.scrollTop;
  },
  async switchDiscussion(view, chat, index, options = {}) {
   // Keep session and transcript restoration in the existing persistence path.
   if (view.historyBrowser) this.leaveHistoryBrowser(view);
   return switchDiscussion.call(this, view, chat, index, options);
  },
  startRequest(view, ...args) {
   if (view.historyBrowser) return;
   return startRequest.call(this, view, ...args);
  },
  renderMessages(view, history) {
   if (view.historyBrowser?.dir === view.ctx.dir) return;
   if (view.historyBrowser || view.root.dataset.historyBrowser) this.leaveHistoryBrowser(view);
   return renderMessages.call(this, view, history);
  },
  async openHistoryMenu(root) {
   const view = this._views.get(root); if (!view) return;
   if (view.historyBrowser) return this.returnFromHistoryBrowser(view);
   if (this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx))) {
    this.appendError(view, "Wait for the current answer or stop it before opening discussions."); return;
   }
   this.closeMenu(root);
   const browser = { dir: view.ctx.dir, scrollTop: view.logEl.scrollTop };
   view.historyBrowser = browser; root.dataset.historyBrowser = "true";
   root.querySelector(".abstractin-history")?.setAttribute("aria-expanded", "true");
   const screen = this.el(view.doc, "section", "abstractin-history-browser");
   screen.setAttribute("aria-label", "Chats");
   const header = this.el(view.doc, "div", "abstractin-history-browser-head");
   const back = this.el(view.doc, "button", "abstractin-btn", "Back to discussion");
   back.onclick = () => this.returnFromHistoryBrowser(view).catch(e => this.appendError(view, e.message));
   header.append(this.el(view.doc, "h2", null, "Chats"), back);
   const body = this.el(view.doc, "div", "abstractin-history-browser-body", "Loading…");
   screen.append(header, body); view.logEl.replaceChildren(screen); view.logEl.scrollTop = 0;
   back.focus();
   const action = (container, label, callback, className = "") => {
    const button = this.el(view.doc, "button", "abstractin-btn " + className, label); button.type = "button";
    button.onclick = async () => {
     button.disabled = true;
     try { await callback(); }
     catch (e) { this.appendError(view, e.message || String(e)); }
     finally { button.disabled = false; }
    }; container.append(button); return button;
   };
   try {
    if (!view.ctx.discussion) {
     const archives = await this.listArchives(view.ctx.dir);
     if (view.historyBrowser !== browser || !screen.isConnected) return;
     body.textContent = ""; this.installChatSearch(view, screen, body);
     if (!archives.length) body.append(this.el(view.doc, "p", "abstractin-menu-note", "No earlier discussions yet."));
     for (const archive of archives) action(body, archive.title, async () => {
      this.leaveHistoryBrowser(view); await this.restoreChat(root, archive);
     }, "abstractin-history-card");
     return;
    }
    const index = await this.discussionIndex(view.ctx); await this.refreshDiscussionChapters(view.ctx, index);
    const legacy = await this.legacyDiscussions(view.ctx, index, { includeImported: true });
    if (view.historyBrowser !== browser || !screen.isConnected) return;
    body.textContent = ""; this.installChatSearch(view, screen, body, index);
    const chapters = [...index.chapters.slice().sort((a, b) => a.order - b.order), { id: null, title: view.ctx.reading.type === "paper" ? "Paper discussions" : "Unassigned" }];
    const selected = new Set(), checks = [];
    const toolbar = this.el(view.doc, "div", "abstractin-history-selection");
    const selectionCount = this.el(view.doc, "span", "abstractin-menu-note", "Select discussions to manage");
    selectionCount.setAttribute("aria-live", "polite");
    const selectAll = action(toolbar, "Select all", () => {
     const all = selected.size === checks.length;
     for (const { check, id, row } of checks) { check.checked = !all; row.classList.toggle("abstractin-selected", !all); if (all) selected.delete(id); else selected.add(id); }
     updateSelection();
    });
    const merge = action(toolbar, "Merge selected", () => confirmChange("merge"), "abstractin-history-merge");
    const remove = action(toolbar, "Delete selected", () => confirmChange("delete"), "abstractin-history-delete");
    toolbar.prepend(selectionCount); body.append(toolbar);
    const updateSelection = () => {
     selectionCount.textContent = selected.size ? selected.size + " selected" : "Select discussions to manage";
     merge.disabled = selected.size < 2; remove.disabled = !selected.size;
     selectAll.textContent = checks.length && selected.size === checks.length ? "Clear selection" : "Select all";
    };
    const confirmChange = (kind, ids = [...selected]) => {
     screen.querySelector(".abstractin-history-confirm")?.remove();
     const panel = this.el(view.doc, "div", "abstractin-history-confirm");
     panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", kind === "merge" ? "Merge discussions" : "Delete discussions");
     panel.append(this.el(view.doc, "p", null, kind === "merge" ? "Merge " + ids.length + " discussions? Complete transcripts will be combined and named automatically. The merged discussion starts a new agent thread; different chapters go to Unassigned." : "Delete " + ids.length + " discussion(s) from history? Local originals are retained for recovery."));
     const names = this.el(view.doc, "ul");
     for (const id of ids) names.append(this.el(view.doc, "li", null, index.chats.find(c => c.id === id)?.topic || "Discussion"));
     panel.append(names);
     const error = this.el(view.doc, "p", "abstractin-menu-note"); error.setAttribute("role", "alert"); panel.append(error);
     const apply = action(panel, kind === "merge" ? "Confirm merge" : "Confirm delete", async () => {
      cancel.disabled = true;
      try {
       if (kind === "merge") await this.mergeDiscussions(view, ids); else await this.deleteDiscussions(view, ids);
       // Switching restores the new/current transcript; reopen the refreshed list.
       await this.openHistoryMenu(root);
      } catch (e) { error.textContent = e.message || String(e); }
      finally { cancel.disabled = false; }
     });
     const cancel = action(panel, "Cancel", () => panel.remove());
     toolbar.after(panel); apply.focus();
    };
    let count = 0;
    for (const chapter of chapters) {
     const chats = this.visibleDiscussions(index).filter(c => c.chapterID === chapter.id).sort((a, b) => a.number - b.number);
     if (!chats.length) continue;
     const group = this.el(view.doc, "section", "abstractin-history-chapter");
     const heading = this.el(view.doc, "div", "abstractin-history-chapter-head");
     heading.append(this.el(view.doc, "h3", null, (chapter.prefix ? chapter.prefix + " · " : "") + chapter.title), this.el(view.doc, "span", "abstractin-history-count", String(chats.length)));
     group.append(heading);
     for (const chat of chats) {
      const row = this.el(view.doc, "div", "abstractin-history-row");
      const check = this.el(view.doc, "input", "abstractin-history-check"); check.type = "checkbox";
      check.setAttribute("aria-label", "Select " + this.discussionName(view.ctx, chat, index));
      check.onchange = () => { if (check.checked) selected.add(chat.id); else selected.delete(chat.id); row.classList.toggle("abstractin-selected", check.checked); updateSelection(); };
      checks.push({ check, id: chat.id, row }); row.append(check);
      const button = action(row, "", async () => {
       await this.openManagedDiscussion(view, chat); view.input.focus();
      }, "abstractin-history-card");
      button.dataset.discussionId = chat.id; button.title = this.discussionName(view.ctx, chat, index);
      const title = chat.topic === "discussion" ? "Untitled discussion" : chat.topic.replace(/\s+/g, " ");
      button.append(this.el(view.doc, "span", "abstractin-history-topic", title));
      const meta = this.el(view.doc, "span", "abstractin-history-meta", "Discussion " + String(chat.number).padStart(2, "0") + (chat.mergedFrom ? " · Merged" : ""));
      if (chat.id === view.ctx.discussion.id) { button.setAttribute("aria-current", "true"); row.classList.add("abstractin-current-discussion"); meta.append(this.el(view.doc, "span", "abstractin-history-current", "Current")); }
      button.append(meta);
      const turns = this.el(view.doc, "div", "abstractin-chat-turns"); turns.hidden = true;
      const showTurns = action(row, "Turns", async () => {
       turns.hidden = !turns.hidden; showTurns.setAttribute("aria-expanded", String(!turns.hidden));
       if (!turns.hidden) await this.showManagedTurns(view, chat, turns);
      }, "abstractin-history-row-turns");
      showTurns.setAttribute("aria-expanded", "false"); showTurns.dataset.discussionId = chat.id;
      action(row, "Rename", () => {
       turns._turnRequest = {}; turns.hidden = false; turns.replaceChildren();
       const field = this.el(view.doc, "input", "abstractin-field"); field.value = chat.topic; field.setAttribute("aria-label", "Discussion topic");
       turns.append(field);
       action(turns, "Save", async () => {
        await this.renameDiscussion(view, field.value, chat.id);
        if (view.historyBrowser !== browser || !screen.isConnected) return;
        this.leaveHistoryBrowser(view); await this.openHistoryMenu(root);
        if (view.historyBrowser?.dir === browser.dir) view.historyBrowser.scrollTop = browser.scrollTop;
       });
       action(turns, "Cancel", () => { turns.hidden = true; }); field.focus();
      }, "abstractin-history-row-rename");
      action(row, "Delete", () => confirmChange("delete", [chat.id]), "abstractin-history-row-delete");
      group.append(row, turns); count++;
     }
     body.append(group);
    }
    updateSelection();
    if (!count) body.append(this.el(view.doc, "p", "abstractin-menu-note", "No discussions yet."));
    const tools = this.el(view.doc, "div", "abstractin-history-browser-actions");
    if (view.ctx.reading.type === "book") action(tools, "Move current discussion to a chapter", async () => {
     await this.returnFromHistoryBrowser(view); const chapter = await this.chooseDiscussionChapter(view, index);
     if (chapter !== undefined) await this.assignDiscussionChapter(view, chapter);
    });
    if (legacy.length) action(tools, "Classify / reimport legacy discussions", async () => {
     await this.returnFromHistoryBrowser(view); await this.openLegacyClassification(view);
    }, "abstractin-reclassify");
    body.append(tools);
   } catch (e) {
    if (view.historyBrowser !== browser) return;
    body.textContent = "Could not load discussions: " + (e.message || String(e));
   }
  },
 });
})();
