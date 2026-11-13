"use strict";

// A reading scope can contain many notes. The workspace identity and reading
// conversation belong to the scope; each note retains its stable discussion dir.
Object.assign(AbstractIn, {
 async readingScopeNotes(layout) {
  const finder = new Zotero.Search(); finder.libraryID = layout.note.libraryID;
  finder.addCondition("itemType", "is", "note"); finder.addCondition("tag", "is", "AbstractIn:Markdown");
  const candidates = await Zotero.Items.getAsync(await finder.search());
  if (!candidates.some(note => note?.key === layout.note.key)) candidates.push(layout.note);
  return candidates.map(note => ({ note, data: this.markdownNoteData(note) })).filter(({note,data}) => {
   if (!data || note.libraryID !== layout.note.libraryID) return false;
   if (layout.workspace) return data.workspace?.id === layout.workspace.id;
   return !data.workspace && (data.documents ? data.documents.length === 1 && data.documents[0].key === layout.documents[0]?.key : data.itemKey === layout.documents[0]?.key);
  }).sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0)).map(entry => entry.note);
 },
 async flushReadingNote(state) {
  state.input._composerEditor?.flush?.();
  if (state.revision !== state.savedRevision || state.timer) await state.flush();
  else await state.saveQueue;
 },
 async newReadingNote(layout) {
  if (layout.noteChanging || layout.noteCreating || layout.moving) throw new Error("Wait for the current note or panel change to finish.");
  if (this._pending.has(layout.noteState.chatView?.ctx.dir)) throw new Error("Wait for the note answer or stop it before creating a note.");
  layout.noteCreating = true;
  try {
   await this.flushReadingNote(layout.noteState);
   const notes = await this.readingScopeNotes(layout), titles = new Set(notes.map(note => this.markdownNoteData(note).title));
   let title = "Untitled note", number = 2; while (titles.has(title)) title = "Untitled note " + number++;
   const parent = layout.workspace ? null : await this.resolveNoteDocument(layout.documents[0]);
   if (!layout.workspace && !parent) throw new Error("The note's source document is unavailable.");
   const note = new Zotero.Item("note"); note.libraryID = layout.note.libraryID;
   if (parent) note.parentID = parent.id;
   else note.addToCollection(layout.workspace.collectionID);
   note.addTag("AbstractIn"); note.addTag("AbstractIn:Markdown");
   note.setNote(this.markdownNoteHTML(note, title, "", parent, Date.now(), layout.documents, layout.workspace)); await note.saveTx();
   await this.syncNoteOutLinks(note, layout.documents, title);
   await this.switchReadingNote(layout, note, { creating: true });
   layout.noteState.title.focus(); layout.noteState.title.select();
   return note;
  } finally { layout.noteCreating = false; }
 },
 async switchReadingNote(layout, note, { creating = false } = {}) {
  if (note.key === layout.note.key) return layout.noteState;
  if (layout.noteChanging || layout.moving || layout.noteCreating && !creating) throw new Error("Wait for the current panel or note change to finish.");
  if (this._pending.has(layout.noteState.chatView?.ctx.dir)) throw new Error("Wait for the note answer or stop it before switching notes.");
  const data = this.markdownNoteData(note), key = note.libraryID + ":" + note.key;
  if (!data || note.libraryID !== layout.note.libraryID || note.isEditable?.() === false) throw new Error("This note is unavailable or read-only.");
  const documents = data.documents || [{ key: data.itemKey }];
  if (layout.workspace ? data.workspace?.id !== layout.workspace.id : data.workspace || documents.length !== 1 || documents[0].key !== layout.documents[0]?.key) throw new Error("Choose a note from this document or workspace.");
  const opened = this._markdownNoteWindows.get(key);
  if (opened) { opened.win.focus(); throw new Error("This note is already open in another editor. Close it before switching here."); }
  layout.noteChanging = true;
  try {
   const old = layout.noteState; await this.flushReadingNote(old);
   layout.noteDrafts ||= new Map();
   layout.noteDrafts.set(old.note.key, { text: old.chatView?.input.value || "", start: old.input.selectionStart, end: old.input.selectionEnd });
   this.rememberChatPosition(old.chatView);
   const dir = OS.Path.join(this.getDataDir(), "notes", note.libraryID + "-" + note.key);
   for (const path of [this.getDataDir(), OS.Path.join(this.getDataDir(), "notes"), dir]) await Zotero.File.createDirectoryIfMissingAsync(path);
   const state = { key, note, parent: note.parentID ? await Zotero.Items.getAsync(note.parentID) : null,
    documents: layout.documents, linkedDocuments: data.documents || layout.documents, dir, sourceView: this._views.get(layout.entry.root),
    readingLayout: layout, readingWorkspace: layout.workspace, dockManaged: true, baseHTML: note.getNote(), revision: 0, savedRevision: 0, saveQueue: Promise.resolve() };
   old.transferring = true; old.dispose(); old.transferring = false;
   layout.note = note; layout.noteState = state;
   layout.noteDraft = layout.noteDrafts.get(note.key);
   await this.mountLayoutNote(layout);
   if (layout.workspace) await this.saveReadingWorkspaceManifest(layout);
   return state;
  } catch (error) { this.layoutError(layout, error); throw error; }
  finally { layout.noteChanging = false; }
 },
 mountReadingNoteActions(state, actions, before) {
  const doc = actions.ownerDocument, create = this.el(doc, "button", "abstractin-note-new", "New note"), open = this.el(doc, "button", "abstractin-note-open", "Open note");
  create.type = "button"; open.type = "button";
  actions.insertBefore(create, before); actions.insertBefore(open, before);
  create.onclick = async () => {
   create.disabled = true;
   try { await this.newReadingNote(state.readingLayout); }
   catch (error) { state.status.textContent = error.message || String(error); }
   finally { create.disabled = false; }
  };
  open.onclick = async () => {
   try { await this.flushReadingNote(state); await this.openReadingNotePicker(state, open); }
   catch (error) { state.status.textContent = error.message || String(error); }
  };
 },
 async openReadingNotePicker(state, anchor) {
  if (state.notePicker?.isConnected) { state.closeNotePicker(); return; }
  const doc = anchor.ownerDocument, win = doc.defaultView, picker = this.el(doc, "section", "abstractin-note-picker");
  picker.setAttribute("role", "dialog"); picker.setAttribute("aria-label", "Open a note from this document or workspace");
  const input = this.el(doc, "input"), list = this.el(doc, "div", "abstractin-note-picker-list"), status = this.el(doc, "p", null, "Loading notes…");
  input.placeholder = "Find a note…"; input.setAttribute("aria-label", "Find a note"); picker.append(input, list, status);
  state.editor.append(picker); state.notePicker = picker;
  const rect = anchor.getBoundingClientRect(), width = Math.min(330, win.innerWidth - 24);
  Object.assign(picker.style, { width: width + "px", left: Math.max(12, Math.min(rect.right - width, win.innerWidth - width - 12)) + "px", top: Math.max(12, Math.min(rect.bottom + 5, win.innerHeight - 250)) + "px" });
  const close = () => { picker.remove(); doc.removeEventListener("mousedown", outside, true); doc.removeEventListener("keydown", escape, true); anchor.setAttribute("aria-expanded", "false"); };
  const outside = event => { if (!picker.contains(event.target) && !anchor.contains(event.target)) close(); };
  const escape = event => { if (event.key === "Escape") { event.preventDefault(); close(); anchor.focus(); } };
  state.closeNotePicker = close; (state.sourceDisposers ||= []).push(close);
  anchor.setAttribute("aria-haspopup", "dialog"); anchor.setAttribute("aria-expanded", "true");
  doc.addEventListener("mousedown", outside, true); doc.addEventListener("keydown", escape, true); input.focus();
  try {
   const notes = (await this.readingScopeNotes(state.readingLayout)).map(note => ({ note, title: this.markdownNoteData(note).title || "Untitled note" }));
   if (!picker.isConnected) return;
   const draw = () => {
    list.replaceChildren(); const query = input.value.trim().toLowerCase();
    for (const {note,title} of notes) {
     if (query && !title.toLowerCase().includes(query)) continue;
     const button = this.el(doc, "button", null, title); button.type = "button"; button.dataset.noteKey = note.key; button.disabled = note.key === state.note.key;
     button.onclick = async () => {
      button.disabled = true;
      try { await this.switchReadingNote(state.readingLayout, note); close(); }
      catch (error) { status.textContent = error.message || String(error); button.disabled = false; }
     };
     list.append(button);
    }
    status.textContent = list.children.length ? "" : "No matching notes.";
   };
   input.oninput = draw; draw();
  } catch (error) { status.textContent = error.message || String(error); }
 }
});
