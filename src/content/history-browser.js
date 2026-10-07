"use strict";

// History is a screen in the reading window, rather than a floating menu.
(() => {
 const renderMessages = AbstractIn.renderMessages;
 const switchDiscussion = AbstractIn.switchDiscussion;
 const startRequest = AbstractIn.startRequest;
 Object.assign(AbstractIn, {
  leaveHistoryBrowser(view) {
   const browser = view.historyBrowser; delete view.historyBrowser;
   delete view.root.dataset.historyBrowser;
   view.root.querySelector(".abstractin-history")?.setAttribute("aria-expanded", "false");
   return browser;
  },
  async returnFromHistoryBrowser(view) {
   const browser = this.leaveHistoryBrowser(view);
   this.renderMessages(view, await this.loadHistory(view.ctx.dir));
   if (browser?.dir === view.ctx.dir) view.logEl.scrollTop = browser.scrollTop;
   view.input.focus();
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
   screen.setAttribute("aria-label", "Chapters and discussions");
   const header = this.el(view.doc, "div", "abstractin-history-browser-head");
   const back = this.el(view.doc, "button", "abstractin-btn", "Back to discussion");
   back.onclick = () => this.returnFromHistoryBrowser(view).catch(e => this.appendError(view, e.message));
   header.append(this.el(view.doc, "h2", null, "Chapters & discussions"), back);
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
     body.textContent = "";
     if (!archives.length) body.append(this.el(view.doc, "p", "abstractin-menu-note", "No earlier discussions yet."));
     for (const archive of archives) action(body, archive.title, async () => {
      this.leaveHistoryBrowser(view); await this.restoreChat(root, archive);
     }, "abstractin-history-card");
     return;
    }
    const index = await this.discussionIndex(view.ctx); await this.refreshDiscussionChapters(view.ctx, index);
    const legacy = await this.legacyDiscussions(view.ctx, index, { includeImported: true });
    if (view.historyBrowser !== browser || !screen.isConnected) return;
    body.textContent = "";
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
       await this.switchDiscussion(view, chat, index); this.setBusy(view, false); view.input.focus();
      }, "abstractin-history-card");
      button.dataset.discussionId = chat.id; button.title = this.discussionName(view.ctx, chat, index);
      const title = chat.topic === "discussion" ? "Untitled discussion" : chat.topic.replace(/\s+/g, " ");
      button.append(this.el(view.doc, "span", "abstractin-history-topic", title));
      const meta = this.el(view.doc, "span", "abstractin-history-meta", "Discussion " + String(chat.number).padStart(2, "0") + (chat.mergedFrom ? " · Merged" : ""));
      if (chat.id === view.ctx.discussion.id) { button.setAttribute("aria-current", "true"); row.classList.add("abstractin-current-discussion"); meta.append(this.el(view.doc, "span", "abstractin-history-current", "Current")); }
      button.append(meta);
      action(row, "Delete", () => confirmChange("delete", [chat.id]), "abstractin-history-row-delete");
      group.append(row); count++;
     }
     body.append(group);
    }
    updateSelection();
    if (!count) body.append(this.el(view.doc, "p", "abstractin-menu-note", "No discussions yet."));
    const tools = this.el(view.doc, "div", "abstractin-history-browser-actions");
    action(tools, "Rename current discussion", async () => {
     await this.returnFromHistoryBrowser(view);
     const panel = this.el(view.doc, "div", "abstractin-panel abstractin-reference-review");
     panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Rename discussion");
     const field = this.el(view.doc, "input", "abstractin-field"); field.value = view.ctx.discussion.topic; field.setAttribute("aria-label", "Discussion topic");
     panel.append(field);
     action(panel, "Save", async () => { await this.renameDiscussion(view, field.value); panel.remove(); });
     action(panel, "Cancel", () => panel.remove()); root.querySelector(".abstractin-log-wrap").append(panel); field.focus();
    });
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
