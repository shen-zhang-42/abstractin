"use strict";
(() => {
 const previous = {};
 for (const name of ["ask", "hydrateChatHistory", "saveChatNotes", "noteStorageViews", "saveAsNote"]) previous[name] = AbstractIn[name];
 Object.assign(AbstractIn, {
  _markdownNoteWindows: new Map(),
  _noteOutHomes: new Map(),
  noteDocumentRef(item) { return { id: item.id, key: item.key, libraryID: item.libraryID, title: this.safeField(item, "title") || "Untitled document" }; },
  async resolveNoteDocument(ref) {
   const item = Zotero.Items.getByLibraryAndKey ? Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.key) : await Zotero.Items.getAsync(ref.id);
   return item?.key === ref.key && item.libraryID === ref.libraryID && item.isRegularItem?.() && !item.deleted ? item : null;
  },
  async selectedNoteDocuments(libraryID) {
   const main = Zotero.getMainWindow(), refs = new Map();
   for (let item of main.ZoteroPane?.itemsView?.getSelectedItems?.() || []) {
    if (item.parentID) item = await Zotero.Items.getAsync(item.parentID);
    if (item?.isRegularItem?.() && !item.deleted) {
     if (item.libraryID !== libraryID) throw new Error("Choose documents from the same library as this note.");
     if (item.isEditable?.() === false) throw new Error("A selected document is read-only.");
     refs.set(item.key, this.noteDocumentRef(item));
    }
   }
   return [...refs.values()];
  },
  setNoteDisplayFont(value) {
   if (!["system", "arial", "georgia", "times", "mono", "yahei", "song"].includes(value)) return;
   this.setPref("noteFont", value);
   for (const state of this._markdownNoteWindows.values()) state.input?._refreshMathPreview?.();
  },
  mountNoteDocuments(doc, host, owner, changed, { controls = host, scope = "note" } = {}) {
   const list = this.el(doc, "div", "abstractin-note-documents"); list.dataset.sourceScope = scope;
   const control = this.el(doc, "div", "abstractin-note-source-control"), button = this.el(doc, "button", "abstractin-note-source-button", "Source");
   button.type = "button"; button.dataset.sourceScope = scope; button.setAttribute("aria-expanded", "false");
   button.setAttribute("aria-label", scope === "workspace" ? "Manage editor sources" : "Manage note sources");
   const popup = this.el(doc, "div", "abstractin-note-source-popover"); popup.hidden = true;
   popup.setAttribute("role", "region"); popup.setAttribute("aria-label", scope === "workspace" ? "Editor sources" : "Note sources");
   const search = this.el(doc, "input"); search.placeholder = "Find a document…"; search.setAttribute("aria-label", "Find source documents");
   const results = this.el(doc, "div", "abstractin-note-source-results"), status = this.el(doc, "p"); status.setAttribute("role", "status");
   const add = this.el(doc, "button", null, "Add selected in Zotero"); add.type = "button";
   popup.append(search, results, add, status); control.append(button, popup); controls.append(control); host.append(list);
   let generation = 0, timer;
   const libraryID = () => owner.libraryID ?? owner.note.libraryID;
   const addRefs = refs => {
    const merged = new Map((owner.documents || []).map(ref => [ref.key, ref]));
    for (const ref of refs) if (ref.libraryID === libraryID()) merged.set(ref.key, { ...ref });
    owner.documents = [...merged.values()]; draw(); changed?.();
   };
   const draw = () => {
    list.replaceChildren();
    for (const ref of owner.documents || []) {
     const row = this.el(doc, "div", "abstractin-note-document-ref"), name = this.el(doc, "span", null, ref.title), remove = this.el(doc, "button", null, "×");
     name.title = ref.title; remove.type = "button"; remove.title = "Remove source"; remove.setAttribute("aria-label", "Remove source " + ref.title);
     remove.onclick = () => { owner.documents = owner.documents.filter(item => item.key !== ref.key); draw(); changed?.(); };
     row.append(name, remove); list.append(row);
    }
    list.hidden = !list.children.length;
    for (const candidate of results.querySelectorAll("button")) candidate.disabled = (owner.documents || []).some(ref => ref.key === candidate.dataset.sourceKey);
   };
   const find = async () => {
    const request = ++generation, query = search.value.trim(); status.textContent = "";
    try {
     let refs;
     if (query) {
      const searcher = new Zotero.Search(); searcher.libraryID = libraryID(); searcher.addCondition("title", "contains", query);
      searcher.addCondition("itemType", "isNot", "note"); searcher.addCondition("itemType", "isNot", "attachment");
      const ids = await searcher.search(), items = await Zotero.Items.getAsync(ids.slice(0, 40));
      refs = items.filter(item => item?.isRegularItem?.() && !item.deleted && item.libraryID === libraryID()).map(item => this.noteDocumentRef(item));
     } else {
      refs = [...(owner.documents || []), ...(owner.home?.documents || []), ...await this.selectedNoteDocuments(libraryID())];
     }
     if (request !== generation || popup.hidden) return;
     results.replaceChildren();
     for (const ref of new Map(refs.map(item => [item.key, item])).values()) {
      const candidate = this.el(doc, "button", null, ref.title); candidate.type = "button"; candidate.dataset.sourceKey = ref.key;
      candidate.disabled = (owner.documents || []).some(item => item.key === ref.key);
      candidate.onclick = () => addRefs([ref]); results.append(candidate);
     }
     if (!results.children.length) status.textContent = query ? "No matching documents." : "Search by title or select documents in Zotero.";
    } catch (error) { if (request === generation && !popup.hidden) status.textContent = error.message || String(error); }
   };
   const close = () => { popup.hidden = true; button.setAttribute("aria-expanded", "false"); generation++; doc.defaultView.clearTimeout(timer); };
   button.onclick = () => {
    if (!popup.hidden) { close(); return; }
    const rect = button.getBoundingClientRect(), win = doc.defaultView, width = scope === "workspace" ? 260 : 300;
    popup.style.width = Math.min(width, win.innerWidth - 32) + "px";
    popup.style.left = Math.max(12, Math.min(scope === "workspace" ? rect.left : rect.right - width, win.innerWidth - width - 12)) + "px";
    popup.style.top = (rect.bottom + 6) + "px";
    popup.style.maxHeight = Math.max(120, win.innerHeight - rect.bottom - 24) + "px";
    popup.hidden = false; button.setAttribute("aria-expanded", "true"); search.focus(); find();
   };
   search.oninput = () => { generation++; doc.defaultView.clearTimeout(timer); timer = doc.defaultView.setTimeout(find, 180); };
   add.onclick = async () => {
    try { const refs = await this.selectedNoteDocuments(libraryID()); if (!refs.length) throw new Error("Select documents in Zotero first."); addRefs(refs); await find(); }
    catch (error) { status.textContent = error.message || String(error); }
   };
   const outside = event => { if (!control.contains(event.target)) close(); };
   const blurred = event => { if (event.relatedTarget && !control.contains(event.relatedTarget)) close(); };
   const escape = event => { if (event.key === "Escape" && !popup.hidden) { close(); button.focus(); event.preventDefault(); event.stopPropagation(); } };
   doc.addEventListener("mousedown", outside); control.addEventListener("keydown", escape); control.addEventListener("focusout", blurred);
   (owner.sourceDisposers ||= []).push(() => { close(); doc.removeEventListener("mousedown", outside); control.removeEventListener("keydown", escape); control.removeEventListener("focusout", blurred); });
   draw(); return draw;
  },
  async openNoteOutHome(win = Zotero.getMainWindow(), { parent = null, sourceView = null, documents = null, note = null, create = false } = {}) {
   if (!parent && win.Zotero_Tabs?.selectedType === "reader") {
    const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID), attachment = reader && await Zotero.Items.getAsync(reader.itemID);
    if (attachment?.parentID) parent = await Zotero.Items.getAsync(attachment.parentID);
   }
   if (!parent?.isRegularItem?.()) parent = null;
   const libraryID = note?.libraryID ?? documents?.[0]?.libraryID ?? parent?.libraryID ?? win.ZoteroPane?.getSelectedLibraryIDs?.()[0] ?? Zotero.Libraries.userLibraryID;
   const key = String(libraryID), existing = this._noteOutHomes.get(key);
   if (existing && !existing.win.closed) {
    existing.sourceView = sourceView; existing.parent = parent;
    existing.documents = (documents || (parent ? [this.noteDocumentRef(parent)] : existing.documents)).map(ref => ({ ...ref }));
    existing.updateAssociation?.(); existing.showLinked?.(); existing.refresh?.(); if (existing.sidebar) existing.sidebar.hidden = false;
    const selected = win.ZoteroPane?.itemsView?.getSelectedItems?.() || [], chosen = note || (selected.length === 1 && this.markdownNoteData(selected[0]) ? selected[0] : null);
    if (create || chosen) {
     const options = { note: create ? null : chosen, documents: existing.documents, sourceView };
     if (existing.workspace) await this.openMarkdownNote({ win, home: existing, ...options }); else existing.pendingOpen = options;
    }
    existing.win.focus(); return existing.win;
   }
   let scope = documents || (parent ? [this.noteDocumentRef(parent)] : await this.selectedNoteDocuments(libraryID));
   if (!documents && !parent && !scope.length) {
    const saved = this.getJSONPref("noteWorkspaceSources." + libraryID, []);
    if (Array.isArray(saved)) scope = saved.filter(ref => ref?.libraryID === libraryID && typeof ref.key === "string" && typeof ref.title === "string");
   }
   const home = { key, libraryID, parent, sourceView, documents: scope.map(ref => ({ ...ref })), states: new Map() }; this._noteOutHomes.set(key, home);
   const selected = win.ZoteroPane?.itemsView?.getSelectedItems?.() || [];
   if (create) home.pendingOpen = { documents: home.documents, sourceView };
   else if (note) home.initialNote = note;
   else if (selected.length === 1 && this.markdownNoteData(selected[0])) home.initialNote = selected[0];
   try {
    home.win = win.openDialog((this.resourceURI || "chrome://abstractin/content/") + "note-window.xhtml", "abstractin-noteout-" + libraryID,
     "chrome,dialog=no,titlebar,centerscreen,resizable=yes,width=1250,height=850", { homeKey: key });
    home.win.focus(); return home.win;
   } catch (e) { this._noteOutHomes.delete(key); throw e; }
  },
  async mountNoteOutHome(win, home) {
   home.win = win;
   const doc = win.document, host = doc.getElementById("abstractin-note-root"); host.classList.add("abstractin-note-home", "abstractin-note-home-idle"); doc.title = "NoteOut — notes";
   const sidebar = this.el(doc, "aside", "abstractin-note-list"), head = this.el(doc, "h1", null, "NoteOut");
   const sidebarHead = this.el(doc, "div", "abstractin-note-list-head"); sidebarHead.append(head);
   const association = this.el(doc, "div"); home.documents ||= home.parent ? [this.noteDocumentRef(home.parent)] : [];
   home.updateAssociation = this.mountNoteDocuments(doc, association, home, () => {
    this.setPref("noteWorkspaceSources." + home.libraryID, JSON.stringify(home.documents)); home.draw?.();
   }, { controls: sidebarHead, scope: "workspace" });
   const create = this.el(doc, "button", null, "New note"), refresh = this.el(doc, "button", null, "Refresh");
   create.className = "abstractin-note-primary"; refresh.className = "abstractin-note-refresh";
   const filter = this.el(doc, "input"); filter.placeholder = "Find a note…"; filter.setAttribute("aria-label", "Find a NoteOut note");
   const list = this.el(doc, "div", "abstractin-note-list-items"), status = this.el(doc, "p", "abstractin-note-list-status"); status.setAttribute("role", "status");
   home.showLinked = () => home.draw?.();
   sidebar.append(sidebarHead, association, create, refresh, filter, list, status);
   const workspace = this.el(doc, "div", "abstractin-note-home-workspace"), welcome = this.el(doc, "div", "abstractin-note-document abstractin-note-home-empty");
   const emptyEditor = this.el(doc, "section", "abstractin-note-editor abstractin-note-empty-editor"), emptyChat = this.el(doc, "section", "abstractin-note-chat");
   const welcomeCreate = this.el(doc, "button", "abstractin-note-primary", "+ New note"); welcomeCreate.onclick = () => create.click(); emptyEditor.append(welcomeCreate);
   emptyChat.append(this.el(doc, "div", "abstractin-note-empty-heading", "Discussion")); welcome.append(emptyEditor, emptyChat); workspace.append(welcome);
   host.append(sidebar, workspace); home.workspace = workspace; home.sidebar = sidebar; home.status = status;
   home.sidebarSplitState = { win }; this.installNoteSplitter(home.sidebarSplitState, host, sidebar, workspace, { sidebar: true });
   home.emptySplitState = { win }; this.installNoteSplitter(home.emptySplitState, welcome, emptyEditor, emptyChat);
   home.select = state => {
    for (const entry of home.states.values()) entry.host.hidden = entry !== state;
    welcome.hidden = true; host.classList.remove("abstractin-note-home-idle");
    state.host.hidden = false; home.active = state; sidebar.hidden = false;
    doc.title = "NoteOut — " + state.title.value; state.input.focus();
    for (const button of list.querySelectorAll(".abstractin-note-list-item")) button.setAttribute("aria-pressed", String(button.dataset.noteKey === state.note.key));
   };
   home.showEmpty = () => { home.active = null; welcome.hidden = false; sidebar.hidden = false; host.classList.add("abstractin-note-home-idle"); doc.title = "NoteOut — notes"; };
   let notes = [];
   const draw = () => {
    list.replaceChildren(); const query = filter.value.trim().toLowerCase();
    for (const { note, data } of notes) {
     if (query && !data.title.toLowerCase().includes(query)) continue;
     if (home.documents.length && !home.documents.some(ref => (data.documents || [{ key: data.itemKey }]).some(link => link.key === ref.key))) continue;
     const row = this.el(doc, "div", "abstractin-note-list-row"), button = this.el(doc, "button", "abstractin-note-list-item", data.title || "Untitled note"); button.dataset.noteKey = note.key;
     const detail = this.el(doc, "span", "abstractin-note-list-detail", data.documents?.length > 1 ? data.documents.length + " linked sources" : data.itemKey ? "Document note" : "Independent note"); button.append(detail);
     button.setAttribute("aria-pressed", String(home.active?.note.key === note.key));
     button.onclick = () => this.openMarkdownNote({ win, note, home, sourceView: home.sourceView }).catch(e => { status.textContent = e.message || String(e); });
     const trash = this.el(doc, "button", "abstractin-note-list-trash", "×"); trash.title = "Move to Trash"; trash.setAttribute("aria-label", "Delete " + (data.title || "Untitled note"));
     trash.onclick = event => { event.stopPropagation(); this.confirmTrashListedNote(home, note, row); };
     row.append(button, trash); list.append(row);
    }
    if (!list.children.length) list.append(this.el(doc, "p", null, query ? "No matching notes." : "No notes yet. Click New note."));
   };
   home.draw = draw;
   home.refresh = async () => {
    try {
     const search = new Zotero.Search(); search.libraryID = home.libraryID;
     search.addCondition("itemType", "is", "note"); search.addCondition("tag", "is", "AbstractIn:Markdown");
     const items = await this.loadMarkdownNoteItems(await Zotero.Items.getAsync(await search.search()));
     if (win.closed) return;
     notes = items.map(note => ({ note, data: this.markdownNoteData(note) })).filter(value => value.data)
      .sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0)); draw(); status.textContent = "";
    } catch (e) { if (!win.closed) status.textContent = "Could not load notes: " + (e.message || e); }
   };
   filter.oninput = draw; refresh.onclick = home.refresh;
   create.onclick = async () => {
    create.disabled = true;
    try { await this.openMarkdownNote({ win, documents: home.documents, home, sourceView: home.sourceView }); await home.refresh(); }
    catch (e) { status.textContent = "Could not create a note: " + (e.message || e); }
    finally { create.disabled = false; }
   };
   home.notifier = Zotero.Notifier.registerObserver({ notify: () => { win.clearTimeout(home.timer); home.timer = win.setTimeout(home.refresh, 200); } }, ["item"], "abstractin-noteout-home");
   win.addEventListener("beforeunload", event => {
    if (!this.isHostWindowEvent(event, win)) return;
    if (!home.forceClose) for (const state of home.states.values()) if (!state.forceClose) state.input?._composerEditor?.flush?.();
    if (home.forceClose || ![...home.states.values()].some(s => !s.forceClose && (s.savedRevision !== s.revision || s.timer))) return;
    event.preventDefault(); event.returnValue = "";
    if (home.closing) return; home.closing = true;
    Promise.all([...home.states.values()].filter(s => !s.forceClose).map(s => s.flush())).then(() => { home.forceClose = true; win.close(); })
     .catch(e => { home.closing = false; status.textContent = "Not saved: " + (e.message || e); });
   });
   const unloaded = event => {
    if (!this.isHostWindowEvent(event, win)) return;
    win.removeEventListener("unload", unloaded);
    home.sidebarSplitState.disposeSplitter(); home.emptySplitState.disposeSplitter(); win.clearTimeout(home.timer); home.sourceDisposers?.forEach(dispose => dispose()); Zotero.Notifier.unregisterObserver(home.notifier); this._noteOutHomes.delete(home.key);
   };
   win.addEventListener("unload", unloaded);
   await home.refresh();
   if (home.pendingOpen) { const options = home.pendingOpen; home.pendingOpen = null; await this.openMarkdownNote({ win, home, ...options }); }
   else if (home.initialNote) await this.openMarkdownNote({ win, note: home.initialNote, home, sourceView: home.sourceView });
   else await list.querySelector(".abstractin-note-list-item")?.onclick();
  },
  async loadMarkdownNoteItems(items) {
   const notes = items.filter(item => item?.isNote?.());
   if (notes.length) await Zotero.Items.loadDataTypes?.(notes, ["note", "tags"]);
   return items;
  },
  markdownNoteData(note) {
   if (!note?.isNote?.() || note.deleted || !note.getTags().some(t => t.tag === "AbstractIn:Markdown")) return null;
   const template = this.parseNoteHTML(note.getNote());
   for (const pre of template.content.querySelectorAll("pre")) try {
    const data = JSON.parse(pre.textContent);
    if (data.format === "abstractin-markdown-note-v1" && typeof data.title === "string" && typeof data.markdown === "string") return data;
   } catch (_) {}
   return null;
  },
  markdownNoteHTML(note, title, markdown, parent, updatedAt, documents = parent ? [this.noteDocumentRef(parent)] : [], workspace = null, reviewRanges = []) {
   const doc = Zotero.getMainWindow().document, body = this.el(doc, "div");
   body.append(this.el(doc, "h1", null, title || "Untitled note"));
   const content = this.el(doc, "div"); this.renderMarkdown(doc, content, markdown); body.append(content);
   const data = this.el(doc, "pre", null, JSON.stringify({ format: "abstractin-markdown-note-v1", title, markdown,
    itemKey: parent?.key || null, documents, noteKey: note.key || null, updatedAt, ...(workspace ? { workspace } : {}), ...(reviewRanges.length ? { reviewRanges } : {}) }));
   data.style.display = "none"; data.setAttribute("data-abstractin-markdown", "true"); body.append(data);
   return body.outerHTML;
  },
  async openSelectedMarkdownNote(win) {
   const notes = (win.ZoteroPane?.itemsView?.getSelectedItems() || []).filter(n => n.isNote?.() && !n.deleted);
   await this.loadMarkdownNoteItems(notes);
   if (notes.length !== 1 || !this.markdownNoteData(notes[0])) throw new Error("Select one AbstractIn Markdown note to open. Existing native notes are not converted.");
   return this.openNoteOutHome(win, { note: notes[0] });
  },
  async openMarkdownNote({ win = Zotero.getMainWindow(), parent = null, documents = null, note = null, sourceView = null, home = null } = {}) {
   if (note) await this.loadMarkdownNoteItems([note]);
   if (note && !this.markdownNoteData(note)) throw new Error("This is not an AbstractIn Markdown note.");
   if (!note) {
    const libraryID = parent?.libraryID ?? home?.libraryID ?? documents?.[0]?.libraryID ?? win.ZoteroPane?.getSelectedLibraryIDs?.()[0] ?? Zotero.Libraries.userLibraryID;
    documents ||= parent ? [this.noteDocumentRef(parent)] : [];
    const resolved = [];
    for (const ref of documents) {
     const item = await this.resolveNoteDocument(ref);
     if (!item || item.libraryID !== libraryID || item.isEditable?.() === false) throw new Error("A linked document is unavailable, read-only, or in a different library.");
     resolved.push(item);
    }
    documents = [...new Map(resolved.map(item => [item.key, this.noteDocumentRef(item)])).values()];
    parent = documents.length === 1 ? resolved[0] : null;
    if (Zotero.Libraries.get(libraryID)?.editable === false || parent?.isEditable?.() === false) throw new Error("This library is read-only.");
    note = new Zotero.Item("note"); note.libraryID = libraryID;
    if (parent?.isRegularItem?.()) note.parentID = parent.id;
    note.addTag("AbstractIn"); note.addTag("AbstractIn:Markdown");
    note.setNote(this.markdownNoteHTML(note, "Untitled note", "", parent, Date.now(), documents)); await note.saveTx();
    await this.syncNoteOutLinks(note, documents, "Untitled note");
   }
   if (note.isEditable?.() === false) throw new Error("This note is read-only.");
   const key = note.libraryID + ":" + note.key, existing = this._markdownNoteWindows.get(key);
   if (existing && !existing.win?.closed) { existing.home?.select(existing); existing.win?.focus(); return existing.win; }
   parent = note.parentID ? await Zotero.Items.getAsync(note.parentID) : null;
   const dir = OS.Path.join(this.getDataDir(), "notes", note.libraryID + "-" + note.key);
   await Zotero.File.createDirectoryIfMissingAsync(this.getDataDir());
   await Zotero.File.createDirectoryIfMissingAsync(OS.Path.join(this.getDataDir(), "notes"));
   await Zotero.File.createDirectoryIfMissingAsync(dir);
   const opened = this._markdownNoteWindows.get(key);
   if (opened && !opened.win?.closed) { opened.home?.select(opened); opened.win?.focus(); return opened.win; }
   const data = this.markdownNoteData(note);
   documents = data.documents || (parent ? [this.noteDocumentRef(parent)] : []);
   if (documents.length > 1) await this.syncNoteOutLinks(note, documents, data.title);
   const state = { key, note, parent, documents, linkedDocuments: documents.slice(), dir, sourceView, home, baseHTML: note.getNote(), revision: 0, savedRevision: 0, saveQueue: Promise.resolve() };
   this._markdownNoteWindows.set(key, state);
   try {
    if (home) {
     state.win = home.win; state.host = this.el(home.win.document, "div", "abstractin-note-document"); home.workspace.append(state.host);
     home.states.set(key, state); await this.mountMarkdownNote(home.win, state, state.host); home.select(state); return home.win;
    }
    state.win = win.openDialog((this.resourceURI || "chrome://abstractin/content/") + "note-window.xhtml", "abstractin-note-" + note.key,
     "chrome,dialog=no,titlebar,centerscreen,resizable=yes,width=1150,height=800", { noteKey: key });
    state.win.focus();
    return state.win;
   } catch (e) { if (home) { home.states.delete(key); state.host?.remove(); } this._markdownNoteWindows.delete(key); throw e; }
  },
  syncNoteOutLinks(note, documents, title, previousDocuments = []) {
   // Only the plugin-owned index is rewritten; the canonical Markdown note is never copied.
   const run = (this._noteOutLinkQueue || Promise.resolve()).catch(() => {}).then(async () => {
    const refs = new Map([...previousDocuments, ...documents].map(ref => [ref.key, ref]));
    for (const ref of refs.values()) {
     const parent = await this.resolveNoteDocument(ref); if (!parent || parent.isEditable?.() === false) continue;
     if (typeof parent.loadChildItems === "function") await parent.loadChildItems();
     const children = await this.loadMarkdownNoteItems(await Zotero.Items.getAsync(parent.getNotes()));
     let anchor = children.find(item => this.noteInMetadata(item, parent) === "out-anchor");
     let links = [];
     if (anchor) for (const pre of this.parseNoteHTML(anchor.getNote()).content.querySelectorAll("pre")) try {
      const data = JSON.parse(pre.textContent); if (data.format === "abstractin-noteout-v1") links = Array.isArray(data.sharedNotes) ? data.sharedNotes : [];
     } catch (_) {}
     links = links.filter(link => link.key !== note.key);
     if (documents.length > 1 && documents.some(link => link.key === ref.key)) links.push({ key: note.key, title });
     if (!anchor && !links.length) continue;
     if (!anchor) { anchor = new Zotero.Item("note"); anchor.libraryID = parent.libraryID; anchor.parentID = parent.id; anchor.addTag("AbstractIn"); anchor.addTag("AbstractIn:NoteOut"); }
     const html = this.noteOutIndexHTML(parent, links);
     if (anchor.getNote() !== html) { anchor.setNote(html); await anchor.saveTx(); }
    }
   });
   this._noteOutLinkQueue = run; return run;
  },
  updateNoteSaveButton(state) {
   if (state.saveButton) state.saveButton.dataset.unsaved = String(state.revision !== state.savedRevision);
  },
  noteReplacementReviewRanges(edits, previous = [], source = "") {
   let ranges = previous.map(({ rollback, ...range }) => range);
   let rollback = previous.length ? previous.find(range => Array.isArray(range.rollback))?.rollback.map(patch => ({ ...patch })) || null : [];
   for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    const delta = edit.text.length - (edit.to - edit.from);
    const map = (position, end) => position < edit.from ? position : position > edit.to ? position + delta : edit.from + (end ? edit.text.length : 0);
    if (rollback) {
     // Compose overlapping AI replacements into one inverse of the original text.
     const overlap = rollback.filter(patch => patch.from <= edit.to && patch.to >= edit.from);
     const from = Math.min(edit.from, ...overlap.map(patch => patch.from)), to = Math.max(edit.to, ...overlap.map(patch => patch.to));
     let before = source.slice(from, to), blocked = false;
     for (const patch of [...overlap].sort((a, b) => b.from - a.from)) {
      blocked ||= !!patch.blocked || source.slice(patch.from, patch.to) !== patch.after;
      before = before.slice(0, patch.from - from) + patch.before + before.slice(patch.to - from);
     }
     const after = source.slice(from, edit.from) + edit.text + source.slice(edit.to, to);
     rollback = rollback.filter(patch => !overlap.includes(patch)).map(patch => ({ ...patch, from: map(patch.from, false), to: map(patch.to, true) }));
     rollback.push({ from, to: to + delta, before, after, ...(blocked ? { blocked: true } : {}) });
    }
    ranges = ranges.map(range => ({ ...range, from: map(range.from, false), to: map(range.to, true) }));
    const start = source.lastIndexOf("\n", edit.from - 1) + 1;
    const end = source.indexOf("\n", Math.max(edit.from, edit.to - 1));
    ranges.push({ from: edit.from, to: edit.from + edit.text.length,
     ...(edit.to > edit.from ? { removed: source.slice(start, end < 0 ? source.length : end), oldLine: source.slice(0, start).split("\n").length } : {}) });
    source = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
   }
   ranges.sort((a, b) => a.from - b.from);
   if (ranges.length && rollback) ranges[0].rollback = rollback.sort((a, b) => a.from - b.from);
   return ranges;
  },
  noteReviewCancellation(source, ranges) {
   const rollback = ranges.find(range => Array.isArray(range.rollback))?.rollback;
   if (!rollback?.length) throw new Error("These changes predate Discard changes. Restore them from the saved source backup instead.");
   let end = -1;
   for (const patch of rollback) {
    if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to) || patch.from < 0 || patch.from < end || patch.to < patch.from || patch.to > source.length ||
     typeof patch.before !== "string" || typeof patch.after !== "string" || patch.blocked || source.slice(patch.from, patch.to) !== patch.after) {
     throw new Error("Some changed text was edited manually. Cancel would overwrite it; your note has been kept unchanged.");
    }
    end = patch.to;
   }
   return rollback.map(patch => ({ from: patch.from, to: patch.to, text: patch.before }));
  },
  markdownNoteSnapshot(state, { flush = true } = {}) {
   if (flush) state.input._composerEditor?.flush?.();
   const snapshot = { title: state.title.value || "Untitled note", markdown: state.input.value, documents: (state.documents || (state.parent ? [this.noteDocumentRef(state.parent)] : [])).slice(), workspace: state.readingWorkspace || state.savedWorkspace || null, reviewRanges: (state.input._noteReviewRanges || []).map(range => ({ ...range })), revision: state.revision, updatedAt: Date.now() };
   state.lastSnapshot = snapshot;
   return snapshot;
  },
  saveMarkdownNote(state, snapshot = this.markdownNoteSnapshot(state)) {
   const editor = state.editor;
   const task = state.saveQueue.catch(() => {}).then(async () => {
    // Keep a recoverable source draft even if Zotero rejects a save or detects a conflict.
    await Zotero.File.putContentsAsync(OS.Path.join(state.dir, "draft.json"), JSON.stringify({ ...snapshot, format: "abstractin-note-draft-v1", noteKey: state.note.key }));
    if (state.note.deleted || state.note.isEditable?.() === false) throw new Error("The note is unavailable or read-only. The source draft was kept locally.");
    if (!this.sameMarkdownNoteSource(state.note.getNote(), state.baseHTML)) throw new Error("The note changed outside this editor. Your draft is kept locally; reopen the note to review and recover it.");
    let parent = null;
    for (const ref of snapshot.documents) {
     const item = await this.resolveNoteDocument(ref);
     if (!item || item.libraryID !== state.note.libraryID || item.isEditable?.() === false) throw new Error("A linked document is unavailable or read-only. Your draft was kept locally.");
     if (snapshot.documents.length === 1) parent = item;
    }
    if (snapshot.workspace) parent = null;
    if (!this.sameMarkdownNoteSource(state.note.getNote(), state.baseHTML)) throw new Error("The note changed while saving. Your draft was kept locally; reopen it to review the conflict.");
    state.note.parentID = parent?.id || false;
    state.note.setNote(this.markdownNoteHTML(state.note, snapshot.title, snapshot.markdown, parent, snapshot.updatedAt, snapshot.documents, snapshot.workspace, snapshot.reviewRanges));
    try { await state.note.saveTx(); }
    catch (e) { state.baseHTML = state.note.getNote(); throw e; }
    state.baseHTML = state.note.getNote(); state.parent = parent; state.savedWorkspace = snapshot.workspace;
    state.savedRevision = snapshot.revision;
    let linkWarning = "";
    try { await this.syncNoteOutLinks(state.note, snapshot.documents, snapshot.title, state.linkedDocuments || []); state.linkedDocuments = snapshot.documents; }
    catch (error) { linkWarning = "Saved to Zotero; source links need retry."; this.logError("note source links", error); }
    // The save belongs to the note, not the window that initiated it. A pane
    // can move, close or remount while Zotero is committing the transaction.
    if (state.disposed || state.editor !== editor || !this.readerPanelNodeAlive(editor)) return;
    this.updateNoteSaveButton(state);
    state.saveError && (state.saveError.hidden = true);
    if (state.closeDraftButton) state.closeDraftButton.hidden = true;
    if (!state.dockManaged && state.win?.document && (!state.home || state.home.active === state)) state.win.document.title = (state.home ? "NoteOut — " : "AbstractIn — ") + snapshot.title;
    if (state.status?.isConnected) state.status.textContent = state.savedRevision === state.revision ? linkWarning || "Saved to Zotero" : "Unsaved changes…";
   });
   state.saveQueue = task;
   return task;
  },
  sameMarkdownNoteSource(current, baseline) {
   if (current === baseline) return true;
   const identity = html => {
    for (const pre of this.parseNoteHTML(html).content.querySelectorAll('pre')) try {
     const data = JSON.parse(pre.textContent);
     if (data.format === "abstractin-markdown-note-v1") return JSON.stringify([data.title, data.markdown, data.documents, data.workspace || null, data.reviewRanges || []]);
    } catch (_) {}
    return null;
   };
   const saved = identity(baseline);
   // Zotero may normalize the rendered HTML; the plugin's Markdown source,
   // title and source links are the conflict boundary.
   return saved !== null && identity(current) === saved;
  },
  installNoteSplitter(state, host, editor, chat, { sidebar = false } = {}) {
   const win = state.win, doc = win.document, splitter = this.el(doc, "div", "abstractin-note-splitter");
   splitter.tabIndex = 0; splitter.setAttribute("role", "separator"); splitter.setAttribute("aria-orientation", "vertical"); splitter.setAttribute("aria-label", sidebar ? "Resize note list and workspace" : "Resize editor and discussion");
   if (sidebar) splitter.classList.add("abstractin-note-sidebar-splitter");
   splitter.title = "Drag to resize · Double-click to reset"; editor.after(splitter);
   const preference = sidebar ? "noteSidebarRatio" : "noteEditorRatio", property = sidebar ? "--note-sidebar-ratio" : "--note-editor-ratio", initial = sidebar ? 18 : 58;
   let ratio = Number(this.getPref(preference)) || initial, drag = null, shield = null;
   const apply = value => {
    const width = Math.max(1, host.getBoundingClientRect().width - 8);
    const min = width > 1 ? Math.max(sidebar ? 10 : 20, Math.min(sidebar ? 180 : 260, width * .4) / width * 100) : sidebar ? 10 : 20;
    const max = width > 1 ? Math.min(sidebar ? 40 : 80, 100 - Math.min(sidebar ? 520 : 300, width * .6) / width * 100) : sidebar ? 40 : 80;
    ratio = Math.min(max, Math.max(min, value)); host.style.setProperty(property, String(ratio));
    splitter.setAttribute("aria-valuemin", String(Math.round(min))); splitter.setAttribute("aria-valuemax", String(Math.round(max))); splitter.setAttribute("aria-valuenow", String(Math.round(ratio)));
   };
   const move = event => { if (drag !== event.pointerId) return; const rect = host.getBoundingClientRect(); if (rect.width > 8) apply((event.clientX - rect.left) / (rect.width - 8) * 100); };
   const end = event => {
    if (drag === null || (event?.pointerId !== undefined && event.pointerId !== drag)) return;
    try { if (splitter.hasPointerCapture?.(drag)) splitter.releasePointerCapture(drag); } catch (_) {}
    drag = null; shield?.remove(); shield = null; host.classList.remove("abstractin-note-resizing");
    doc.removeEventListener("pointermove", move, true); doc.removeEventListener("pointerup", end, true); doc.removeEventListener("pointercancel", end, true);
    this.setPref(preference, Math.round(ratio));
   };
   splitter.addEventListener("pointerdown", event => {
    if (event.button !== 0 || chat.hidden || (!sidebar && !state.home && !host.closest(".abstractin-note-home") && win.innerWidth <= 720)) return;
    event.preventDefault(); drag = event.pointerId; splitter.focus();
    try { splitter.setPointerCapture?.(drag); } catch (_) {}
    shield = this.el(doc, "div", "abstractin-note-resize-shield"); doc.body.append(shield); host.classList.add("abstractin-note-resizing");
    doc.addEventListener("pointermove", move, true); doc.addEventListener("pointerup", end, true); doc.addEventListener("pointercancel", end, true);
   });
   splitter.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault(); apply(event.key === "Home" ? initial : ratio + (event.key === "ArrowLeft" ? -2 : 2)); this.setPref(preference, Math.round(ratio));
   });
   splitter.addEventListener("dblclick", () => { apply(initial); this.setPref(preference, Math.round(ratio)); });
   const resized = () => apply(ratio); win.addEventListener("resize", resized); win.addEventListener("blur", end);
   apply(ratio); state.splitter = splitter;
   state.disposeSplitter = () => { end(); win.removeEventListener("resize", resized); win.removeEventListener("blur", end); };
  },
  confirmTrashMarkdownNote(state) {
   if (state.trashPrompt?.isConnected) { state.trashPrompt.querySelector("button").focus(); return; }
   const doc = state.input.ownerDocument, box = this.el(doc, "section", "abstractin-note-trash-confirm");
   box.setAttribute("role", "group"); box.setAttribute("aria-label", "Confirm note deletion");
   box.append(this.el(doc, "p", null, 'Move “' + state.title.value + '” to Zotero Trash?'));
   const confirm = this.el(doc, "button", "abstractin-note-danger", "Move to Trash"), cancel = this.el(doc, "button", null, "Cancel"), status = this.el(doc, "p");
   box.append(confirm, cancel, status); state.preview.before(box); state.trashPrompt = box;
   cancel.onclick = () => box.remove();
   confirm.onclick = async () => {
    confirm.disabled = true; cancel.disabled = true;
    try { await this.trashMarkdownNote(state); }
    catch (e) { status.textContent = e.message || String(e); confirm.disabled = false; cancel.disabled = false; }
   };
   confirm.focus();
  },
  confirmTrashListedNote(home, note, row) {
   if (row.querySelector(".abstractin-note-trash-confirm")) return;
   const data = this.markdownNoteData(note); if (!data) return;
   const doc = home.win.document, box = this.el(doc, "section", "abstractin-note-trash-confirm"); box.setAttribute("role", "group"); box.setAttribute("aria-label", "Confirm note deletion");
   box.append(this.el(doc, "p", null, 'Move “' + data.title + '” to Trash?'));
   const confirm = this.el(doc, "button", "abstractin-note-danger", "Move to Trash"), cancel = this.el(doc, "button", null, "Cancel");
   box.append(confirm, cancel); row.append(box); cancel.onclick = () => box.remove();
   confirm.onclick = async () => {
    confirm.disabled = true; cancel.disabled = true;
    try {
     const state = this._markdownNoteWindows.get(note.libraryID + ":" + note.key);
     const warning = state ? await this.trashMarkdownNote(state) : await this.trashSavedMarkdownNote(note);
     await home.refresh(); if (warning) home.status.textContent = warning;
    } catch (e) { home.status.textContent = e.message || String(e); confirm.disabled = false; cancel.disabled = false; }
   };
   confirm.focus();
  },
  async trashSavedMarkdownNote(note) {
   const data = this.markdownNoteData(note);
   if (!data || note.isEditable?.() === false) throw new Error("This note is unavailable or read-only.");
   note.deleted = true;
   try { await note.saveTx(); } catch (e) { note.deleted = false; throw e; }
   // Trash is reversible; no source, draft or discussion files are removed.
   try { await this.syncNoteOutLinks(note, [], data.title, data.documents || []); return ""; }
   catch (e) { this.logError("note trash links", e); return "The note is in Trash; some source links could not be updated."; }
  },
  async trashMarkdownNote(state) {
   if (state.deleting || !this.markdownNoteData(state.note) || state.note.isEditable?.() === false) throw new Error("This note is unavailable or read-only.");
   state.deleting = true; state.input.disabled = true; state.title.disabled = true; state.editor.inert = true; state.chatHost.inert = true;
   try {
    if (state.chatView) this._pending.get(state.chatView.ctx.dir)?.cancel();
    await state.flush();
    const warning = await this.trashSavedMarkdownNote(state.note);
    state.forceClose = true; state.dispose?.(); this._markdownNoteWindows.delete(state.key);
    if (state.dockManaged) {
     await this.closeReadingLayout(state.readingLayout, { discard: true });
    } else if (state.home) {
     const home = state.home; home.states.delete(state.key); state.host.remove();
     if (home.active === state) { const next = [...home.states.values()][0]; if (next) home.select(next); else home.showEmpty(); }
     await home.refresh(); if (warning && home.status) home.status.textContent = warning;
    } else state.win.close();
    return warning;
   } catch (e) { state.deleting = false; state.input.disabled = false; state.title.disabled = false; state.editor.inert = false; state.chatHost.inert = false; throw e; }
  },
  async mountMarkdownNote(win, state, noteHost = null) {
   state.win = win;
   const doc = win.document, host = noteHost || doc.getElementById("abstractin-note-root"), data = this.markdownNoteData(state.note);
   if (!data) throw new Error("The Markdown source could not be read. The existing note is unchanged.");
   const editor = this.el(doc, "section", "abstractin-note-editor"), title = this.el(doc, "input", "abstractin-note-title");
   title.value = data.title; title.setAttribute("aria-label", "Note title");
   const toolbar = this.el(doc, "div", "abstractin-note-toolbar"), status = this.el(doc, "span", "abstractin-note-status", "Saved to Zotero");
   status.setAttribute("role", "status");
   const save = this.el(doc, "button", null, "Save"), chatToggle = this.el(doc, "button", null, "New chat window");
   save.className = "abstractin-note-save";
   save.title = "Save note"; save.setAttribute("aria-label", "Save note"); save.replaceChildren(this.svgIcon(doc, "noteSave"));
   const closeDraft = this.el(doc, "button", null, "Close keeping local draft"); closeDraft.hidden = true;
   const more = this.el(doc, "details", "abstractin-note-more"), moreLabel = this.el(doc, "summary", null, "···"), moreActions = this.el(doc, "div", "abstractin-note-more-actions");
   moreLabel.setAttribute("aria-label", "Note actions"); moreLabel.title = "Note actions";
   const trash = this.el(doc, "button", "abstractin-note-danger", "Move to Trash…"); trash.onclick = () => this.confirmTrashMarkdownNote(state);
   moreActions.append(chatToggle, trash, closeDraft); more.append(moreLabel, moreActions);
   moreActions.addEventListener("click", event => { if (event.target.closest("button")) more.open = false; });
   toolbar.append(save, more);
   const input = this.el(doc, "textarea", "abstractin-note-source"); input.value = data.markdown; input.placeholder = "Write Markdown and LaTeX here…"; input.setAttribute("aria-label", "Markdown note");
   input._noteReviewRanges = (data.reviewRanges || []).filter(range => Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.to >= range.from && range.to <= input.value.length);
   const editHost = this.el(doc, "div", "abstractin-note-edit-host"); editHost.append(input);
   const preview = this.el(doc, "div", "abstractin-note-preview"); preview.hidden = true;
   const top = this.el(doc, "div", "abstractin-note-topline"), actions = this.el(doc, "div", "abstractin-note-file-actions");
   actions.append(status, save, more); top.append(title, actions);
   const header = this.el(doc, "header", "abstractin-note-editor-head"), notices = this.el(doc, "div", "abstractin-note-notices");
   header.append(top, toolbar); notices.append(preview); editor.append(header, editHost, notices); (state.dockHosts?.editor || host).append(editor);
   const review = this.el(doc, "div", "abstractin-note-review"), confirm = this.el(doc, "button", null, "Confirm changes"), cancel = this.el(doc, "button", "abstractin-note-discard", "Discard changes");
   confirm.type = "button"; confirm.title = "Keep the changes and clear the diff backgrounds";
   cancel.type = "button"; cancel.title = "Undo pending AI changes while keeping other edits";
   const reviewMessage = this.el(doc, "span"), reviewActions = this.el(doc, "div", "abstractin-note-review-actions");
   reviewMessage.setAttribute("role", "status"); reviewActions.append(confirm, cancel);
   review.append(reviewMessage, reviewActions); editor.insertBefore(review, editHost);
   const updateReview = () => { review.hidden = !input._noteReviewRanges.length; reviewMessage.textContent = "Review changes · − removed / + added"; };
   updateReview(); state.reviewButton = confirm; state.cancelReviewButton = cancel;
   Object.assign(state, { title, input, preview, status, editor, saveButton: save, closeDraftButton: closeDraft, savedWorkspace: data.workspace || null });
   this.updateNoteSaveButton(state);
   const saveError = this.el(doc, "div", "abstractin-note-save-error"), saveMessage = this.el(doc, "span"), retrySave = this.el(doc, "button", null, "Retry save");
   saveError.hidden = true; saveError.setAttribute("role", "alert"); retrySave.type = "button"; saveError.append(saveMessage, retrySave); editor.insertBefore(saveError, editHost); state.saveError = saveError;
   const report = e => {
    this.logError("Markdown note", e);
    if (state.disposed || state.editor !== editor || !this.readerPanelNodeAlive(editor)) return;
    status.textContent = "Not saved"; saveMessage.textContent = e.message || String(e); saveError.hidden = false; closeDraft.hidden = false;
   };
   state.reportSaveError = report;
   retrySave.onclick = () => state.flush().catch(report);
   closeDraft.onclick = async () => {
    try {
     await state.saveQueue.catch(() => {});
     await Zotero.File.putContentsAsync(OS.Path.join(state.dir, "draft.json"), JSON.stringify({ format: "abstractin-note-draft-v1", noteKey: state.note.key,
      title: title.value, markdown: input.value, documents: state.documents, reviewRanges: input._noteReviewRanges, updatedAt: Date.now() }));
     state.forceClose = true;
     if (state.dockManaged) await this.closeReadingLayout(state.readingLayout, { discard: true }); else win.close();
    } catch (e) { report(e); }
   };
   const flush = () => {
    try { win.clearTimeout(state.timer); state.timer = null; return this.saveMarkdownNote(state); }
    catch (error) { return Promise.reject(error); }
   };
   state.flush = flush;
   let reviewSource = input.value, reviewRanges = input._noteReviewRanges;
   const change = () => {
    if (!input._composerEditor && reviewRanges === input._noteReviewRanges && reviewSource !== input.value) {
     // Keep cancellation positions usable in the plain-source fallback too.
     let from = 0, oldEnd = reviewSource.length, newEnd = input.value.length;
     while (from < oldEnd && from < newEnd && reviewSource[from] === input.value[from]) from++;
     while (oldEnd > from && newEnd > from && reviewSource[oldEnd - 1] === input.value[newEnd - 1]) { oldEnd--; newEnd--; }
     const map = (position, side) => position < from ? position : position > oldEnd ? position + newEnd - oldEnd : from + (side > 0 ? newEnd - from : 0);
     input._noteReviewRanges = reviewRanges.map(range => ({ ...range, from: map(range.from, -1), to: map(range.to, 1),
      ...(range.rollback ? { rollback: range.rollback.map(patch => {
       const start = map(patch.from, 1), end = map(patch.to, patch.from === patch.to ? 1 : -1);
       return { ...patch, from: start, to: Math.max(start, end) };
      }) } : {}),
     }));
    }
    reviewSource = input.value; reviewRanges = input._noteReviewRanges;
    updateReview();
    state.revision++; status.textContent = "Unsaved changes…"; win.clearTimeout(state.timer);
    this.markdownNoteSnapshot(state, { flush: false });
    this.updateNoteSaveButton(state);
    state.timer = win.setTimeout(() => { state.timer = null; flush().catch(report); }, 800);
   };
   state.documents ||= data.documents || (state.parent ? [this.noteDocumentRef(state.parent)] : []);
   const redrawDocuments = state.dockManaged ? (() => {
    this.mountReadingNoteActions(state, actions, more); return () => {};
   })() : this.mountNoteDocuments(doc, header, state, change, { controls: actions });
   if (!state.dockManaged) {
    actions.insertBefore(actions.querySelector(".abstractin-note-source-control"), more);
    header.insertBefore(header.querySelector(".abstractin-note-documents"), toolbar);
   }
   title.addEventListener("input", change); input.addEventListener("input", change);
   state.disposeEditor = this.installMathComposer(input, { note: true, compactToolbar: !!state.dockManaged, onReviewChange: updateReview,
    onToolbarChange: visible => state.formatButton?.setAttribute("aria-expanded", String(visible)) });
   confirm.onclick = async () => {
    confirm.disabled = cancel.disabled = true;
    let pendingReview;
    try {
     input._composerEditor?.flush?.();
     pendingReview = input._noteReviewRanges.map(range => ({ ...range }));
     input._noteReviewRanges = []; input._composerEditor?.setReviewRanges?.("[]"); updateReview(); change(); await flush();
    } catch (e) {
     if (pendingReview) { input._noteReviewRanges = pendingReview; input._composerEditor?.setReviewRanges?.(JSON.stringify(pendingReview)); updateReview(); }
     state.revision++; this.updateNoteSaveButton(state); report(e);
    }
    finally { confirm.disabled = cancel.disabled = false; }
   };
   cancel.onclick = async () => {
    confirm.disabled = cancel.disabled = true;
    let applied = false;
    try {
     input._composerEditor?.flush?.();
     const source = input.value, edits = this.noteReviewCancellation(source, input._noteReviewRanges);
     if (input._composerEditor) {
      if (!input._composerEditor.applyReplacements(source, JSON.stringify(edits), "[]")) throw new Error("The note changed. Review it and try Discard changes again.");
     } else {
      for (const edit of [...edits].sort((a, b) => b.from - a.from)) input.setRangeText(edit.text, edit.from, edit.to, "preserve");
      input._noteReviewRanges = []; input.dispatchEvent(new win.Event("input", { bubbles: true }));
     }
     applied = true; updateReview(); await flush();
    } catch (e) {
     // A failed save keeps the restored source in the editor and recoverable draft.
     if (applied) report(e); else reviewMessage.textContent = e.message || String(e);
    } finally { confirm.disabled = cancel.disabled = false; }
   };
   save.onclick = () => flush().catch(report);
   const shortcut = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); flush().catch(report); } };
   const scopedShortcut = event => { if (!state.home || state.home.active === state) shortcut(event); };
   win.addEventListener("keydown", scopedShortcut);
   const chat = state.dockHosts?.chat || this.el(doc, "section", "abstractin-note-chat");
   chat.classList.add("abstractin-note-chat"); chat.hidden = true; state.chatHost = chat;
   host.classList.add("abstractin-note-chat-hidden");
   if (state.dockManaged) closeDraft.hidden = true;
   chatToggle.onclick = async () => {
    try { await this.openNewChatWindow({ noteState: state, win }); }
    catch (e) { status.textContent = "Could not open discussion: " + (e.message || e); }
   };
   let draft;
   try { draft = await this.readDiscussionJSON(OS.Path.join(state.dir, "draft.json"), null); }
   catch (e) { status.textContent = "Saved note opened; the local recovery draft could not be read."; this.logError("note recovery draft", e); }
   if (draft?.format === "abstractin-note-draft-v1" && draft.noteKey === state.note.key && draft.updatedAt > (data.updatedAt || 0) &&
    (draft.markdown !== data.markdown || draft.title !== data.title || (Array.isArray(draft.documents) && JSON.stringify(draft.documents) !== JSON.stringify(state.documents)))) {
    const recover = this.el(doc, "button", null, "Recover unsaved draft"); toolbar.append(recover);
    recover.onclick = () => { title.value = draft.title; input.value = draft.markdown; if (Array.isArray(draft.documents)) state.documents = draft.documents; redrawDocuments(); input._refreshMathPreview?.(); input._noteReviewRanges = draft.reviewRanges || []; input._composerEditor?.setReviewRanges?.(JSON.stringify(input._noteReviewRanges)); change(); recover.remove(); };
    status.textContent = "An unsaved local draft is available to recover.";
   }
   state.flush = flush;
   this.markdownNoteSnapshot(state, { flush: false });
   state.beforeUnload = event => {
    if (!this.isHostWindowEvent(event, win)) return;
    if (!state.forceClose) state.input._composerEditor?.flush?.();
    if (state.forceClose || (state.savedRevision === state.revision && !state.timer)) return;
    event.preventDefault(); event.returnValue = "";
    if (!state.closing) { state.closing = true; flush().then(() => { state.forceClose = true; win.close(); }).catch(e => { state.closing = false; report(e); }); }
   };
   if (!state.home && !state.dockManaged) win.addEventListener("beforeunload", state.beforeUnload);
   state.dispose = event => {
    if (event && !this.isHostWindowEvent(event, win)) return;
    if (state.disposed) return; state.disposed = true;
    if (this._markdownNoteWindows.get(state.key) === state) this._markdownNoteWindows.delete(state.key);
    state.sourceDisposers?.splice(0).forEach(dispose => this.cleanupReaderPanelResource(dispose));
    this.cleanupReaderPanelResource(() => {
     win.removeEventListener("unload", state.dispose); win.removeEventListener("beforeunload", state.beforeUnload);
     win.clearTimeout(state.timer); win.clearTimeout(state.previewTimer); win.removeEventListener("keydown", scopedShortcut);
    });
    this.cleanupReaderPanelResource(() => state.disposeEditor?.()); this.cleanupReaderPanelResource(() => state.disposeSplitter?.());
    if (state.chatView) {
     if (!state.transferring) this.cleanupReaderPanelResource(() => this._pending.get(state.chatView.ctx.dir)?.cancel());
     this.cleanupReaderPanelResource(() => state.chatView.root.disposeUI?.());
     this._views.delete(state.chatView.root); if (!state.transferring) this.endNoteSession(state.chatView.ctx.dir);
    }
   };
   if (!state.dockManaged) win.addEventListener("unload", state.dispose);
   if (!state.dockManaged) doc.title = "NoteOut — " + (data.title || "Note"); input.focus();
  },
  async ask(ctx, question, pending) {
   if (!ctx.noteWorkspace) return previous.ask.call(this, ctx, question, pending);
   const state = ctx.noteState;
   state.input._composerEditor?.flush?.();
   const richSelection = state.input._composerEditor?.getSelectionSnapshot?.();
   const selection = richSelection?.markdown || state.input.value.slice(state.input.selectionStart, state.input.selectionEnd);
   try {
    await this.assertAgentReadingReady(pending.backend, "knowledge");
    const history = await this.loadHistory(ctx.dir), sessions = await this.loadSessions(ctx.dir), session = sessions[pending.backend];
    const request = { ctx, files: {}, history, commonChat: true, userQuestion: question, session: session?.model === pending.model ? session : null,
     question: question + (selection.trim() ? "\n<selected-note-text>" + JSON.stringify({ noteKey: state.note.key, text: selection }) + "</selected-note-text>" : ""),
     images: pending.images || [], model: pending.model, effort: pending.effort, summaryOnly: true, onProgress: pending.progress,
     onSpawn: proc => { pending.proc = proc; if (pending.cancelled) proc.kill(); } };
    let result = await this.runBackend(pending.backend, request);
    if (result.resumeFailed && request.session && !pending.cancelled) result = await this.runBackend(pending.backend, { ...request, session: null });
    if (pending.cancelled || result.cancelled) return { cancelled: true };
    if (result.error) return result;
    if (!result.text) return { error: "The model returned no answer." };
    const warning = await this.appendHistory(ctx.dir, [{ role: "user", text: question, ts: Date.now(), ...(selection.trim() ? { noteSelection: selection } : {}) },
     { role: "assistant", text: result.text, ...(result.noteEdits?.length ? { noteEdits: result.noteEdits } : {}), ts: Date.now(), backend: pending.backend, model: pending.model, ...(result.stopped ? { stopped: true } : {}) }]);
    if (result.sessionId) { sessions[pending.backend] = { id: result.sessionId, seen: history.length + 2, model: pending.model }; await this.saveSessions(ctx.dir, sessions); }
    return { ...result, ...(warning ? { historySyncWarning: warning } : {}) };
   } catch (e) { return pending.cancelled ? { cancelled: true } : { error: e.message || String(e) }; }
   finally { this._pending.delete(ctx.dir); }
  },
  hydrateChatHistory(dir, local, exists) { return this._chatContexts.get(dir)?.noteWorkspace ? Promise.resolve(local) : previous.hydrateChatHistory.call(this, dir, local, exists); },
  saveChatNotes(dir, ...args) { return this._chatContexts.get(dir)?.noteWorkspace ? Promise.resolve() : previous.saveChatNotes.call(this, dir, ...args); },
  async saveAsNote(ctx, question, text, ...args) {
   if (!ctx.noteWorkspace) return previous.saveAsNote.call(this, ctx, question, text, ...args);
   const state = ctx.noteState;
   state.input.value += (state.input.value ? "\n\n" : "") + this.readingVisibleText(text);
   state.input._refreshMathPreview?.(); state.input.dispatchEvent(new state.win.Event("input", { bubbles: true }));
   await state.flush();
  },
  noteStorageViews() { return [...new Set([...previous.noteStorageViews.call(this), ...[...this._markdownNoteWindows.values()].map(s => s.chatView).filter(v => v?.root.isConnected)])]; },
  async closeMarkdownNoteWindows() {
   const states = [...this._markdownNoteWindows.values()], homes = [...this._noteOutHomes.values()];
   for (const state of states) {
    try { if (state.flush && (state.revision !== state.savedRevision || state.timer)) await state.flush(); else await state.saveQueue; }
    catch (e) { this.logError("note shutdown save", e); }
    if (state.chatView) this._pending.get(state.chatView.ctx.dir)?.cancel();
    state.forceClose = true;
   }
   for (const home of homes) home.forceClose = true;
   for (const win of new Set([...states.map(s => s.win), ...homes.map(h => h.win)])) if (win && !win.closed) win.close();
   this._markdownNoteWindows.clear();
   this._noteOutHomes.clear();
  },
 });
})();
