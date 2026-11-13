"use strict";

// Layouts own surfaces, not transcripts. Moving a surface never moves or removes
// its saved files. Only adding a second source creates a multi-document scope.
(() => {
 const original = {};
 for (const name of ["openReaderPanel", "releaseReaderPanelView", "openNoteOutHome", "closeMarkdownNoteWindows", "runBackend", "refreshSyncedDiscussionIndex", "refreshDiscussionChapters", "hydrateChatHistory", "saveChatNotes", "noteDocumentKey", "appendHistory", "noteStorageViews", "visibleReaderSelectionView", "activateReading", "saveReadingRecord"]) original[name] = AbstractIn[name];
 const names = { editor: "Note", reading: "Reading discussion", notes: "Note discussion" };
 const leaf = panel => ({ panel });
 const split = (axis, a, b, ratio = .5) => ({ axis, ratio, children: [a, b] });
 const panels = tree => tree ? tree.panel ? [tree.panel] : tree.children.flatMap(panels) : [];
 const without = (tree, id) => {
  if (!tree || tree.panel === id) return null;
  if (tree.panel) return tree;
  const children = tree.children.map(child => without(child, id)).filter(Boolean);
  return children.length === 2 ? { ...tree, children } : children[0] || null;
 };
 const insert = (tree, target, id, edge) => {
  const addition = typeof id === "string" ? leaf(id) : id;
  if (!tree) return addition;
  if (tree.panel === target) {
   const horizontal = ["left", "right"].includes(edge), before = ["left", "top"].includes(edge);
   return split(horizontal ? "x" : "y", before ? addition : tree, before ? tree : addition);
  }
  return tree.panel ? tree : { ...tree, children: tree.children.map(child => insert(child, target, id, edge)) };
 };
 Object.assign(AbstractIn, {
  _readingLayouts: new Map(),
  _readingLayoutReaders: new Map(),
  _readingLayoutSaves: new Set(),
  readingLayoutPanels: panels,
  readingLayoutRemove: without,
  readingLayoutInsert: insert,
  readingLayoutPreset(name) {
   return name === "columns" ? split("x", leaf("reading"), split("x", leaf("editor"), leaf("notes"), .6), .28)
    : split("x", leaf("editor"), split("y", leaf("reading"), leaf("notes")), .52);
  },
  async openNoteOutHome(win, options = {}) {
   const workspaceNote = options.note && this.markdownNoteData(options.note);
   if (workspaceNote?.workspace) {
    const existing = [...this._readingLayouts.values()].find(layout => layout.note.libraryID === options.note.libraryID && layout.workspace?.id === workspaceNote.workspace.id);
    if (existing) { await this.switchReadingNote(existing, options.note); existing.surfaces.get("editor").node.ownerDocument.defaultView.focus(); return existing; }
    const document = await this.resolveNoteDocument(workspaceNote.documents[0]);
    if (!document) throw new Error("The workspace's source document is unavailable.");
    const reader = await this.startLibraryReading(win, document), state = this.readerPanelState(this.readerPanelWindow(reader));
    return this.openReadingLayout(state, state.views.get(reader), reader, options.note);
   }
   const reader = win?.Zotero_Tabs?.selectedType === "reader" && Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
   if (reader && !options.documents && !options.create) {
    await this.openReaderPanel(reader);
    const state = this.readerPanelState(this.readerPanelWindow(reader)), entry = state?.views.get(reader);
    if (entry) return this.openReadingLayout(state, entry, reader, options.note);
   }
   return original.openNoteOutHome.call(this, win, options);
  },
  async openReaderPanel(reader, options = {}) {
   const layout = this._readingLayoutReaders.get(reader.itemID);
   if (layout && !layout.disposed) {
    // A native detached PDF window is another reading surface, not a request to
    // relocate the existing plugin panels or change their source selection.
    if (this.readerPanelWindow(reader).document !== layout.win.document) {
     layout.surfaces.get("reading").node.ownerDocument.defaultView.focus(); return;
    }
    const current = this._views.get(layout.entry.root);
    if (reader.itemID !== layout.reader.itemID && current && this._pending.has(current.ctx.dir)) {
     layout.status.textContent = "The reading discussion stays on its current document until the answer finishes."; return;
    }
    if (options.toggle && layout.panelState.active && layout.reader.itemID === reader.itemID) { this.closeReaderPanel(layout.win); return; }
    const state = layout.panelState;
    state.views.delete(layout.reader); layout.reader = reader; state.views.set(reader, layout.entry);
    state.reader = reader; state.active = true;
    state.panel.hidden = false; state.splitter.hidden = false;
    for (const entry of state.views.values()) entry.body.hidden = entry !== layout.entry;
    state.launcher && (state.launcher.hidden = true);
    if (current?.ctx.attachmentItem?.id !== reader.itemID) await this.refreshLayoutReading(layout);
    this.drawReadingSources(layout);
    this.updateReaderPanelButtons(layout.win); return;
   }
   await original.openReaderPanel.call(this, reader, options);
   const state = this.readerPanelState(this.readerPanelWindow(reader)), entry = state?.views.get(reader);
   if (entry && !entry.layout && !entry.globalToolbar) {
    this.installReadingLayoutStyle(entry.root.ownerDocument, "reading-layout.css");
    const bar = this.el(entry.root.ownerDocument, "header", "abstractin-layout-toolbar abstractin-reading-global-toolbar");
    const label = this.el(entry.root.ownerDocument, "span", "abstractin-layout-name", "AbstractIn");
    const chooser = this.iconButton(entry.root.ownerDocument, "abstractin-layout-choose", "Layout", "patternGrid", () => this.openReadingLayoutMenu(state.win, chooser, { reader: state.reader }));
    bar.append(label, chooser, this.iconButton(entry.root.ownerDocument, "abstractin-global-settings", "Plugin settings", "settings", () => this.openSettings()));
    entry.root.querySelector(".abstractin-open-settings")?.remove();
    entry.body.prepend(bar); entry.globalToolbar = bar;
   }
  },
  async openReadingLayout(panelState, entry, reader, note = null, { restore = true } = {}) {
   if (entry.layout) {
    if (note && note.key !== entry.layout.note.key) await this.switchReadingNote(entry.layout, note);
    return entry.layout;
   }
   if (!this._views.get(entry.root) && entry.render) {
    let ready, failed; const mounted = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
    entry.root._readingLayoutReady = ready; entry.render.then(ready, failed);
    try { await mounted; } finally { delete entry.root._readingLayoutReady; }
   }
   const view = this._views.get(entry.root);
   if (!view) throw new Error("Wait for the document discussion to load.");
   const parent = view.ctx.paperItem, documents = [this.noteDocumentRef(parent)];
   if (!note) {
    if (parent.loadChildItems) await parent.loadChildItems();
    const children = await Zotero.Items.getAsync(parent.getNotes?.() || []);
    note = children.find(item => this.markdownNoteData(item) && !this.markdownNoteData(item).workspace) || null;
    if (!note) {
     const search = new Zotero.Search(); search.libraryID = parent.libraryID;
     search.addCondition("itemType", "is", "note"); search.addCondition("tag", "is", "AbstractIn:Markdown");
     const linked = await Zotero.Items.getAsync(await search.search());
     note = linked.find(item => this.markdownNoteData(item)?.documents?.some(ref => ref.key === parent.key)) || null;
    }
   }
   if (!note) {
    note = new Zotero.Item("note"); note.libraryID = parent.libraryID; note.parentID = parent.id;
    note.addTag("AbstractIn"); note.addTag("AbstractIn:Markdown");
    note.setNote(this.markdownNoteHTML(note, "Untitled note", "", parent, Date.now(), documents)); await note.saveTx();
   }
   const key = note.libraryID + ":" + note.key, old = this._markdownNoteWindows.get(key);
   if (old) { old.win.focus(); throw new Error("This note is already open in NoteOut. Close it before docking it here."); }
   const data = this.markdownNoteData(note);
   if (!data) throw new Error("Choose an AbstractIn Markdown note.");
   if (data.documents?.length && !data.documents.some(ref => ref.key === parent.key)) throw new Error("This note belongs to different source documents.");
   const layout = { id: key, note, parent, documents: data.documents || documents, workspace: data.workspace || null,
    reader, panelState, entry, win: panelState.win, groups: new Map(), surfaces: new Map(), readingContext: view.ctx };
   this._readingLayouts.set(key, layout); entry.layout = layout;
   for (const item of layout.documents) {
    const document = await this.resolveNoteDocument(item), pdf = document && await document.getBestAttachment();
    if (pdf?.isPDFAttachment?.()) this._readingLayoutReaders.set(pdf.id, layout);
   }
   this._readingLayoutReaders.set(reader.itemID, layout);
   const doc = layout.win.document;
   for (const file of ["reading-note.css", "reading-layout.css"]) this.installReadingLayoutStyle(doc, file);
   const shell = this.el(doc, "section", "abstractin-reading-layout"), toolbar = this.el(doc, "header", "abstractin-layout-toolbar");
   entry.globalToolbar?.remove(); delete entry.globalToolbar;
   const title = this.el(doc, "span", "abstractin-layout-mode"); title.setAttribute("role", "img");
   const separator = this.el(doc, "span", "abstractin-layout-separator"); separator.setAttribute("aria-hidden", "true");
   const sources = this.el(doc, "button", "abstractin-layout-sources"); sources.type = "button"; sources.setAttribute("aria-haspopup", "menu");
   sources.onclick = () => this.openReadingSourceMenu(layout);
   const source = this.iconButton(doc, "abstractin-layout-add-source", "Manage sources", "paper", () => this.showReadingSources(layout));
   const chooser = this.iconButton(doc, "abstractin-layout-choose", "Layout", "patternGrid", () => this.openReadingLayoutMenu(layout.win, chooser, { layout }));
   chooser.setAttribute("aria-haspopup", "menu");
   const reset = this.iconButton(doc, "abstractin-layout-reset", "Reset layout", "retry", () => this.applyReadingLayoutPreset(layout, "stacked").catch(error => this.layoutError(layout, error)));
   const exit = this.iconButton(doc, "abstractin-layout-toggle-notes", "Hide notes", "noteNone", () => this.toggleReadingNotes(layout).catch(error => this.layoutError(layout, error)));
   toolbar.append(title, separator, sources, source, chooser, reset, exit, this.iconButton(doc, "abstractin-global-settings", "Plugin settings", "settings", () => this.openSettings()));
   const status = this.el(doc, "div", "abstractin-layout-status"); status.setAttribute("role", "status");
   const host = this.el(doc, "div", "abstractin-dock-host"); shell.append(toolbar, status, host);
   entry.body.append(shell); Object.assign(layout, { shell, toolbar, title, sources, status, noteToggle: exit });
   this.updateReadingNoteToggle(layout);
   layout.showSources = () => { layout.win.focus(); return this.showReadingSources(layout); };
   const saved = this.getJSONPref("readingDockLayout", null);
   const valid = tree => tree && (tree.panel ? Object.hasOwn(names, tree.panel) : ["x", "y"].includes(tree.axis) && tree.children?.length === 2 && tree.children.every(valid));
   const tree = valid(saved) && new Set(panels(saved)).size === 3 && panels(saved).length === 3 ? saved : this.readingLayoutPreset("stacked");
   const savedGroups = this.getJSONPref("readingDockGroups", null);
   const restoreGroups = restore && Array.isArray(savedGroups) && savedGroups.every(group => !group.tree || valid(group.tree)) &&
    savedGroups.filter(group => group.main).length === 1 && savedGroups.flatMap(group => panels(group.tree)).length === 3 &&
    new Set(savedGroups.flatMap(group => panels(group.tree))).size === 3 ? savedGroups : null;
   layout.groups.set("main", { id: "main", win: layout.win, host, tree });
   for (const id of Object.keys(names)) this.createReadingSurface(layout, id, layout.groups.get("main"));
   const reading = layout.surfaces.get("reading"); reading.content.append(entry.root); reading.root = entry.root;
   this.integrateReadingDiscussionHeader(layout, "reading", entry.root);
   const dir = OS.Path.join(this.getDataDir(), "notes", note.libraryID + "-" + note.key);
   for (const path of [this.getDataDir(), OS.Path.join(this.getDataDir(), "notes"), dir]) await Zotero.File.createDirectoryIfMissingAsync(path);
   layout.noteState = { key, note, parent: note.parentID ? parent : null, documents: layout.documents, linkedDocuments: layout.documents.slice(), dir,
    sourceView: view, readingLayout: layout, readingWorkspace: layout.workspace, dockManaged: true, baseHTML: note.getNote(), revision: 0, savedRevision: 0, saveQueue: Promise.resolve() };
   this._markdownNoteWindows.set(key, layout.noteState);
   panelState.panel.classList.add("abstractin-reader-panel-workspace");
   panelState.panel.classList.remove("abstractin-reading-notes-hidden");
   panelState.panel.style.width = (Number(this.getPref("readingWorkspaceWidth")) || 850) + "px";
   await this.mountLayoutNote(layout); this.drawReadingLayout(layout); this.drawReadingSources(layout);
   if (layout.workspace) await this.refreshLayoutReading(layout);
   layout.unload = () => this.disposeReadingLayout(layout);
   layout.win.addEventListener("unload", layout.unload, { once: true });
   if (restoreGroups?.some(group => !group.main)) {
    layout.restoring = true;
    const floating = restoreGroups.filter(group => !group.main && group.tree);
    layout.restoreMain = restoreGroups.find(group => group.main).tree; layout.restoreRemaining = floating.length;
    for (const savedGroup of floating) await this.floatReadingSurface(layout, panels(savedGroup.tree)[0], { tree: savedGroup.tree, bounds: savedGroup.bounds });
   }
   return layout;
  },
  installReadingLayoutStyle(doc, file) {
   // Hot updates leave these links in the native window. Refresh their resource
   // address and order instead of retaining the previous plugin's stylesheet.
   const link = doc.querySelector('link[data-reading-style="' + file + '"]') || this.el(doc, "link");
   const href = (this.resourceURI || "chrome://abstractin/content/") + "content/" + file;
   link.rel = "stylesheet"; if (link.getAttribute("href") !== href) link.href = href; link.dataset.readingStyle = file;
   doc.documentElement.append(link);
   if (file === "reading-note.css") {
    const layoutStyle = doc.querySelector('link[data-reading-style="reading-layout.css"]'); if (layoutStyle) doc.documentElement.append(layoutStyle);
   }
  },
  layoutError(layout, error) { layout.status.textContent = error.message || String(error); this.logError("reading layout", error); },
  openReadingHeaderActions(surface, actions) {
   const root = surface.root, anchor = surface.actions.querySelector(".abstractin-panel-overflow");
   this.openMenu(root, anchor, menu => {
    menu.classList.add("abstractin-panel-header-menu");
    for (const action of actions) {
     if (action.hidden) continue;
     const item = this.el(root.ownerDocument, "button", "abstractin-menu-item", action.getAttribute("aria-label") || action.title);
     item.type = "button"; item.disabled = action.disabled; item.setAttribute("role", "menuitem");
     item.onclick = () => { this.closeMenu(root); action.click(); }; menu.append(item);
    }
   }, { placement: "below", align: "end" });
  },
  readingChoiceButton(doc, select, icon, label) {
   const button = this.iconButton(doc, "abstractin-panel-choice", label, icon, () => {
    if (select._closeMenu) { select._closeMenu(); return; }
    const menu = this.el(doc, "div", "abstractin-panel-choice-menu"); menu.setAttribute("role", "menu");
    const close = () => { menu.remove(); button.setAttribute("aria-expanded", "false"); doc.removeEventListener("mousedown", outside, true); doc.removeEventListener("keydown", keyboard, true); doc.defaultView.removeEventListener("unload", close); delete select._closeMenu; };
    const outside = event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); };
    const keyboard = event => {
     if (event.key === "Escape") { event.preventDefault(); close(); button.focus(); return; }
     if (event.key === "Tab") { close(); return; }
     if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
     event.preventDefault(); const items = [...menu.querySelectorAll("button")], index = items.indexOf(doc.activeElement);
     items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    };
    for (const option of select.options) {
     if (!option.value) continue;
     const item = this.el(doc, "button", null, option.textContent); item.type = "button"; item.setAttribute("role", "menuitemradio"); item.setAttribute("aria-checked", String(option.value === select.value));
     item.onclick = () => { select.value = option.value; select.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true })); close(); button.title = label + (select.selectedOptions[0]?.value ? ": " + select.selectedOptions[0].textContent : ""); };
     menu.append(item);
    }
    (doc.body || doc.documentElement).append(menu);
    const rect = button.getBoundingClientRect();
    Object.assign(menu.style, { left: Math.max(8, Math.min(rect.right - 220, doc.defaultView.innerWidth - 228)) + "px", top: Math.max(8, Math.min(rect.bottom + 4, doc.defaultView.innerHeight - menu.offsetHeight - 8)) + "px" });
    select._closeMenu = close; button.setAttribute("aria-expanded", "true");
    doc.addEventListener("mousedown", outside, true); doc.addEventListener("keydown", keyboard, true); doc.defaultView.addEventListener("unload", close, { once: true }); menu.querySelector("button")?.focus();
   });
   if (select.selectedOptions[0]?.value) button.title = label + ": " + select.selectedOptions[0].textContent;
   button.setAttribute("aria-haspopup", "menu"); select.hidden = true; return button;
  },
  integrateReadingDiscussionHeader(layout, id, root) {
   const surface = layout.surfaces.get(id), header = surface.header, original = root.querySelector(".abstractin-header");
   const actions = [...original.children].filter(node => node.matches("button") && !node.matches(".abstractin-open-settings"));
   surface.destination._closeMenu?.();
   header.classList.add("abstractin-header", "abstractin-panel-toolbar"); surface.label.classList.add("abstractin-header-title");
   surface.actions.replaceChildren(...actions, surface.destination, surface.moveButton);
   if (id === "reading") {
    for (const action of actions) if (!action.matches(".abstractin-history")) action.classList.add("abstractin-panel-secondary");
    const more = this.iconButton(root.ownerDocument, "abstractin-panel-overflow", "More reading actions", "more", () => this.openReadingHeaderActions(surface, actions));
    surface.actions.insertBefore(more, surface.moveButton);
   }
   header.replaceChildren(surface.label, surface.actions);
   if (original !== header) original.remove(); root.prepend(header);
   root.dataset.sharedSources = "true"; root.dataset.readingTheme = "neutral";
  },
  integrateReadingNoteHeader(layout) {
   const surface = layout.surfaces.get("editor"), state = layout.noteState;
   surface.destination._closeMenu?.();
   const formatting = this.iconButton(state.editor.ownerDocument, "abstractin-note-format", "Formatting, font and shortcuts", "edit", () => state.input._composerEditor?.toggleToolbar?.());
   formatting.setAttribute("aria-expanded", "false"); state.formatButton = formatting;
   const outside = event => { if (formatting.getAttribute("aria-expanded") === "true" && !formatting.contains(event.target)) state.input._composerEditor?.toggleToolbar?.(); };
   state.editor.ownerDocument.addEventListener("mousedown", outside, true);
   state.sourceDisposers ||= []; state.sourceDisposers.push(() => state.editor.ownerDocument.removeEventListener("mousedown", outside, true));
   const files = state.editor.querySelector(".abstractin-note-file-actions");
   surface.actions.replaceChildren(formatting, files, surface.destination, surface.moveButton);
   surface.header.classList.add("abstractin-panel-toolbar");
   surface.header.replaceChildren(surface.label, state.title, surface.actions);
   for (const [action, label, kind] of [[formatting, "Formatting, font and shortcuts", "format"], [state.saveButton, "Save note", "save"]]) {
    const item = this.el(state.editor.ownerDocument, "button", "abstractin-note-compact-action", label); item.dataset.command = kind; item.onclick = () => action.click(); files.querySelector(".abstractin-note-more-actions").append(item);
   }
   state.editor.prepend(surface.header);
   state.editor.querySelector(".abstractin-note-topline")?.remove();
  },
  createReadingSurface(layout, id, group) {
   const doc = group.win.document, node = this.el(doc, "section", "abstractin-dock-panel"), header = this.el(doc, "header", "abstractin-dock-header");
   node.dataset.panel = id; header.draggable = true;
   const label = this.el(doc, "span", null, names[id]); header.append(label);
   const destination = this.el(doc, "select"); destination.setAttribute("aria-label", "Move " + names[id]);
   destination.onchange = () => {
    const value = destination.value; destination.value = "";
    (value === "new" ? this.floatReadingSurface(layout, id) : this.moveReadingSurface(layout, id, value, null, "right")).catch(error => this.layoutError(layout, error));
   };
   const moveButton = this.readingChoiceButton(doc, destination, "jumpTo", "Move " + names[id]);
   header.append(destination, moveButton);
   const content = this.el(doc, "div", "abstractin-dock-content"); node.append(header, content); group.host.append(node);
   const actions = this.el(doc, "div", "abstractin-panel-actions");
   const surface = { id, node, content, header, label, actions, destination, moveButton, group: group.id }; layout.surfaces.set(id, surface);
   header.addEventListener("dragstart", event => {
    if (event.target.closest("select,button,input,summary")) { event.preventDefault(); return; }
    this._dragReadingSurface = { layoutID: layout.id, id };
    event.dataTransfer.setData("text/plain", "abstractin-panel:" + layout.id + ":" + id); event.dataTransfer.effectAllowed = "move";
    layout.dropZones = [...layout.surfaces.values()].filter(value => value.id !== id).map(value => {
     const zone = this.el(value.node.ownerDocument, "div", "abstractin-dock-drop-zone"); value.node.append(zone); return zone;
    });
   });
   header.addEventListener("dragend", event => {
    const drag = this._dragReadingSurface, win = doc.defaultView;
    const outside = event.clientX < 0 || event.clientY < 0 || event.clientX > win.innerWidth || event.clientY > win.innerHeight ||
     event.screenX && (event.screenX < win.screenX || event.screenX > win.screenX + win.outerWidth || event.screenY < win.screenY || event.screenY > win.screenY + win.outerHeight);
    if (drag && !drag.accepted && outside) this.floatReadingSurface(layout, id).catch(error => this.layoutError(layout, error));
    this._dragReadingSurface = null; this.clearReadingDropHints(layout); layout.dropZones?.forEach(zone => zone.remove()); layout.dropZones = [];
   });
   node.addEventListener("dragover", event => {
    const drag = this._dragReadingSurface;
    if (!drag || drag.layoutID !== layout.id || drag.id === id) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    this.clearReadingDropHints(layout); node.dataset.dropEdge = this.readingDropEdge(node, event);
   });
   node.addEventListener("dragleave", event => { if (!node.contains(event.relatedTarget)) delete node.dataset.dropEdge; });
   node.addEventListener("drop", event => {
    const drag = this._dragReadingSurface;
    if (!drag || drag.layoutID !== layout.id || drag.id === id) return;
    event.preventDefault(); drag.accepted = true; const edge = this.readingDropEdge(node, event); this.clearReadingDropHints(layout);
    this.moveReadingSurface(layout, drag.id, surface.group, id, edge).catch(error => this.layoutError(layout, error));
   });
   return surface;
  },
  readingDropEdge(node, event) {
   const rect = node.getBoundingClientRect(), x = (event.clientX - rect.left) / Math.max(1, rect.width), y = (event.clientY - rect.top) / Math.max(1, rect.height);
   return [[x, "left"], [1 - x, "right"], [y, "top"], [1 - y, "bottom"]].sort((a, b) => a[0] - b[0])[0][1];
  },
  clearReadingDropHints(layout) { for (const surface of layout.surfaces.values()) delete surface.node.dataset.dropEdge; },
  drawReadingLayout(layout) {
   for (const group of layout.groups.values()) {
    if (!group.host) continue;
    if (group.id !== "main") group.win.document.title = "AbstractIn — " + panels(group.tree).map(id => names[id]).join(" + ");
    for (const dispose of group.splitDisposers || []) dispose(); group.splitDisposers = [];
    group.host.querySelectorAll(".abstractin-dock-divider").forEach(node => node.remove());
    const walk = (tree, box) => {
     if (!tree) return;
     if (tree.panel) {
      const surface = layout.surfaces.get(tree.panel);
      if (surface) Object.assign(surface.node.style, { left: box.x + "%", top: box.y + "%", width: box.w + "%", height: box.h + "%" });
      return;
     }
     const ratio = Math.max(.15, Math.min(.85, Number(tree.ratio) || .5)), horizontal = tree.axis === "x";
     const a = { ...box }, b = { ...box };
     if (horizontal) { a.w *= ratio; b.x += a.w; b.w -= a.w; }
     else { a.h *= ratio; b.y += a.h; b.h -= a.h; }
     walk(tree.children[0], a); walk(tree.children[1], b);
     const divider = this.el(group.win.document, "div", "abstractin-dock-divider"); divider.dataset.axis = tree.axis; divider.tabIndex = 0;
     divider.setAttribute("role", "separator"); divider.setAttribute("aria-label", "Resize panels"); divider.setAttribute("aria-orientation", horizontal ? "vertical" : "horizontal");
     Object.assign(divider.style, { left: (horizontal ? b.x : box.x) + "%", top: (horizontal ? box.y : b.y) + "%", width: horizontal ? "6px" : box.w + "%", height: horizontal ? box.h + "%" : "6px" });
     group.host.append(divider);
     let dragging = false, shield;
     const finish = () => { dragging = false; shield?.remove(); shield = null; group.win.document.removeEventListener("pointermove", move, true); group.win.document.removeEventListener("pointerup", finish, true); group.win.document.removeEventListener("pointercancel", finish, true); if (!layout.disposed) { this.saveReadingDockLayout(layout); this.drawReadingLayout(layout); } };
     const move = event => {
      if (!dragging) return;
      const rect = group.host.getBoundingClientRect();
      const value = horizontal ? ((event.clientX - rect.left) / rect.width * 100 - box.x) / box.w : ((event.clientY - rect.top) / rect.height * 100 - box.y) / box.h;
      tree.ratio = Math.max(.15, Math.min(.85, value));
      // Resize existing nodes without rebuilding editors or their browsing contexts.
      const update = (branch, region) => {
       if (branch.panel) { const node = layout.surfaces.get(branch.panel).node; Object.assign(node.style, { left: region.x + "%", top: region.y + "%", width: region.w + "%", height: region.h + "%" }); return; }
       const r = Math.max(.15, Math.min(.85, branch.ratio || .5)), first = { ...region }, second = { ...region };
       if (branch.axis === "x") { first.w *= r; second.x += first.w; second.w -= first.w; } else { first.h *= r; second.y += first.h; second.h -= first.h; }
       update(branch.children[0], first); update(branch.children[1], second);
      };
      update(tree, box);
      divider.style[horizontal ? "left" : "top"] = ((horizontal ? box.x : box.y) + tree.ratio * (horizontal ? box.w : box.h)) + "%";
     };
     divider.onpointerdown = event => {
      if (event.button !== 0) return; event.preventDefault(); dragging = true;
      shield = this.el(group.win.document, "div", "abstractin-dock-shield"); shield.style.cursor = horizontal ? "col-resize" : "row-resize"; group.host.append(shield);
      group.win.document.addEventListener("pointermove", move, true); group.win.document.addEventListener("pointerup", finish, true); group.win.document.addEventListener("pointercancel", finish, true);
     };
     divider.onkeydown = event => {
      const keys = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
      if (!keys.includes(event.key) && event.key !== "Home") return;
      event.preventDefault(); tree.ratio = event.key === "Home" ? .5 : Math.max(.15, Math.min(.85, ratio + (event.key === keys[0] ? -.03 : .03))); this.saveReadingDockLayout(layout); this.drawReadingLayout(layout);
     };
     group.splitDisposers.push(() => { dragging = false; shield?.remove(); group.win.document.removeEventListener("pointermove", move, true); group.win.document.removeEventListener("pointerup", finish, true); group.win.document.removeEventListener("pointercancel", finish, true); });
    };
    walk(group.tree, { x: 0, y: 0, w: 100, h: 100 });
   }
   for (const surface of layout.surfaces.values()) {
    surface.destination.replaceChildren();
    const option = (value, text) => { const node = this.el(surface.node.ownerDocument, "option", null, text); node.value = value; surface.destination.append(node); };
    option("", "Move…"); option("new", "New window");
    for (const group of layout.groups.values()) if (group.id !== surface.group) option(group.id, group.id === "main" ? "Dock in Zotero" : panels(group.tree).map(id => names[id]).join(" + "));
   }
  },
  saveReadingDockLayout(layout) {
   if (layout.restoring || layout.disposed || layout.bundling || layout.notesHidden || layout.togglingNotes) return;
   const main = layout.groups.get("main");
   if (panels(main.tree).length === 3) this.setPref("readingDockLayout", JSON.stringify(main.tree));
   const groups = [...layout.groups.values()].filter(group => group.id === "main" || group.tree).map(group => ({ main: group.id === "main", tree: group.tree,
    bounds: group.win ? { width: group.win.outerWidth, height: group.win.outerHeight, left: group.win.screenX, top: group.win.screenY } : null }));
   if (groups.flatMap(group => panels(group.tree)).length === 3) this.setPref("readingDockGroups", JSON.stringify(groups));
  },
  showReadingSources(layout, added = []) {
   if (layout.sourceDialog?.isConnected) { layout.sourceDialog.querySelector("input").focus(); return; }
   const doc = layout.win.document, dialog = this.el(doc, "section", "abstractin-layout-source-dialog");
   dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-label", "Reading and note sources");
   const heading = this.el(doc, "strong", null, "Reading and note sources"), search = this.el(doc, "input");
   search.placeholder = "Find a book or paper…"; search.setAttribute("aria-label", "Find documents");
   const list = this.el(doc, "div", "abstractin-layout-source-results"), selected = new Map([...layout.documents, ...added].map(ref => [ref.key, ref]));
   const name = this.el(doc, "input"); name.value = layout.workspace?.name || this.markdownNoteData(layout.note).title; name.setAttribute("aria-label", "Workspace name");
   const collections = this.el(doc, "select"); collections.setAttribute("aria-label", "Parent collection");
   const root = this.el(doc, "option", null, "Library root"); root.value = ""; collections.append(root);
   const walk = (parentID, depth) => {
    const children = parentID ? Zotero.Collections.getByParent(parentID) : Zotero.Collections.getByLibrary(layout.note.libraryID);
    for (const collection of children || []) {
     const option = this.el(doc, "option", null, "  ".repeat(depth) + collection.name); option.value = collection.id; collections.append(option); walk(collection.id, depth + 1);
    }
   };
   walk(null, 0);
   const selectedCollection = layout.win.ZoteroPane?.getSelectedCollection?.(); if (selectedCollection?.libraryID === layout.note.libraryID) collections.value = selectedCollection.id;
   const setup = this.el(doc, "div", "abstractin-layout-workspace-setup"); setup.append(this.el(doc, "label", null, "Workspace name"), name, this.el(doc, "label", null, "Place under collection"), collections);
   const status = this.el(doc, "p"), actions = this.el(doc, "div", "abstractin-layout-dialog-actions"), cancel = this.el(doc, "button", null, "Cancel"), apply = this.el(doc, "button", null, "Apply");
   const picked = this.el(doc, "div", "abstractin-layout-picked-sources");
   const draw = () => {
    picked.replaceChildren();
    for (const ref of selected.values()) {
     const row = this.el(doc, "div"), remove = this.el(doc, "button", null, "Remove");
     remove.disabled = selected.size === 1; remove.onclick = () => { selected.delete(ref.key); draw(); };
     row.append(this.el(doc, "span", null, ref.title), remove); picked.append(row);
    }
    setup.hidden = !!layout.workspace || selected.size < 2;
    apply.textContent = !layout.workspace && selected.size > 1 ? "Create workspace" : "Apply";
   };
   let generation = 0, timer;
   const find = async () => {
    const request = ++generation;
    try {
     const query = search.value.trim();
     let refs;
     if (query) {
      const finder = new Zotero.Search(); finder.libraryID = layout.note.libraryID; finder.addCondition("title", "contains", query);
      finder.addCondition("itemType", "isNot", "note"); finder.addCondition("itemType", "isNot", "attachment");
      refs = (await Zotero.Items.getAsync((await finder.search()).slice(0, 40))).filter(item => item?.isRegularItem?.() && !item.deleted).map(item => this.noteDocumentRef(item));
     } else refs = await this.selectedNoteDocuments(layout.note.libraryID);
     if (request !== generation || !dialog.isConnected) return;
     list.replaceChildren();
     for (const ref of refs) {
      const button = this.el(doc, "button", null, ref.title); button.disabled = selected.has(ref.key);
      button.onclick = () => { selected.set(ref.key, ref); draw(); button.disabled = true; }; list.append(button);
     }
    } catch (error) { status.textContent = error.message || String(error); }
   };
   search.oninput = () => { generation++; layout.win.clearTimeout(timer); timer = layout.win.setTimeout(find, 180); };
   const close = () => { generation++; layout.win.clearTimeout(timer); dialog.remove(); };
   cancel.onclick = close;
   apply.onclick = async () => {
    apply.disabled = true; cancel.disabled = true;
    try {
     await this.updateReadingSources(layout, [...selected.values()], { name: name.value, parentCollectionID: Number(collections.value) || null }); close();
    } catch (error) { status.textContent = error.message || String(error); }
    finally { apply.disabled = false; cancel.disabled = false; }
   };
   dialog.addEventListener("keydown", event => { if (event.key === "Escape" && !apply.disabled) { event.stopPropagation(); close(); } });
   actions.append(cancel, apply); dialog.append(heading, picked, search, list, setup, status, actions); layout.shell.append(dialog); layout.sourceDialog = dialog;
   draw(); find(); search.focus();
  },
  async updateReadingSources(layout, refs, { name, parentCollectionID = null } = {}) {
   layout.readingContext = this._views.get(layout.entry.root)?.ctx || layout.readingContext;
   if (this._pending.has(layout.readingContext.dir) || this._pending.has(layout.noteState.chatView?.ctx.dir)) throw new Error("Wait for both discussions to finish before changing sources.");
   if (layout.noteChanging || layout.noteCreating) throw new Error("Wait for the note change to finish.");
   const relatedNotes = layout.workspace ? await this.readingScopeNotes(layout) : [];
   if (relatedNotes.some(note => note.key !== layout.note.key && this._markdownNoteWindows.has(note.libraryID + ":" + note.key))) throw new Error("Close other notes from this workspace before changing sources.");
   refs = [...new Map(refs.map(ref => [ref.key, ref])).values()];
   if (!refs.length) throw new Error("Keep at least one source.");
   if (!refs.some(ref => ref.key === layout.readingContext.paperItem.key)) throw new Error("Switch to a remaining document before removing the active source.");
   const items = [], attachments = [];
   for (const ref of refs) {
    const item = await this.resolveNoteDocument(ref), pdf = item && await item.getBestAttachment();
    if (!item || item.libraryID !== layout.note.libraryID || item.isEditable?.() === false || !pdf?.isPDFAttachment?.()) throw new Error("Every source must be an editable document with a PDF in this library.");
    items.push(item); attachments.push(pdf);
   }
   if (!layout.workspace && refs.length === 1 && refs[0].key !== layout.documents[0].key) throw new Error("Add the new document alongside the current one to create a workspace.");
   if (parentCollectionID) {
    const parent = Zotero.Collections.get(parentCollectionID);
    if (!parent || parent.libraryID !== layout.note.libraryID || parent.isEditable?.() === false) throw new Error("Choose an editable parent collection in this library.");
   }
   await layout.noteState.flush();
   let workspace = layout.workspace || layout.pendingWorkspace;
   if (!workspace && refs.length > 1) {
    if (!name?.trim()) throw new Error("Enter a workspace name.");
    const collection = new Zotero.Collection(); collection.libraryID = layout.note.libraryID; collection.name = name.trim(); collection.parentID = parentCollectionID || false;
    await collection.saveTx();
    workspace = { id: layout.note.key, name: collection.name, collectionKey: collection.key, collectionID: collection.id };
    const dir = this.readingWorkspaceDir(layout.note.libraryID, workspace.id);
    for (const path of [this.getDataDir(), OS.Path.join(this.getDataDir(), "workspaces"), dir]) await Zotero.File.createDirectoryIfMissingAsync(path);
    const history = await this.loadHistory(layout.readingContext.dir);
    // Copy only this reading conversation, not the document's other chats or
    // large extracted sources. The original transcript remains recoverable.
    await Zotero.File.putContentsAsync(OS.Path.join(dir, "reading-history.json"), JSON.stringify(history));
    workspace.origin = { dir: layout.readingContext.dir, itemKey: layout.readingContext.paperItem.key, attachmentKey: layout.readingContext.attachmentItem.key };
    layout.pendingWorkspace = workspace;
   }
   if (workspace) {
    for (const item of items) { item.addToCollection(workspace.collectionID); await item.saveTx(); }
    for (const ref of layout.documents.filter(ref => !refs.some(value => value.key === ref.key))) {
     const item = await this.resolveNoteDocument(ref); if (item) { item.removeFromCollection(workspace.collectionID); await item.saveTx(); }
    }
    layout.noteState.readingWorkspace = workspace;
   }
   const previousDocuments = layout.documents;
   layout.noteState.documents = refs; layout.noteState.revision++;
   try { await layout.noteState.flush(); }
   catch (error) { layout.noteState.documents = previousDocuments; layout.noteState.readingWorkspace = layout.workspace; throw error; }
   layout.workspace = workspace; layout.documents = refs;
   delete layout.pendingWorkspace;
   if (workspace) {
    layout.note.addToCollection(workspace.collectionID); await layout.note.saveTx(); layout.noteState.baseHTML = layout.note.getNote();
    for (const note of relatedNotes) if (note.key !== layout.note.key) {
     const data = this.markdownNoteData(note);
     note.setNote(this.markdownNoteHTML(note, data.title, data.markdown, null, Date.now(), refs, workspace));
     await note.saveTx(); await this.syncNoteOutLinks(note, refs, data.title, data.documents || []);
    }
    await this.saveReadingWorkspaceManifest(layout);
   }
   for (const [id, value] of this._readingLayoutReaders) if (value === layout) this._readingLayoutReaders.delete(id);
   attachments.forEach(pdf => this._readingLayoutReaders.set(pdf.id, layout));
   this.drawReadingSources(layout); await this.refreshLayoutReading(layout);
   layout.status.textContent = workspace ? "Reading and notes use the same workspace sources." : "Single-document sources saved.";
  },
  readingWorkspaceDir(libraryID, id) { return OS.Path.join(this.getDataDir(), "workspaces", libraryID + "-" + id); },
  async saveReadingWorkspaceManifest(layout) {
   const noteKeys = (await this.readingScopeNotes(layout)).map(note => note.key);
   if (!noteKeys.includes(layout.note.key)) noteKeys.push(layout.note.key);
   await Zotero.File.putContentsAsync(OS.Path.join(this.readingWorkspaceDir(layout.note.libraryID, layout.workspace.id), "workspace.json"), JSON.stringify({ format: "abstractin-reading-workspace-v1", ...layout.workspace, libraryID: layout.note.libraryID, noteKey: layout.workspace.id, activeNoteKey: layout.note.key, noteKeys, documents: layout.documents }, null, 2));
  },
  async readingLayoutContext(ctx, reader) {
   const layout = reader && this._readingLayoutReaders.get(reader.itemID);
   if (!layout?.workspace) return ctx;
   const documentDir = this.readingWorkspaceDir(layout.note.libraryID, layout.workspace.id), initialDir = OS.Path.join(documentDir, "discussions", "reading");
   for (const path of [this.getDataDir(), OS.Path.join(this.getDataDir(), "workspaces"), documentDir, OS.Path.join(documentDir, "discussions"), initialDir]) await Zotero.File.createDirectoryIfMissingAsync(path);
   let index = await this.readDiscussionJSON(OS.Path.join(documentDir, "discussions.json"), null);
   if (!index) {
    let seed = await this.readDiscussionJSON(OS.Path.join(documentDir, "reading-history.json"), []);
    const search = new Zotero.Search(); search.libraryID = ctx.paperItem.libraryID;
    search.addCondition("tag", "is", "AbstractIn:Workspace:" + layout.workspace.id);
    const synced = [];
    for (const note of await Zotero.Items.getAsync(await search.search())) {
     if (!note?.isNote?.() || note.deleted) continue;
     for (const pre of this.parseNoteHTML(note.getNote()).content.querySelectorAll("pre")) try {
      const data = JSON.parse(pre.textContent);
      if (data.format === "abstractin-workspace-chat-v1" && data.workspaceID === layout.workspace.id && /^[a-z0-9-]+$/.test(data.discussion?.id) && Array.isArray(data.history)) synced.push(data);
     } catch (_) {}
    }
    if (synced.length) {
     synced.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
     for (const data of synced) {
      const path = OS.Path.join(documentDir, "discussions", data.discussion.id); await Zotero.File.createDirectoryIfMissingAsync(path);
      await Zotero.File.putContentsAsync(OS.Path.join(path, "chat.json"), JSON.stringify(data.history));
     }
     index = { version: 2, active: synced[0].discussion.id, chapters: [], chats: synced.map(data => data.discussion), migrated: {} };
     seed = synced.find(data => data.discussion.id === "reading")?.history || seed;
    }
    await Zotero.File.putContentsAsync(OS.Path.join(initialDir, "chat.json"), JSON.stringify(seed));
    index ||= { version: 2, active: "reading", chapters: [], chats: [{ id: "reading", topic: layout.workspace.name, number: 1, chapterID: null, createdAt: Date.now(), updatedAt: Date.now() }], migrated: {} };
    await Zotero.File.putContentsAsync(OS.Path.join(documentDir, "discussions.json"), JSON.stringify(index));
   }
   const base = { ...ctx, documentDir, dir: documentDir, readingWorkspace: layout.workspace, workspaceNote: layout.note, workspaceDocuments: layout.documents,
    reading: { ...(ctx.reading || { type: this.readingType(ctx.paperItem) || "paper", title: this.safeField(ctx.paperItem, "title"), goal: "" }) } };
   return this.discussionContext(base, index.chats.find(chat => chat.id === index.active) || index.chats[0]);
  },
  refreshSyncedDiscussionIndex(ctx, index) { return ctx.readingWorkspace ? Promise.resolve() : original.refreshSyncedDiscussionIndex.call(this, ctx, index); },
  refreshDiscussionChapters(ctx, index) { return ctx.readingWorkspace ? Promise.resolve() : original.refreshDiscussionChapters.call(this, ctx, index); },
  async activateReading(view, attachment, options) {
   await original.activateReading.call(this, view, attachment, options);
   const layout = this._readingLayoutReaders.get(attachment.id);
   if (layout?.workspace) {
    view.ctx = await this.readingLayoutContext(view.ctx, layout.reader); layout.readingContext = view.ctx;
    this.renderMessages(view, await this.loadHistory(view.ctx.dir)); this.updateReadingControls(view);
   }
  },
  async saveReadingRecord(ctx, ...args) {
   const key = await original.saveReadingRecord.call(this, ctx, ...args);
   if (key && ctx.readingWorkspace) {
    const note = Zotero.Items.getByLibraryAndKey(ctx.paperItem.libraryID, key);
    if (note) { note.parentID = false; note.addTag("AbstractIn:Workspace:" + ctx.readingWorkspace.id); note.addToCollection(ctx.readingWorkspace.collectionID); await note.saveTx(); }
   }
   return key;
  },
  hydrateChatHistory(dir, local, exists) { return this._chatContexts.get(dir)?.readingWorkspace ? Promise.resolve(local) : original.hydrateChatHistory.call(this, dir, local, exists); },
  async saveChatNotes(dir, history, ...args) {
   const ctx = this._chatContexts.get(dir);
   if (!ctx?.readingWorkspace) return original.saveChatNotes.call(this, dir, history, ...args);
   // Multi-document conversations must never be written under the currently
   // visible document. Keep a standalone, synced transcript in their collection.
   const workspace = ctx.readingWorkspace;
   const search = new Zotero.Search(); search.libraryID = ctx.paperItem.libraryID;
   search.addCondition("tag", "is", "AbstractIn:Workspace:" + workspace.id);
   const notes = await Zotero.Items.getAsync(await search.search());
   const tag = "AbstractIn:Chat:" + (ctx.discussion?.id || "reading");
   let note = notes.find(item => item.isNote?.() && !item.deleted && item.getTags().some(value => value.tag === tag));
   if (!note) { note = new Zotero.Item("note"); note.libraryID = ctx.paperItem.libraryID; note.addTag("AbstractIn:Workspace:" + workspace.id); note.addTag(tag); }
   const doc = Zotero.getMainWindow().document, body = this.el(doc, "div"); body.append(this.el(doc, "h1", null, workspace.name + " — Reading discussion"));
   for (const message of history) { const section = this.el(doc, "section"); section.append(this.el(doc, "strong", null, message.role)); const text = this.el(doc, "div"); this.renderMarkdown(doc, text, message.text); section.append(text); body.append(section); }
   const data = this.el(doc, "pre", null, JSON.stringify({ format: "abstractin-workspace-chat-v1", workspaceID: workspace.id, discussion: ctx.discussion, documents: ctx.workspaceDocuments, history, updatedAt: Date.now() })); data.style.display = "none"; body.append(data);
   note.setNote(body.outerHTML); note.addToCollection(workspace.collectionID); await note.saveTx();
  },
  noteDocumentKey(target) {
   const ctx = typeof target === "string" ? this._chatContexts.get(target) : target;
   return ctx?.readingWorkspace ? ctx.paperItem.libraryID + ":workspace:" + ctx.readingWorkspace.id : original.noteDocumentKey.call(this, target);
  },
  runBackend(backend, request) {
   const ctx = request.ctx, state = ctx?.noteState;
   const documents = ctx?.workspaceDocuments || state?.readingLayout?.documents;
   if (documents?.length) request = { ...request, question: request.question + "\n\n<reading-scope>" + JSON.stringify({
    documents, activeDocument: ctx.noteWorkspace ? null : ctx.paperItem.key,
    instruction: "These documents are the shared reading and note sources. Titles are not source evidence. Only the active document's supplied excerpts have been read; do not claim access to the other documents without retrieving their evidence. Reading and note conversations are separate; no other conversation history is automatically included."
   }) + "</reading-scope>" };
   return original.runBackend.call(this, backend, request);
  },
  appendHistory(dir, entries, ...args) {
   const ctx = this._chatContexts.get(dir);
   if (ctx?.readingWorkspace) entries = entries.map(message => ({ ...message, readingScope: {
    workspaceID: ctx.readingWorkspace.id, activeDocument: ctx.paperItem.key, documents: (ctx.workspaceDocuments || []).map(ref => ref.key)
   } }));
   return original.appendHistory.call(this, dir, entries, ...args);
  },
  noteStorageViews() {
   return [...new Set([...original.noteStorageViews.call(this), ...[...this._readingLayouts.values()].flatMap(layout => [this._views.get(layout.entry.root), layout.noteState?.chatView]).filter(Boolean)])];
  },
  visibleReaderSelectionView(reader) {
   const layout = this._readingLayoutReaders.get(reader.itemID), view = layout && this._views.get(layout.entry.root);
   return view?.ctx.attachmentItem?.id === reader.itemID && this.readerPanelNodeAlive(view.root) ? view : original.visibleReaderSelectionView.call(this, reader);
  },
  async mountLayoutNote(layout) {
   const state = layout.noteState, editor = layout.surfaces.get("editor"), chat = layout.surfaces.get("notes");
   state.dockHosts = { editor: editor.content, chat: chat.content }; state.disposed = false; state.forceClose = false; state.chatView = null;
   editor.content.replaceChildren(); chat.content.replaceChildren();
   this._markdownNoteWindows.set(state.key, state);
   await this.mountMarkdownNote(editor.node.ownerDocument.defaultView, state, editor.content);
   this.integrateReadingNoteHeader(layout);
   if (layout.noteDraft && state.chatView) {
    state.chatView.input.value = layout.noteDraft.text; this.autoGrow(state.chatView.input);
    state.chatView.input.dispatchEvent(new state.chatView.doc.defaultView.Event("input", { bubbles: true }));
    state.input.setSelectionRange(layout.noteDraft.start, layout.noteDraft.end);
    delete layout.noteDraft;
   }
  },
  async refreshLayoutReading(layout) {
   const surface = layout.surfaces.get("reading"), doc = surface.node.ownerDocument;
   const oldRoot = layout.entry.root, oldView = this._views.get(oldRoot), draft = oldView?.input.value || "";
   if (oldRoot) { this.rememberChatPosition(oldView); oldRoot.disposeUI?.(); this._views.delete(oldRoot); oldRoot.remove(); }
   surface.content.replaceChildren(); this.renderSkeleton(doc, surface.content);
   const root = surface.content.querySelector(".abstractin-root"); layout.entry.root = root; surface.root = root;
   this.integrateReadingDiscussionHeader(layout, "reading", root);
   const item = Zotero.Items.get(layout.reader.itemID);
   // renderContent may remain pending for the entire streamed answer. Resolve
   // the move as soon as its replacement view is registered, not after the AI.
   let ready, failed;
   const mounted = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
   root._readingLayoutReady = ready;
   layout.entry.render = this.renderContent(doc, surface.content, item, layout.reader);
   layout.entry.render.then(() => ready(this._views.get(root)), failed);
   let view;
   try { view = await mounted; } finally { delete root._readingLayoutReady; }
   if (view) { view.input.value = draft; this.autoGrow(view.input); layout.readingContext = view.ctx; layout.noteState.sourceView = view; }
  },
  async moveReadingNoteGroup(layout, groupID, target, edge = "right") {
   if (["editor", "notes"].includes(target)) return;
   const editor = layout.surfaces.get("editor"), notes = layout.surfaces.get("notes"), group = layout.groups.get(groupID);
   if (!group?.host) throw new Error("The destination window is still opening.");
   const source = layout.groups.get(editor.group);
   const bundle = editor.group === notes.group ? without(source.tree, "reading") : split("x", leaf("editor"), leaf("notes"));
   target ||= panels(group.tree).find(id => id === "reading");
   layout.bundling = true;
   try {
    for (const id of ["editor", "notes"]) await this.moveReadingSurface(layout, id, groupID, target, edge, { single: true });
    const remainder = without(without(group.tree, "editor"), "notes");
    group.tree = insert(remainder, target, bundle || split("x", leaf("editor"), leaf("notes")), edge);
    this.drawReadingLayout(layout);
   } finally { layout.bundling = false; this.saveReadingDockLayout(layout); }
  },
  async moveReadingSurface(layout, id, groupID, target, edge = "right", { single = false } = {}) {
   if (!single && ["editor", "notes"].includes(id)) return this.moveReadingNoteGroup(layout, groupID, target, edge);
   if (layout.moving) throw new Error("Wait for the previous panel move to finish.");
   const surface = layout.surfaces.get(id), source = layout.groups.get(surface.group), group = layout.groups.get(groupID);
   surface.destination._closeMenu?.();
   if (!group?.host) throw new Error("The destination window is still opening.");
   if (target === id) return;
   layout.moving = true;
   try {
    const crossWindow = group.win.document !== surface.node.ownerDocument;
    if (crossWindow && id !== "reading") {
     if (layout.noteState.revision !== layout.noteState.savedRevision || layout.noteState.timer) await layout.noteState.flush();
     else await layout.noteState.saveQueue;
     layout.noteDraft = { text: layout.noteState.chatView?.input.value || "", start: layout.noteState.input.selectionStart, end: layout.noteState.input.selectionEnd };
     layout.noteState.transferring = true; layout.noteState.dispose();
    }
    source.tree = without(source.tree, id);
    if (source === group) group.tree = source.tree;
    target ||= panels(group.tree)[0]; group.tree = target ? insert(group.tree, target, id, edge) : leaf(id);
    if (crossWindow) {
     if (id === "reading") { surface.root?.disposeUI?.(); }
     surface.node.remove(); this.createReadingSurface(layout, id, group);
     if (id === "reading") await this.refreshLayoutReading(layout);
     else { await this.mountLayoutNote(layout); layout.noteState.transferring = false; }
    } else { surface.group = groupID; if (surface.node.parentElement !== group.host) group.host.append(surface.node); }
    this.drawReadingLayout(layout); this.saveReadingDockLayout(layout);
    if (!source.tree && source.id !== "main") { source.allowClose = true; source.win.close(); layout.groups.delete(source.id); this.drawReadingLayout(layout); }
   } finally { layout.moving = false; }
  },
  async floatReadingSurface(layout, id, { tree = null, bounds = null } = {}) {
   const restoreRequested = !!tree;
   if (["editor", "notes"].includes(id)) {
    id = "editor";
    tree ||= split("x", leaf("editor"), leaf("notes"), .6);
   }
   const groupID = this.chatSyncID();
   const group = { id: groupID, tree: null, pendingPanel: id, restoreTree: tree, restoreRequested, bounds }; layout.groups.set(groupID, group);
   try { group.win = layout.win.openDialog((this.resourceURI || "chrome://abstractin/content/") + "reading-window.xhtml", "abstractin-panel-" + groupID,
    "chrome,dialog=no,titlebar,centerscreen,resizable=yes,width=780,height=850", { layoutID: layout.id, groupID }); }
   catch (error) { layout.groups.delete(groupID); throw error; }
  },
  async mountReadingGroup(layout, groupID, win) {
   const previous = layout.mountQueue || Promise.resolve();
   let finish; layout.mountQueue = new Promise(resolve => { finish = resolve; });
   await previous;
   try { return await this.mountReadingGroupNow(layout, groupID, win); }
   finally { finish(); }
  },
  async mountReadingGroupNow(layout, groupID, win) {
   const group = layout.groups.get(groupID); if (!group) return;
   group.win = win; group.host = win.document.getElementById("abstractin-floating-root"); group.host.classList.add("abstractin-dock-host");
   win.document.title = "AbstractIn — " + names[group.pendingPanel];
   const beforeClose = event => {
    if (event.target !== win && event.target !== win.document) return;
    if (group.allowClose || layout.disposed) return;
    event.preventDefault();
    if (group.returning) return; group.returning = true;
    (async () => {
     while (layout.moving) await new Promise(resolve => win.setTimeout(resolve, 20));
     const returning = panels(group.tree), hadNotes = returning.some(id => ["editor", "notes"].includes(id));
     if (hadNotes) { await this.toggleReadingNotes(layout, false); return; }
     for (const id of returning) if (layout.surfaces.get(id).group !== "main") await this.moveReadingSurface(layout, id, "main");
    })()
     .catch(error => this.layoutError(layout, error)).finally(() => { group.returning = false; });
   };
   // Chrome close events are cancelable without opening the browser's modal
   // beforeunload confirmation. Handle the native close button and window.close.
   win.addEventListener("close", beforeClose); win.addEventListener("DOMWindowClose", beforeClose);
   while (layout.moving) await new Promise(resolve => win.setTimeout(resolve, 20));
   await this.moveReadingSurface(layout, group.pendingPanel, groupID, null, "right", { single: true }); delete group.pendingPanel;
   if (group.restoreTree) {
    for (const id of panels(group.restoreTree)) if (layout.surfaces.get(id).group !== groupID) await this.moveReadingSurface(layout, id, groupID, null, "right", { single: true });
    group.tree = group.restoreTree; delete group.restoreTree;
    if (group.bounds) { win.resizeTo(Math.max(350, group.bounds.width || 780), Math.max(300, group.bounds.height || 850)); }
    if (Number.isFinite(group.bounds?.left) && Number.isFinite(group.bounds?.top)) win.moveTo(group.bounds.left, group.bounds.top);
    if (group.restoreRequested && layout.restoring) {
     layout.restoreRemaining--;
     if (!layout.restoreRemaining) { layout.groups.get("main").tree = layout.restoreMain; layout.restoring = false; }
    }
    this.drawReadingLayout(layout); this.saveReadingDockLayout(layout);
   }
   const resized = () => this.saveReadingDockLayout(layout); win.addEventListener("resize", resized);
   win.addEventListener("unload", () => { win.removeEventListener("resize", resized); group.splitDisposers?.forEach(dispose => dispose()); }, { once: true });
  },
  async applyReadingLayoutPreset(layout, name) {
   if (name === "reading") return this.toggleReadingNotes(layout, false);
   layout.notesHidden = false; this.updateReadingNoteToggle(layout);
   for (const id of Object.keys(names)) if (layout.surfaces.get(id).group !== "main") await this.moveReadingSurface(layout, id, "main");
   const main = layout.groups.get("main"); main.tree = this.readingLayoutPreset(name);
   for (const surface of layout.surfaces.values()) surface.node.hidden = false;
   layout.panelState.panel.classList.remove("abstractin-reading-notes-hidden");
   layout.panelState.panel.style.width = (Number(this.getPref("readingWorkspaceWidth")) || 850) + "px";
   if (name === "separate") {
    await this.floatReadingSurface(layout, "editor");
   }
   this.drawReadingLayout(layout); this.saveReadingDockLayout(layout);
  },
  updateReadingNoteToggle(layout) {
   const button = layout.noteToggle, label = layout.notesHidden ? "Show notes" : "Hide notes";
   if (!button) return;
   button.title = label; button.setAttribute("aria-label", label); button.setAttribute("aria-pressed", String(!layout.notesHidden));
   button.replaceChildren(this.svgIcon(button.ownerDocument, layout.notesHidden ? "noteFull" : "noteNone"));
  },
  async toggleReadingNotes(layout, show = !!layout.notesHidden) {
   if (layout.togglingNotes || show === !layout.notesHidden) return;
   if (layout.restoring || layout.moving || [...layout.groups.values()].some(group => !group.host)) throw new Error("Wait for the panel layout to finish opening.");
   layout.togglingNotes = true; layout.noteToggle.disabled = true;
   try {
    if (!show) {
     this.saveReadingDockLayoutSnapshot(layout);
     // Reuse the normal transfer path, retaining dirty notes and unsent drafts.
     for (const id of ["editor", "notes"]) if (layout.surfaces.get(id).group !== "main") await this.moveReadingSurface(layout, id, "main");
     for (const group of layout.groups.values()) group.tree = without(without(group.tree, "editor"), "notes");
     layout.notesHidden = true;
    } else {
     const snapshot = layout.hiddenNoteLayout;
     for (const id of Object.keys(names)) if (layout.surfaces.get(id).group !== "main") await this.moveReadingSurface(layout, id, "main");
     layout.notesHidden = false;
     layout.groups.get("main").tree = snapshot?.groups.find(group => group.main)?.tree || this.readingLayoutPreset("stacked");
     const floating = snapshot?.groups.filter(group => !group.main && group.tree) || [];
     if (floating.length) {
      layout.restoring = true; layout.restoreMain = layout.groups.get("main").tree; layout.restoreRemaining = floating.length;
      // All panels need a temporary home until the floating documents mount.
      layout.groups.get("main").tree = this.readingLayoutPreset("stacked");
      for (const group of floating) await this.floatReadingSurface(layout, panels(group.tree)[0], { tree: group.tree, bounds: group.bounds });
     }
    }
    for (const surface of layout.surfaces.values()) surface.node.hidden = !!layout.notesHidden && surface.id !== "reading";
    layout.panelState.panel.classList.toggle("abstractin-reading-notes-hidden", !!layout.notesHidden);
    layout.panelState.panel.style.width = show && layout.hiddenNoteLayout?.width || (Number(this.getPref(show ? "readingWorkspaceWidth" : "readerPanelWidth")) || (show ? 850 : 380)) + "px";
    this.updateReadingNoteToggle(layout); this.drawReadingLayout(layout);
   } finally { layout.togglingNotes = false; layout.noteToggle.disabled = false; this.saveReadingDockLayout(layout); }
  },
  saveReadingDockLayoutSnapshot(layout) {
   layout.hiddenNoteLayout = { width: layout.panelState.panel.style.width, groups: [...layout.groups.values()].map(group => ({ main: group.id === "main", tree: JSON.parse(JSON.stringify(group.tree)),
    bounds: group.id === "main" ? null : { width: group.win.outerWidth, height: group.win.outerHeight, left: group.win.screenX, top: group.win.screenY } })) };
  },
  drawReadingSources(layout) {
   layout.readingContext = this._views.get(layout.entry.root)?.ctx || layout.readingContext;
   const doc = layout.win.document, label = layout.workspace ? "Workspace: " + layout.workspace.name : "Single document";
   layout.title.title = label; layout.title.setAttribute("aria-label", label); layout.title.replaceChildren(this.svgIcon(doc, layout.workspace ? "patternGrid" : "paper"));
   const selected = layout.documents.find(ref => ref.key === layout.readingContext?.paperItem.key) || layout.documents[0];
   layout.sources.replaceChildren(this.el(doc, "span", "abstractin-layout-source-label", selected?.title || "Sources"), this.svgIcon(doc, "chevron"));
   layout.sources.title = (selected?.title || "Sources") + " — " + layout.documents.length + " document(s)";
   layout.sources.setAttribute("aria-label", "Source documents: " + (selected?.title || "Sources"));
   this.syncReadingToolbar(layout);
  },
  syncReadingToolbar(layout) {
   const native = layout.reader._iframeWindow?.document.querySelector(".toolbar");
   if (!native) return;
   const style = native.ownerDocument.defaultView.getComputedStyle(native), height = native.getBoundingClientRect().height;
   if (height > 0) layout.toolbar.style.setProperty("--abstractin-toolbar-height", height + "px");
   if (style.backgroundColor && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor)) layout.toolbar.style.setProperty("--abstractin-toolbar-background", style.backgroundColor);
   if (parseFloat(style.borderBottomWidth)) layout.toolbar.style.borderBottom = style.borderBottom;
  },
  openReadingSourceMenu(layout) {
   if (layout.closeSourceMenu) { layout.closeSourceMenu(); return; }
   const doc = layout.win.document, anchor = layout.sources, menu = this.el(doc, "div", "abstractin-panel-choice-menu abstractin-layout-source-menu"); menu.setAttribute("role", "menu");
   const close = () => { menu.remove(); anchor.setAttribute("aria-expanded", "false"); doc.removeEventListener("mousedown", outside, true); doc.removeEventListener("keydown", keyboard, true); layout.win.removeEventListener("resize", close); delete layout.closeSourceMenu; };
   const outside = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) close(); };
   const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); close(); anchor.focus(); return; }
    if (event.key === "Tab") { close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const items = [...menu.querySelectorAll("button")], index = items.indexOf(doc.activeElement);
    items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
   };
   const add = this.el(doc, "button", "abstractin-layout-source-add", "+ Add documents"); add.setAttribute("role", "menuitem");
   add.onclick = () => { close(); this.showReadingSources(layout); }; menu.append(add, this.el(doc, "hr"));
   for (const ref of layout.documents) {
    const button = this.el(doc, "button", "abstractin-layout-source", ref.title); button.setAttribute("role", "menuitemradio"); button.setAttribute("aria-checked", String(layout.readingContext?.paperItem.key === ref.key));
    button.onclick = () => { close(); this.selectReadingSource(layout, ref).catch(error => this.layoutError(layout, error)); }; menu.append(button);
   }
   doc.documentElement.append(menu); const rect = anchor.getBoundingClientRect(), width = Math.min(380, layout.win.innerWidth - 24);
   Object.assign(menu.style, { width: width + "px", left: Math.max(8, Math.min(rect.left, layout.win.innerWidth - width - 8)) + "px", top: rect.bottom + 4 + "px" });
   layout.closeSourceMenu = close; anchor.setAttribute("aria-expanded", "true"); doc.addEventListener("mousedown", outside, true); doc.addEventListener("keydown", keyboard, true); layout.win.addEventListener("resize", close); add.focus();
  },
  async selectReadingSource(layout, ref) {
   if (layout.readingContext?.paperItem.key === ref.key) return;
   const item = await this.resolveNoteDocument(ref), pdf = item && await item.getBestAttachment();
   if (!pdf?.isPDFAttachment?.()) throw new Error("This document has no readable PDF.");
   if (this._pending.has(this._views.get(layout.entry.root)?.ctx.dir)) throw new Error("Wait for the reading answer before switching documents.");
   this._readingLayoutReaders.set(pdf.id, layout); const reader = await Zotero.Reader.open(pdf.id, null, { openInWindow: false });
   if (reader) { if (reader._initPromise) await reader._initPromise; await this.openReaderPanel(reader); }
   this.drawReadingSources(layout);
  },
  async closeReadingLayout(layout, { discard = false } = {}) {
   if (!discard) await layout.noteState.flush();
   const previous = this._views.get(layout.entry.root), draft = previous?.input.value || "";
   layout.entry.root.disposeUI?.(); this._views.delete(layout.entry.root);
   this.disposeReadingLayout(layout); layout.shell.remove(); delete layout.entry.layout; delete layout.entry.layoutButton;
   this.renderSkeleton(layout.win.document, layout.entry.body); layout.entry.root = layout.entry.body.querySelector(".abstractin-root");
   layout.panelState.panel.classList.remove("abstractin-reader-panel-workspace", "abstractin-reading-notes-hidden"); layout.panelState.panel.style.width = (Number(this.getPref("readerPanelWidth")) || 380) + "px";
   layout.entry.render = this.renderContent(layout.win.document, layout.entry.body, Zotero.Items.get(layout.reader.itemID), layout.reader); await layout.entry.render;
   const view = this._views.get(layout.entry.root); if (view) view.input.value = draft;
   await this.openReaderPanel(layout.reader);
  },
  disposeReadingLayout(layout) {
   if (layout.disposed) return; layout.disposed = true;
   layout.closeSourceMenu?.();
   for (const surface of layout.surfaces.values()) surface.destination._closeMenu?.();
   const state = layout.noteState;
   if (state?.input && !state.forceClose && !state.note.deleted && (state.revision !== state.savedRevision || state.timer)) {
    // Snapshot synchronously before destroying an editor, including when its
    // native PDF tab closes. Track the write so plugin shutdown can await it.
    const task = state.flush().catch(error => this.logError("layout closing save", error));
    this._readingLayoutSaves.add(task); task.finally(() => this._readingLayoutSaves.delete(task));
   }
   layout.noteState?.dispose?.(); this._readingLayouts.delete(layout.id);
   for (const [id, value] of this._readingLayoutReaders) if (value === layout) this._readingLayoutReaders.delete(id);
   for (const group of layout.groups.values()) { group.splitDisposers?.forEach(dispose => dispose()); if (group.id !== "main" && group.win && !group.win.closed) { group.allowClose = true; group.win.close(); } }
   layout.win.removeEventListener("unload", layout.unload);
  },
  releaseReaderPanelView(state, reader, entry) {
   if (entry.layout) this.disposeReadingLayout(entry.layout);
   return original.releaseReaderPanelView.call(this, state, reader, entry);
  },
  async closeMarkdownNoteWindows() {
   for (const layout of [...this._readingLayouts.values()]) { try { await layout.noteState.flush(); } catch (error) { this.logError("layout shutdown", error); } this.disposeReadingLayout(layout); }
   await Promise.all([...this._readingLayoutSaves]);
   return original.closeMarkdownNoteWindows.call(this);
  },
 });
})();
