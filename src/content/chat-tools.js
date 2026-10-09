"use strict";

// Migration is a separate, explicit inspection workflow. Ordinary discussions
// never receive its inputs or gain access to another discussion implicitly.
(() => {
 const previous = {};
 for (const name of ["discussionName", "legacyDiscussions", "openHistoryMenu", "updateReadingControls", "renderMessages", "linkTheorems", "loadHistory", "saveHistory", "assignDiscussionChapter", "readingPrompt", "resolveDiscussionChapter", "requestsReadingSource", "requestsKnowledgeDiscussion"]) previous[name] = AbstractIn[name];
 Object.assign(AbstractIn, {
  discussionQuestionSubject(text) {
   if (!/\[result:[a-z0-9:-]+(?:\|[^\]\n]+)?\]/.test(text)) return text;
   return String(text).split("\n").filter(line => !/^\s*>/.test(line)).join("\n").replace(/\[result:[a-z0-9:-]+(?:\|[^\]\n]+)?\]/g, "");
  },
  resolveDiscussionChapter(ctx, index, question, selection, location) {
   return previous.resolveDiscussionChapter.call(this, ctx, index, this.discussionQuestionSubject(question), selection, location);
  },
  requestsReadingSource(question) { return previous.requestsReadingSource.call(this, this.discussionQuestionSubject(question)); },
  requestsKnowledgeDiscussion(question) { return previous.requestsKnowledgeDiscussion.call(this, this.discussionQuestionSubject(question)); },
  shortDiscussionTopic(text) {
   const named = String(text || "").match(/(?:theorem|lemma|定理|引理)\s*[A-Z]?\.?\d+(?:\.\d+)*\s*\(([^)]+)\)/i);
   let topic = named?.[1] || String(text || "").split(/\n\s*\n/)[0];
   topic = topic.replace(/(?:chapter\s*\d+|appendix\s*[A-Z0-9]+|第\s*\d+\s*章|附录\s*[A-Z0-9]+)[\s:：-]*/ig, "")
    .replace(/\b(?:about|explain|ask|this|the|a|an|passage|please|question|p\.?\s*\d+|theorem\s*[A-Z]?\.?\d+(?:\.\d+)*)\b/ig, " ").trim();
   const slug = this.discussionSlug(topic, "discussion");
   return slug.split("-").slice(0, 4).join("-").slice(0, 30).replace(/-$/g, "");
  },
  discussionName(ctx, chat, index) {
   const chapter = index.chapters.find(c => c.id === chat.chapterID);
   return (ctx.reading.type === "paper" ? "paper" : chapter?.prefix || "unassigned") + "_chat-" + String(chat.number).padStart(2, "0") + "_" + this.shortDiscussionTopic(chat.topic);
  },
  async legacyDiscussions(ctx, index, { includeImported = false } = {}) {
   if (!includeImported) return previous.legacyDiscussions.call(this, ctx, index);
   return previous.legacyDiscussions.call(this, ctx, { ...index, migrated: {} });
  },
  classifyLegacyTurns(ctx, index, candidates) {
   const turns = [], seen = new Set();
   for (const old of candidates) {
    let inherited = null;
    for (let start = 0; start < old.history.length;) {
     let end = start + 1;
     while (end < old.history.length && old.history[end].role !== "user") end++;
     const messages = old.history.slice(start, end), user = messages.find(m => m.role === "user");
     const key = JSON.stringify(messages);
     if (seen.has(key)) { start = end; continue; } seen.add(key);
     const selection = user?.selection;
     let chapterID = null, reason = "Needs review";
     if (ctx.reading.type === "paper") reason = "Paper discussion";
     else {
      const page = selection?.position?.pageIndex ?? selection?.pageIndex;
      if (Number.isInteger(page)) { chapterID = this.chapterAtPage(index, page); if (chapterID) reason = "Verified selected-page range"; }
      const explicit = user && /\bchapter\s+\d+|第\s*\d+\s*章|\bappendix\s+[A-Z0-9]+|附录\s*[A-Z0-9]+/i.test(user.text);
      if (!chapterID && explicit) {
       const route = this.resolveDiscussionChapter({ ...ctx, discussion: { chapterID: inherited } }, index, user.text, null, null);
       if (!route.ambiguous && route.chapterID) { chapterID = route.chapterID; reason = "Explicit question subject"; }
      }
      if (!chapterID && inherited && /^(?:why|continue|and\b|what about|can you explain further|为什么|继续|那么|所以|进一步)/i.test(user?.text?.trim() || "")) { chapterID = inherited; reason = "Follow-up to preceding classified turn"; }
      // Evidence chapters cited in an answer and theorem number prefixes are
      // deliberately excluded from automatic ownership classification.
     }
     inherited = chapterID;
     turns.push({ key: "turn-" + turns.length, chapterID, reason, messages, sourceKey: old.key, source: old, start }); start = end;
    }
   }
   return turns;
  },
  async openLegacyClassification(view) {
   if (this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx))) return;
   const index = await this.discussionIndex(view.ctx); await this.refreshDiscussionChapters(view.ctx, index);
   const candidates = await this.legacyDiscussions(view.ctx, index, { includeImported: true });
   const turns = this.classifyLegacyTurns(view.ctx, index, candidates);
   const panel = this.el(view.doc, "div", "abstractin-panel abstractin-migration-review");
   panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Classify legacy discussions");
   panel.append(this.el(view.doc, "p", null, "Review chapter ownership before importing. Turns assigned to the same chapter are combined in one discussion. Original files and earlier imports are retained. Splitting or combining records starts a fresh agent thread."));
   const status = this.el(view.doc, "p", "abstractin-menu-note"); panel.append(status);
   const rows = turns.map(turn => {
    const row = this.el(view.doc, "div", "abstractin-migration-turn");
    const select = this.select(view.doc, [["", "Unassigned"], ...index.chapters.slice().sort((a, b) => a.order - b.order).map(c => [c.id, c.prefix + " · " + c.title])], turn.chapterID || "", value => { turn.chapterID = value || null; turn.reason = "User choice"; });
    select.setAttribute("aria-label", "Chapter for " + turn.key);
    const details = this.el(view.doc, "details"), summary = this.el(view.doc, "summary", null, (turn.messages.find(m => m.role === "user")?.text || "Earlier answer").slice(0, 180));
    details.append(summary, this.el(view.doc, "pre", null, turn.messages.map(m => m.role + ": " + m.text).join("\n\n")));
    row.append(select, this.el(view.doc, "span", "abstractin-menu-note", turn.reason), details); panel.append(row); return { turn, select };
   });
   const ai = this.el(view.doc, "button", "abstractin-btn", "Suggest chapters with agent"), apply = this.el(view.doc, "button", "abstractin-btn", "Import reviewed classification"), close = this.el(view.doc, "button", "abstractin-btn", "Cancel");
   ai.onclick = async () => {
    ai.disabled = true; apply.disabled = true; close.disabled = true; for (const { select } of rows) select.disabled = true;
    try {
     status.textContent = "Inspecting only these migration excerpts and chapter headings…";
     await this.suggestLegacyChapters(view, index, turns);
     for (const { turn, select } of rows) select.value = turn.chapterID || "";
     status.textContent = "Suggestions are ready. Review them before importing; uncertain turns remain Unassigned.";
    } catch (e) { status.textContent = e.message || String(e); }
    finally { ai.disabled = false; apply.disabled = false; close.disabled = false; for (const { select } of rows) select.disabled = false; }
   };
   apply.onclick = async () => {
    ai.disabled = true; apply.disabled = true;
    try { await this.importClassifiedLegacy(view, index, turns, candidates); panel.remove(); this.updateReadingControls(view); }
    catch (e) { status.textContent = e.message || String(e); ai.disabled = false; apply.disabled = false; }
   };
   close.onclick = () => panel.remove(); panel.append(ai, apply, close); view.root.querySelector(".abstractin-log-wrap").append(panel);
  },
  async suggestLegacyChapters(view, index, turns) {
   const backend = this.readingAgent(); await this.assertAgentReadingReady(backend, "knowledge");
   const container = OS.Path.join(this.discussionRoot(view.ctx), "migration-reviews"); await Zotero.File.createDirectoryIfMissingAsync(container);
   const dir = OS.Path.join(container, this.chatSyncID()); await Zotero.File.createDirectoryIfMissingAsync(dir);
   const ctx = { ...view.ctx, dir, discussion: { id: "migration-review" }, reading: { ...view.ctx.reading, evidenceMode: "knowledge", currentPage: null } };
   // Batches keep migration work bounded. Only unknown ownership is sent;
   // answers provide topic clues, never permission to follow their evidence.
   const unknown = turns.filter(t => !t.chapterID && t.reason !== "User choice");
   for (let offset = 0; offset < unknown.length; offset += 8) {
    const batch = unknown.slice(offset, offset + 8);
    const question = "Classify these legacy question/answer turns by the chapter the USER QUESTION IS ABOUT, not the chapter cited as supporting evidence. This is an explicit migration inspection, separate from all reading chats. Use only the supplied excerpts and verified chapter headings. Never infer a chapter from a theorem number or printed page without a verified mapping. If uncertain return null. Do not open files or use tools. Return only JSON {\"assignments\":[{\"key\":\"turn-key\",\"chapterID\":\"verified-id or null\"}]}.\n" + JSON.stringify({ chapters: index.chapters.map(({ id, title }) => ({ id, title })), turns: batch.map(t => ({ key: t.key, question: (t.messages.find(m => m.role === "user")?.text || "").slice(0, 8000), answer: t.messages.filter(m => m.role === "assistant").map(m => m.text).join("\n").slice(0, 2000) })) });
    const result = await this.runBackend(backend, { ctx, files: {}, history: [], session: null, question, images: [], model: this.getModel(backend), effort: this.getEffort(backend), onProgress() {}, onSpawn() {} });
    if (result.error) throw new Error(result.error);
    const data = this.parseAgentObject(result.text);
    if (!Array.isArray(data.assignments)) throw new Error("The agent did not return a classification list.");
    for (const assignment of data.assignments) {
     const turn = batch.find(t => t.key === assignment.key);
     if (turn && index.chapters.some(c => c.id === assignment.chapterID)) { turn.chapterID = assignment.chapterID; turn.reason = "Agent suggestion — review required"; }
    }
   }
  },
  async importClassifiedLegacy(view, ignoredIndex, turns, candidates) {
   const ctx = view.ctx, root = this.discussionRoot(ctx);
   if (this._pending.has(ctx.dir) || this._discussionLocks.has(root)) throw new Error("Wait for the current operation before importing.");
   this._discussionLocks.add(root);
   try {
    const index = await this.discussionIndex(ctx), active = index.active;
    const fingerprint = await this.hashAgentText(JSON.stringify(turns.map(t => [t.sourceKey, t.start, t.chapterID, t.messages])));
    if (index.classifiedImports?.[fingerprint]) return;
    const groups = new Map();
    for (const turn of turns) {
     if (turn.chapterID && !index.chapters.some(c => c.id === turn.chapterID)) throw new Error("Unknown chapter in classification.");
     if (!groups.has(turn.chapterID)) groups.set(turn.chapterID, []); groups.get(turn.chapterID).push(turn);
    }
    const ids = [];
    for (const [chapterID, group] of groups) {
     group.sort((a, b) => (a.messages[0]?.ts || 0) - (b.messages[0]?.ts || 0));
     const key = fingerprint + ":" + (chapterID || "unassigned");
     let chat = index.chats.find(c => c.classifiedKey === key);
     if (!chat) {
      const messages = group.flatMap(t => t.messages.map((message, offset) => ({ ...message, referenceID: message.referenceID || this.chatSyncID(), migratedFrom: { source: t.sourceKey, index: t.start + offset } })));
      chat = await this.createDiscussion(ctx, index, chapterID, group[0].messages.find(m => m.role === "user")?.text || "discussion", messages, { migrated: true, classifiedKey: key });
      index.active = active;
      // Agent thread IDs from a mixed transcript must never be resumed in a
      // chapter-specific transcript; they still belong to the preserved import.
      const imported = this.discussionContext(ctx, chat);
      await this.saveSessions(imported.dir, {});
      const warning = await this.saveHistory(imported.dir, messages);
      if (warning) this.appendError(view, warning);
     }
     ids.push(chat.id);
    }
    for (const candidate of candidates) {
     const hash = await this.hashAgentText(JSON.stringify(candidate.history));
     for (const chat of index.chats.filter(c => c.legacyFingerprint === hash && !c.classifiedKey)) {
      const history = await this.loadHistory(this.discussionContext(ctx, chat).dir);
      if (JSON.stringify(history.map(({ referenceID, results, ...message }) => message)) === JSON.stringify(candidate.history.map(({ referenceID, results, ...message }) => message))) chat.supersededBy = ids;
     }
     index.migrated[candidate.key] = ids[0];
    }
    index.classifiedImports ||= {}; index.classifiedImports[fingerprint] = ids;
    index.active = active; await this.writeDiscussionIndex(ctx, index);
    if (index.chats.find(c => c.id === active)?.supersededBy) {
     const replacement = index.chats.find(c => ids.includes(c.id) && c.chapterID === ctx.discussion.chapterID) || index.chats.find(c => ids.includes(c.id));
     if (replacement) await this.switchDiscussion(view, replacement, index, { locked: true });
    }
   } finally { this._discussionLocks.delete(root); }
  },
  openHistoryMenu(root) {
   previous.openHistoryMenu.call(this, root);
   const view = this._views.get(root), menu = root.querySelector(".abstractin-menu");
   if (!view?.ctx.discussion || !menu) return;
   // The normal menu refreshes asynchronously; attach this persistent entry
   // through refresh so it remains available for already imported transcripts.
   menu.addEventListener("click", event => {
    const item = event.target.closest(".abstractin-menu-item");
    if (!item?.textContent.includes("Migrate legacy discussions")) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.closeMenu(root);
    this.openLegacyClassification(view).catch(e => this.appendError(view, e.message));
   }, true);
   const refresh = menu.refresh; let hasLegacy = false;
   const add = () => {
    if (!hasLegacy || menu.querySelector(".abstractin-reclassify")) return;
    const button = this.el(view.doc, "button", "abstractin-menu-item abstractin-reclassify", "Classify / reimport legacy discussions");
    button.onclick = () => { this.closeMenu(root); this.openLegacyClassification(view).catch(e => this.appendError(view, e.message)); }; menu.append(button);
   };
   menu.refresh = (...args) => { refresh?.(...args); add(); };
   this.discussionIndex(view.ctx).then(index => this.legacyDiscussions(view.ctx, index, { includeImported: true })).then(candidates => { hasLegacy = candidates.length > 0; if (menu.isConnected) menu.refresh(); }).catch(e => this.logError("legacy classification entry", e));
  },
  discussionResultLabel(result) { return "Chat " + result.kind + " " + result.number; },
  extractDiscussionResults(text) {
   // Ignore examples in code fences; preserve the original Markdown/LaTeX excerpt.
   const source = String(text || "");
   const masked = source.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm, match => match.replace(/[^\n]/g, " "));
   const results = [];
   const formal = /^\s*\\begin\{(theorem|lemma|proposition|corollary|claim|conjecture|definition|notation|remark|note|example|exercise)(\*?)\}(?:\[([^\]]*)\])?[\s\S]*?\\end\{\1\2\}/gm;
   for (const match of masked.matchAll(formal)) {
    results.push({ kind: this.BOX_ENVS[match[1]], title: match[3]?.trim() || "", text: source.slice(match.index, match.index + match[0].length).trim(), start: match.index, end: match.index + match[0].length, env: match[1] });
   }
   // Also recognize old answers that used a Markdown heading instead of an environment.
   const headings = [...masked.matchAll(/^(?:#{1,6}\s+|\*\*)(Theorem|Lemma|Proposition|Corollary|Definition|Result|定理|引理|命题|推论|定义|结论)(?=\s|\d|[.:：—*（(]|$)[^\n]*$/gmi)];
   const kinds = { 定理: "Theorem", 引理: "Lemma", 命题: "Proposition", 推论: "Corollary", 定义: "Definition", 结论: "Result" };
   for (const match of headings) {
    if (results.some(r => match.index >= r.start && match.index < r.end)) continue;
    const tail = masked.slice(match.index + match[0].length);
    const boundary = tail.search(/^\s*(?:#{1,6}\s|\*\*(?:Theorem|Lemma|Proposition|Corollary|Definition|Result|Proof|定理|引理|命题|推论|定义|结论|证明)|\\begin\{)/mi);
    const end = boundary < 0 ? source.length : match.index + match[0].length + boundary;
    const kind = kinds[match[1]] || match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const title = match[0].replace(/^(?:#{1,6}\s+|\*\*)/, "").replace(/\*\*/g, "").replace(/^(?:Theorem|Lemma|Proposition|Corollary|Definition|Result|定理|引理|命题|推论|定义|结论)\s*(?:[A-Z]?\.?\d+(?:\.\d+)*)?\s*[.:：—-]?\s*/i, "").trim();
    results.push({ kind, title, text: source.slice(match.index, end).trim(), start: match.index, end });
   }
   results.sort((a, b) => a.start - b.start);
   return results.length ? results : source.trim() ? [{ kind: "Result", title: source.replace(/\s+/g, " ").slice(0, 80), text: source, start: 0, end: source.length }] : [];
  },
  numberDiscussionResults(ctx, history, index) {
   const chat = index.chats.find(c => c.id === ctx.discussion.id) || ctx.discussion;
   const chapter = index.chapters.find(c => c.id === chat.chapterID);
   const chapterLabel = chapter?.prefix?.replace(/^chap-(?:app-)?/, "").replace(/^0+(?=\d)/, "");
   const prefix = ctx.reading.type === "paper" ? "P" : chapterLabel ? (/^chap-app-\d/.test(chapter.prefix) ? "App" : "") + chapterLabel : "U";
   let turn = 0, ordinal = 0, changed = false;
   for (const message of history) {
    if (!message.referenceID) { message.referenceID = this.chatSyncID(); changed = true; }
    if (message.role === "user") { turn++; ordinal = 0; }
    if (message.role !== "assistant") continue;
    if (!Array.isArray(message.results)) {
     message.results = this.extractDiscussionResults(message.text).map(result => ({ ...result, id: message.referenceID + "-r-" + (++ordinal), number: [prefix, chat.number, Math.max(1, turn), ordinal].join("."), origin: { discussionID: chat.id, chapterID: chat.chapterID, turn: Math.max(1, turn) } }));
     changed = true;
    } else {
     for (const result of message.results) {
      ordinal++;
      if (chat.numberingRevision && message.resultsNumberingRevision !== chat.numberingRevision) {
       result.number = [prefix, chat.number, Math.max(1, turn), ordinal].join("."); changed = true;
      }
     }
    }
    if (chat.numberingRevision && message.resultsNumberingRevision !== chat.numberingRevision) { message.resultsNumberingRevision = chat.numberingRevision; changed = true; }
   }
   return changed;
  },
  async refreshRenumberedDiscussions(view, index) {
   const labels = new Map(), records = [];
   for (const chat of this.visibleDiscussions(index)) {
    const ctx = this.discussionContext(view.ctx, chat), history = await this.loadHistory(ctx.dir);
    for (const message of history) {
     for (const result of message.results || []) labels.set("result:" + result.id, this.discussionResultLabel(result));
     if (message.results?.length === 1) labels.set("result:" + message.referenceID, this.discussionResultLabel(message.results[0]));
    }
    records.push({ ctx, history });
   }
   const update = text => String(text || "").replace(/\[(result:[a-z0-9:-]+)(?:\|[^\]\n]+)?\]/g, (marker, id) => labels.has(id) ? "[" + id + "|" + labels.get(id) + "]" : marker);
   for (const { ctx, history } of records) {
    let changed = false;
    for (const message of history) {
     const text = update(message.text); if (text !== message.text) { message.text = text; changed = true; }
     for (const result of message.results || []) { const text = update(result.text); if (text !== result.text) { result.text = text; changed = true; } }
    }
    if (changed) await this.saveHistory(ctx.dir, history);
   }
   const roots = new Set([view.root]);
   for (const win of new Set([...(Zotero.getMainWindows?.() || [Zotero.getMainWindow()]), ...this._readerPanelWindows.keys()])) for (const root of win.document.querySelectorAll(".abstractin-root")) roots.add(root);
   for (const root of roots) {
    const other = this._views.get(root);
    if (other && this.discussionRoot(other.ctx) === this.discussionRoot(view.ctx)) other.input.value = update(other.input.value);
   }
  },
  async assignDiscussionChapter(view, chapterID) {
   if (this._pending.has(view.ctx.dir) || this._discussionLocks.has(this.discussionRoot(view.ctx))) throw new Error("Wait for the current answer before moving this discussion.");
   // Freeze the original numbering before the chapter or discussion number changes.
   await this.loadHistory(view.ctx.dir);
   await previous.assignDiscussionChapter.call(this, view, chapterID);
   try { await this.saveChatNotes(view.ctx.dir, await this.loadHistory(view.ctx.dir)); }
   catch (e) { this.logError("discussion result numbering sync", e); }
  },
  async loadHistory(dir) {
   const history = await previous.loadHistory.call(this, dir), ctx = this._chatContexts.get(dir);
   if (ctx?.discussion && this.numberDiscussionResults(ctx, history, await this.discussionIndex(ctx))) await previous.saveHistory.call(this, dir, history);
   return history;
  },
  async saveHistory(dir, history) {
   const ctx = this._chatContexts.get(dir);
   if (ctx?.discussion) this.numberDiscussionResults(ctx, history, await this.discussionIndex(ctx));
   return previous.saveHistory.call(this, dir, history);
  },
  resultReference(chat, message, index) { return "result:" + (message.referenceID || chat.id + "-" + index); },
  quoteDiscussionResult(view, chat, message, index, selectedText = "", result = null) {
   const reference = result ? "result:" + result.id : this.resultReference(chat, message, index);
   const label = result ? this.discussionResultLabel(result) : message.results?.length === 1 ? this.discussionResultLabel(message.results[0]) : "Answer";
   view.root.querySelector(".abstractin-reference-review")?.remove();
   const panel = this.el(view.doc, "div", "abstractin-panel abstractin-reference-review"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Review result citation");
   panel.append(this.el(view.doc, "p", null, label + (result?.title ? " · " + result.title : "") + " — Review the excerpt before inserting."));
   const field = this.el(view.doc, "textarea", "abstractin-input"); field.setAttribute("aria-label", "Quoted result excerpt"); field.value = selectedText || result?.text || message.text;
   const add = this.el(view.doc, "button", "abstractin-btn", "Insert citation"), cancel = this.el(view.doc, "button", "abstractin-btn", "Cancel");
   add.onclick = () => { if (!field.value.trim()) return; view.input.value += (view.input.value ? "\n\n" : "") + "[" + reference + (label !== "Answer" ? "|" + label : "") + "]\n" + field.value.trim().split("\n").map(line => "> " + line).join("\n") + "\n\n"; this.autoGrow(view.input); panel.remove(); this.setBusy(view, this._pending.has(view.ctx.dir)); view.input.focus(); };
   cancel.onclick = () => panel.remove(); panel.append(field, add, cancel); view.root.querySelector(".abstractin-log-wrap").append(panel); field.focus();
  },
  openDiscussionReferences(view, anchor = view.root.querySelector(".abstractin-result-picker"), answer = null, { mode = "quote" } = {}) {
   const state = { index: null, chapter: undefined, chat: null, rows: null, error: "" };
   const focus = menu => menu.querySelector(".abstractin-menu-item:not(:disabled)")?.focus();
   const menu = this.openMenu(view.root, anchor, menu => {
    menu.classList.add("abstractin-result-menu", "abstractin-quick-question-menu");
    if (state.error) { menu.append(this.el(view.doc, "p", "abstractin-menu-note", state.error)); return; }
    if (!state.index) { this.menuSection(view.doc, menu, "Loading results…"); return; }
    if (state.chat) {
     this.menuItem(view.doc, menu, { label: "← Discussions", onSelect: () => { state.chat = null; state.rows = null; menu.refresh(); focus(menu); } });
     this.menuSection(view.doc, menu, this.discussionName(view.ctx, state.chat, state.index));
     if (!state.rows) { menu.append(this.el(view.doc, "p", "abstractin-menu-note", "Loading results…")); return; }
     if (!state.rows.length) menu.append(this.el(view.doc, "p", "abstractin-menu-note", "No saved results in this discussion yet."));
     for (const { message, at, result } of state.rows) {
      const label = result.kind === "Question" ? "Question " + result.number : this.discussionResultLabel(result);
      const excerpt = result.text.replace(/\\(?:begin|end|label)\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
      const item = this.menuItem(view.doc, menu, { label, onSelect: () => { this.closeMenu(view.root); if (mode === "jump") this.jumpToDiscussionContent(view, state.chat, at, result).catch(e => this.appendError(view, e.message || String(e))); else this.quoteDiscussionResult(view, state.chat, message, at, "", result); } });
      item.classList.add("abstractin-result-option"); item.title = label + "\n" + excerpt;
      const entry = this.el(view.doc, "span", "abstractin-result-entry");
      entry.append(this.el(view.doc, "span", "abstractin-result-number", label));
      if (result.title) entry.append(this.el(view.doc, "span", "abstractin-result-title", result.title));
      if (excerpt && !excerpt.startsWith(result.title || "\0")) entry.append(this.el(view.doc, "span", "abstractin-result-summary", excerpt.slice(0, 160)));
      item.replaceChildren(entry);
     }
    } else if (state.chapter !== undefined) {
     this.menuItem(view.doc, menu, { label: "← Chapters", onSelect: () => { state.chapter = undefined; menu.refresh(); focus(menu); } });
     this.menuSection(view.doc, menu, state.index.chapters.find(c => c.id === state.chapter)?.title || (view.ctx.reading.type === "paper" ? "Paper discussions" : "Unassigned"));
     for (const chat of this.visibleDiscussions(state.index).filter(c => c.chapterID === state.chapter).sort((a, b) => a.number - b.number)) {
      const item = this.menuItem(view.doc, menu, { label: "Discussion " + chat.number + " · " + (chat.topic === "discussion" ? "Untitled" : chat.topic), onSelect: () => chooseChat(chat) });
      item.dataset.discussionId = chat.id;
     }
    } else {
     this.menuSection(view.doc, menu, mode === "jump" ? "Jump to · Choose chapter" : "Quote · Choose chapter");
     for (const chapter of [...state.index.chapters.slice().sort((a, b) => a.order - b.order), { id: null, title: view.ctx.reading.type === "paper" ? "Paper discussions" : "Unassigned" }]) {
      if (!this.visibleDiscussions(state.index).some(c => c.chapterID === chapter.id)) continue;
      this.menuItem(view.doc, menu, { label: (chapter.prefix ? chapter.prefix + " · " : "") + chapter.title, onSelect: () => { state.chapter = chapter.id; menu.refresh(); focus(menu); } });
     }
    }
   });
   if (!menu) return;
   const chooseChat = async (chat, onlyAnswer = null) => {
    const request = {}; state.request = request;
    state.chat = chat; state.rows = null; menu.refresh();
    try {
     const history = await this.loadHistory(this.discussionContext(view.ctx, chat).dir);
     const rows = [];
     let turn = 0;
     history.forEach((message, at) => {
      if (message.role === "user") { turn++; if (mode === "jump") rows.push({ message, at, result: { kind: "Question", id: message.referenceID, number: turn, text: message.text } }); }
      if (message.role === "assistant" && (!onlyAnswer || message.referenceID === onlyAnswer.referenceID)) for (const result of message.results || []) rows.push({ message, at, result });
     });
     if (!menu.isConnected || state.chat?.id !== chat.id || state.request !== request) return;
     state.rows = rows; menu.refresh(); focus(menu);
    } catch (e) { if (menu.isConnected) { state.error = e.message || String(e); menu.refresh(); } }
   };
   this.discussionIndex(view.ctx).then(index => {
    if (!menu.isConnected) return;
    state.index = index;
    if (answer) { state.chapter = view.ctx.discussion.chapterID; return chooseChat(view.ctx.discussion, answer); }
    menu.refresh(); focus(menu);
   }).catch(e => { if (menu.isConnected) { state.error = e.message || String(e); menu.refresh(); } });
   return menu;
  },
  async jumpToDiscussionContent(view, chat, at, result) {
   if (this._pending.has(view.ctx.dir)) throw new Error("Wait for the current answer before jumping to another discussion.");
   await this.openManagedDiscussion(view, chat);
   const history = await this.loadHistory(view.ctx.dir);
   at = history.findIndex(message => ["Question", "Answer"].includes(result.kind) ? message.referenceID === result.id : message.results?.some(item => item.id === result.id));
   if (at < 0) throw new Error("This discussion content is no longer available.");
   let target;
   if (result.kind === "Question") target = [...view.logEl.querySelectorAll(".abstractin-user")][history.slice(0, at + 1).filter(message => message.role === "user").length - 1];
   else {
    target = result.kind === "Answer" ? null : [...view.logEl.querySelectorAll("[data-result-reference]")].find(node => node.dataset.resultReference === "result:" + result.id);
    target ||= [...view.logEl.querySelectorAll(".abstractin-turn")][history.slice(0, at + 1).filter(message => message.role === "assistant").length - 1];
   }
   if (!target) throw new Error("This discussion content is no longer available.");
   target.scrollIntoView?.({ block: "center", behavior: "smooth" }); target.classList.add("abstractin-flash");
   view.doc.defaultView.setTimeout(() => target.classList.remove("abstractin-flash"), 1800);
  },
  updateReadingControls(view) {
   previous.updateReadingControls.call(this, view);
   const controls = view.root.querySelector(".abstractin-quote-controls");
   if (controls) controls.hidden = !view.ctx.discussion;
   if (!view.ctx.discussion) return;
   const name = view.root.querySelector(".abstractin-discussion-name");
   if (name) name.title = view.ctx.discussion.topic || "";
   const row = view.root.querySelector(".abstractin-composer-shortcuts");
   if (row && !row.querySelector(".abstractin-result-picker")) {
    const divider = this.el(view.doc, "span", "abstractin-quote-divider"); divider.setAttribute("aria-hidden", "true");
    const button = this.ghostButton(view.doc, "abstractin-result-picker", null, "Quote", () => this.openDiscussionReferences(view, button), { chevron: true });
    button.title = "Quote a numbered result"; button.setAttribute("aria-label", button.title); button.setAttribute("aria-haspopup", "menu");
    const group = this.el(view.doc, "span", "abstractin-quote-controls"); group.append(divider, button); row.append(group);
   }
  },
  linkTheorems(logEl) {
   previous.linkTheorems.call(this, logEl);
   const view = this._views.get(logEl.closest(".abstractin-root"));
   if (!view?.ctx.discussion) return;
   for (const box of logEl.querySelectorAll(".abstractin-env[data-env]")) {
    const num = box.querySelector(":scope > .abstractin-env-head .abstractin-env-num");
    if (!num || box.closest(".abstractin-user")) continue;
    if (box.dataset.resultNumber) { num.textContent = " " + box.dataset.resultNumber; box.dataset.number = box.dataset.resultNumber; }
   }
   this.refreshDiscussionResultLinks(logEl);
  },
  refreshDiscussionResultLinks(logEl) {
   for (const ref of logEl.querySelectorAll(".abstractin-ref-ok")) {
    const box = [...logEl.querySelectorAll(".abstractin-env[data-label]")].find(b => b.dataset.label === ref.dataset.ref);
    if (!box?.dataset.resultNumber) continue;
    const label = "Chat " + this.BOX_ENVS[box.dataset.env] + " " + box.dataset.resultNumber;
    if (!ref.dataset.text) ref.querySelector(".abstractin-ref-text").textContent = label;
    ref.title = label + "\n" + (box.querySelector(".abstractin-env-body")?.textContent || "").slice(0, 220) + "\n\nClick to go there";
   }
  },
  renderMessages(view, history) {
   previous.renderMessages.call(this, view, history); if (!view.ctx.discussion) return;
   const messages = history.map((message, index) => ({ message, index })).filter(row => row.message.role === "assistant");
   [...view.logEl.querySelectorAll(".abstractin-turn")].forEach((turn, at) => {
    const row = messages[at]; if (!row) return;
    const reference = this.resultReference(view.ctx.discussion, row.message, row.index); turn.dataset.resultReference = reference;
    const results = row.message.results || [];
    const boxes = [...turn.querySelectorAll(".abstractin-env[data-env]")].filter(box => box.dataset.env !== "proof");
    let boxAt = 0;
    for (const result of results) {
     if (!result.env) continue;
     const box = boxes[boxAt++]; if (!box) continue;
     const num = box.querySelector(":scope > .abstractin-env-head .abstractin-env-num");
     const kind = box.querySelector(":scope > .abstractin-env-head .abstractin-env-label");
     if (kind) { kind.firstChild.textContent = result.kind; kind.prepend(this.el(view.doc, "span", "abstractin-chat-result-tag", "Chat"), view.doc.createTextNode(" ")); }
     box.classList.add("abstractin-chat-result");
     if (num) num.textContent = " " + result.number;
     box.dataset.number = result.number; box.dataset.resultNumber = result.number; box.dataset.resultReference = "result:" + result.id;
    }
    const catalog = this.el(view.doc, "div", "abstractin-answer-results");
    for (const result of results.filter(r => !r.env)) {
     const label = this.el(view.doc, "span", "abstractin-answer-result", this.discussionResultLabel(result) + (result.title ? " · " + result.title : ""));
     label.dataset.resultReference = "result:" + result.id; catalog.append(label);
    }
    if (catalog.childElementCount) turn.append(catalog);
   });
   this.refreshDiscussionResultLinks(view.logEl);
   this.linkDiscussionReferences(view);
  },
  linkDiscussionReferences(view) {
   const walker = view.doc.createTreeWalker(view.logEl, 4), nodes = [];
   for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement.closest("button, code, pre, math, .abstractin-math") && /\[result:[a-z0-9:-]+(?:\|[^\]\n]+)?\]/.test(node.textContent)) nodes.push(node);
   for (const node of nodes) {
    const fragment = view.doc.createDocumentFragment(); let start = 0;
    for (const match of node.textContent.matchAll(/\[(result:[a-z0-9:-]+)(?:\|([^\]\n]+))?\]/g)) {
     fragment.append(view.doc.createTextNode(node.textContent.slice(start, match.index)));
     const button = this.el(view.doc, "button", "abstractin-result-link", match[2] || "Earlier result"); button.title = match[1];
     button.onclick = () => this.openResultReference(view, match[1]).catch(e => this.appendError(view, e.message)); fragment.append(button); start = match.index + match[0].length;
    }
    fragment.append(view.doc.createTextNode(node.textContent.slice(start))); node.replaceWith(fragment);
   }
  },
  async openResultReference(view, reference) {
   const target = [...view.logEl.querySelectorAll("[data-result-reference]")].find(node => node.dataset.resultReference === reference);
   if (target) { target.scrollIntoView?.({ block: "center" }); target.classList.add("abstractin-flash"); return; }
   const index = await this.discussionIndex(view.ctx);
   for (const chat of index.chats) {
    const history = await this.loadHistory(this.discussionContext(view.ctx, chat).dir);
    const at = history.findIndex((message, i) => message.role === "assistant" && this.resultReference(chat, message, i) === reference);
    for (let i = 0; i < history.length; i++) {
     const result = history[i].results?.find(r => "result:" + r.id === reference);
     if (result) { this.quoteDiscussionResult(view, chat, history[i], i, "", result); return; }
    }
    if (at >= 0) { this.quoteDiscussionResult(view, chat, history[at], at); return; }
   }
   throw new Error("This earlier result is unavailable locally. Its quoted excerpt remains in the conversation.");
  },
  readingPrompt(ctx, selection) {
   return previous.readingPrompt.call(this, ctx, selection) + "\nFor mathematical definitions and theorem-like statements use separate formal environments (theorem, definition, lemma, proposition, corollary) with unique labels; give important displayed equations tags when later referring to them, unless the user explicitly requests another format.\nThe application assigns stable chapter.discussion.turn.result numbers to saved statements; do not invent these conversation numbers or confuse them with book theorem numbers. User-supplied [result:ID|Kind number] quotations (and legacy [result:ID] quotations) are explicitly selected earlier discussion excerpts, not verified book evidence. You may reason from those quoted excerpts only; never retrieve unquoted chats. Preserve their result IDs in citations when reusing a conclusion, identify assumptions, and distinguish prior assistant results from original-source theorems.";
  },
 });
})();
