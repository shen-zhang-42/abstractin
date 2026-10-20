/* NoteIn is a reversible item-tree projection. Notes retain their real parents. */
"use strict";
(() => {
 const addWindow = AbstractIn.addToWindow, removeWindow = AbstractIn.removeFromWindow;
 Object.assign(AbstractIn, {
  _noteInGroups: new Map(), _noteInAnchors: new Map(), _noteInNoteParents: new Map(), _noteInWindows: new Map(),
  _noteInPending: new Set(), _noteInQueue: Promise.resolve(), _noteInOrganizing: new Map(),
  noteInMetadata(note, parent, legacy = false) {
   if (!note?.isNote?.() || note.deleted || note.parentID !== parent.id || note.libraryID !== parent.libraryID) return null;
   const tags = note.getTags().map(t => t.tag);
   const template = this.parseNoteHTML(note.getNote());
   for (const pre of template.content.querySelectorAll('pre')) {
    try {
     const data = JSON.parse(pre.textContent);
     if (['abstractin-notein-v1', 'abstractin-chat-v1'].includes(data.format) && data.itemKey !== parent.key) return null;
     if (data.format === 'abstractin-notein-v1' && tags.includes('AbstractIn:NoteIn') && data.itemKey === parent.key) return 'anchor';
     if (data.format === 'abstractin-chat-v1' && data.itemKey === parent.key) return 'note';
    } catch (_) {}
   }
   const title = template.content.querySelector('h1')?.textContent || '';
   const owner = [...template.content.querySelectorAll('p')].some(p => p.textContent.startsWith('Zotero item: ' + parent.key + '; attachment: '));
   if (title.startsWith('AbstractIn — ') && owner) return 'note';
   // Legacy plugin notes use this title prefix even without ownership metadata.
   return legacy && title.startsWith('AbstractIn — ') && ![...template.content.querySelectorAll('p')].some(p => /^Zotero item: /.test(p.textContent)) ? 'note' : null;
  },
  async organizeNoteInParent(id) {
   if (this._noteInOrganizing.has(id)) return this._noteInOrganizing.get(id);
   const request = this._organizeNoteInParent(id); this._noteInOrganizing.set(id, request);
   try { return await request; } finally { if (this._noteInOrganizing.get(id) === request) this._noteInOrganizing.delete(id); }
  },
  async _organizeNoteInParent(id) {
   const epoch = this._noteInEpoch;
   const parent = await Zotero.Items.getAsync(id);
   if (!parent?.isRegularItem?.() || parent.deleted) { this._noteInGroups.delete(id); return; }
   if (typeof parent.loadChildItems === 'function') await parent.loadChildItems();
   const notes = await Zotero.Items.getAsync(parent.getNotes());
   if (epoch !== this._noteInEpoch || this._noteInRunning === false) return;
   const anchors = notes.filter(note => this.noteInMetadata(note, parent) === 'anchor').sort((a, b) => a.id - b.id);
   const legacyKeys = new Set();
   for (const index of anchors) {
    const template = this.parseNoteHTML(index.getNote());
    for (const pre of template.content.querySelectorAll('pre')) try {
     const data = JSON.parse(pre.textContent);
     if (data.format === 'abstractin-notein-v1' && data.itemKey === parent.key && Array.isArray(data.legacyKeys)) {
      for (const key of data.legacyKeys) if (typeof key === 'string') legacyKeys.add(key);
     }
    } catch (_) {}
   }
   const owned = []; let membershipChanged = false;
   for (const note of notes) {
    const strict = this.noteInMetadata(note, parent);
    if (strict === 'note' || this.noteInMetadata(note, parent, true) === 'note') {
     owned.push(note);
     if (!strict && !legacyKeys.has(note.key)) { legacyKeys.add(note.key); membershipChanged = true; }
    }
    if (strict || owned.includes(note)) this._noteInNoteParents.set(note.id, id);
   }
   let anchor = anchors[0];
   if (!anchor && owned.length && parent.isEditable()) {
    anchor = new Zotero.Item('note'); anchor.libraryID = parent.libraryID; anchor.parentID = id;
    anchor.setNote(this.noteInIndexHTML(parent, legacyKeys)); anchor.addTag('AbstractIn'); anchor.addTag('AbstractIn:NoteIn'); await anchor.saveTx();
   } else if (anchor && membershipChanged && parent.isEditable()) {
    const html = this.noteInIndexHTML(parent, legacyKeys);
    if (anchor.getNote() !== html) { anchor.setNote(html); await anchor.saveTx(); }
   }
   const previous = this._noteInGroups.get(id);
   if (previous) this._noteInAnchors.delete(previous.anchor.id);
   if (!anchor) { this._noteInGroups.delete(id); return; }
   const group = { parent, anchor, notes: [...owned, ...anchors.slice(1)] };
   this._noteInGroups.set(id, group); this._noteInAnchors.set(anchor.id, group);
   this._noteInNoteParents.set(anchor.id, id);
  },
  noteInIndexHTML(parent, legacyKeys) {
   const doc = Zotero.getMainWindow().document, body = this.el(doc, 'div');
   body.append(this.el(doc, 'h1', null, 'NoteIn'), this.el(doc, 'p', null, 'Expand NoteIn in the document list to see AbstractIn reading notes and conversations. Notes keep their original parent, content and sync identity. This directory is managed by AbstractIn.'),
    this.el(doc, 'pre', null, JSON.stringify({ format: 'abstractin-notein-v1', itemKey: parent.key, legacyKeys: [...legacyKeys] })));
   return body.outerHTML;
  },
  noteInCollectionRows(view) {
   return view.collectionTreeRows || view.rowProvider?.collectionTreeRows || (view.collectionTreeRow ? [view.collectionTreeRow] : []);
  },
  noteInViewReason(view) {
   if (view.props?.regularOnly) return 'This list hides notes.';
   const rows = this.noteInCollectionRows(view);
   if (rows.some(row => row.isTrash?.())) return 'The trash shows notes individually.';
   return '';
  },
  async scanNoteIn() {
   const parents = new Set();
   for (const library of Zotero.Libraries.getAll()) {
    if (!this._noteInRunning) break;
    const search = new Zotero.Search(); search.libraryID = library.libraryID;
    search.addCondition('itemType', 'is', 'note');
    const ids = await search.search();
    for (let at = 0; at < ids.length && this._noteInRunning; at += 100) {
     for (const note of await Zotero.Items.getAsync(ids.slice(at, at + 100))) {
      if (note?.parentID && !note.deleted && (note.getTags().some(t => t.tag === 'AbstractIn') || /AbstractIn|abstractin-chat-v1|Zotero item: /.test(note.getNote()))) parents.add(note.parentID);
     }
    }
   }
   for (const id of parents) { if (!this._noteInRunning) break; await this.organizeNoteInParent(id); }
   this.refreshNoteInWindows();
  },
  queueNoteIn(ids) {
   for (const id of ids) this._noteInPending.add(id);
   if (this._noteInTimer || !this._noteInRunning) return;
   this._noteInTimer = Zotero.getMainWindow().setTimeout(() => {
    this._noteInTimer = null;
    const parents = [...this._noteInPending]; this._noteInPending.clear();
    this._noteInQueue = this._noteInQueue.catch(() => {}).then(async () => {
     for (const id of parents) { if (!this._noteInRunning) return; try { await this.organizeNoteInParent(id); } catch (e) { this.logError('NoteIn directory', e); } }
     this.refreshNoteInWindows();
    });
   }, 150);
  },
  startNoteIn() {
   if (this._noteInRunning) return this._noteInReady;
   this._noteInRunning = true;
   this._noteInEpoch = (this._noteInEpoch || 0) + 1;
   this._noteInObserver = Zotero.Notifier.registerObserver({ notify: async (_event, _type, ids) => {
    if (!this._noteInRunning) return;
    const parents = new Set();
    for (const id of ids) {
     let item; try { item = await Zotero.Items.getAsync(id); } catch (_) { /* Deleted items can be identified from the previous projection. */ }
     if (item?.getTags?.().some(t => t.tag === 'AbstractIn:NoteIn')) continue;
     if (item?.isNote?.() && item.parentID) parents.add(item.parentID);
     if (item?.isRegularItem?.() && this._noteInGroups.has(id)) parents.add(id);
     const oldParent = this._noteInNoteParents.get(id); if (oldParent) parents.add(oldParent);
    }
    this.queueNoteIn(parents);
   } }, ['item'], 'abstractin-notein');
   for (const win of Zotero.getMainWindows()) this.attachNoteInWindow(win);
   this._noteInReady = Promise.resolve(Zotero.uiReadyPromise).then(() => {
    if (!this._noteInRunning) return;
    this._noteInQueue = this._noteInQueue.catch(() => {}).then(() => this.scanNoteIn()); return this._noteInQueue;
   }).catch(e => this.logError('NoteIn scan', e));
   return this._noteInReady;
  },
  stopNoteIn() {
   this._noteInRunning = false;
   this._noteInEpoch = (this._noteInEpoch || 0) + 1;
   if (this._noteInObserver) Zotero.Notifier.unregisterObserver(this._noteInObserver);
   this._noteInObserver = null;
   if (this._noteInTimer) Zotero.getMainWindow()?.clearTimeout(this._noteInTimer);
   this._noteInTimer = null; this._noteInPending.clear();
   for (const win of [...this._noteInWindows.keys()]) this.detachNoteInWindow(win);
  },
  addToWindow(win) { addWindow.call(this, win); if (this._noteInRunning) this.attachNoteInWindow(win); },
  removeFromWindow(win) { this.detachNoteInWindow(win); removeWindow.call(this, win); },
  attachNoteInWindow(win) {
   if (!win.ZoteroPane || this._noteInWindows.has(win)) return;
   const state = {}; this._noteInWindows.set(win, state);
   const connect = () => {
    if (!this._noteInRunning || win.closed || !this._noteInWindows.has(win)) return;
    this.connectNoteInWindow(win);
    state.timer = win.setTimeout(connect, 500);
   };
   connect();
  },
  connectNoteInWindow(win) {
   const state = this._noteInWindows.get(win); if (!state) return;
   const view = win.ZoteroPane?.itemsView;
   if (state.adapter && (state.view !== view || state.provider !== (view?.rowProvider || view) || state.tree !== view?.tree)) {
    try { state.adapter.dispose(); } catch (e) { this.logError('NoteIn old list cleanup', e); }
    state.adapter = null; state.view = null;
   }
   if (view?.tree && view.getRow && (view.rowProvider?._rows || view._rows) && !state.adapter) {
    try { state.adapter = this.installNoteInTree(view); state.view = view; state.provider = view.rowProvider || view; state.tree = view.tree; }
    catch (e) { this.logError('NoteIn item tree', e); }
   }
   return state;
  },
  async waitNoteInWindow(win) {
   for (let attempt = 0; attempt < 160; attempt++) {
    if (win.closed || this._noteInRunning === false) break;
    const state = this.connectNoteInWindow(win);
    if (state?.adapter && state.view === win.ZoteroPane?.itemsView) {
     await state.view.waitForLoad?.();
     if (state.view === win.ZoteroPane?.itemsView && state.tree === state.view.tree && state.provider === (state.view.rowProvider || state.view)) return state;
    }
    await Zotero.Promise.delay(25);
   }
   throw new Error('The document list is not ready. Switch to the library and try again.');
  },
  detachNoteInWindow(win) {
   const state = this._noteInWindows.get(win); if (!state) return;
   if (state.timer) win.clearTimeout(state.timer);
   state.adapter?.dispose(); this._noteInWindows.delete(win);
  },
  refreshNoteInWindows() { for (const state of this._noteInWindows.values()) state.adapter?.refresh(); },
  installNoteInTree(view) {
   const plugin = this, modern = !!view.rowProvider, provider = modern ? view.rowProvider : view;
   const mapName = modern ? 'refreshRowMap' : '_refreshRowMap';
   if (typeof provider[mapName] !== 'function') throw new Error('Unsupported Zotero item-tree row map. Native notes are unchanged.');
   const opened = new Set(), stored = new Map(), injected = new WeakSet(), undo = []; let active = true, transforming = false, lastOutput = null, scope = null;
   const patch = (object, name, wrap) => {
    if (typeof object[name] !== 'function') return;
    const own = Object.getOwnPropertyDescriptor(object, name), original = object[name], replacement = wrap(original);
    object[name] = replacement;
    undo.push(() => { if (object[name] === replacement) { if (own) Object.defineProperty(object, name, own); else delete object[name]; } });
   };
   // Group only notes already supplied beneath a document by Zotero. Standalone
   // note hits stay visible, and unmatched notes are never added to a search.
   const enabled = () => active && !plugin.noteInViewReason(view);
   const groupAt = index => {
    const group = enabled() && plugin._noteInAnchors.get(provider._rows[index]?.ref?.id);
    return group && stored.get(group.parent.id)?.size ? group : null;
   };
   const create = (ref, level) => modern ? provider.createRow(ref, level, false) : { ref, id: ref.treeViewID, level, isOpen: false, getField: (field, plain) => ref.getField(field, plain, true), numNotes: () => 0 };
   const restoreRows = () => {
    for (let at = provider._rows.length - 1; at >= 0; at--) {
     const row = provider._rows[at], cache = stored.get(row.ref?.id);
     if (!cache || !row.isOpen) continue;
     let end = at + 1; while (end < provider._rows.length && provider._rows[end].level > row.level) end++;
     const children = provider._rows.slice(at + 1, end).filter(child => !injected.has(child));
     const present = new Set(children.map(child => child.ref?.id));
     for (const [id, child] of cache) if (!child.ref.deleted && child.ref.parentID === row.ref.id && !present.has(id)) children.push(child);
     for (const child of children) if (cache.has(child.ref?.id)) child.level = row.level + 1;
     provider._rows.splice(at + 1, end - at - 1, ...children);
    }
   };
   const transform = () => {
    if (transforming) return; transforming = true;
    try {
     const nextScope = JSON.stringify([enabled(), plugin.noteInCollectionRows(view).map(row => [row.id, row.type, row.searchText || '', !!row.advancedSearch, Array.from(row.tags || []).sort()])]);
     if (scope !== nextScope) { if (provider._rows === lastOutput) restoreRows(); stored.clear(); scope = nextScope; }
     else if (provider._rows !== lastOutput) stored.clear();
     const input = provider._rows, output = [];
     for (let at = 0; at < input.length;) {
      const row = input[at], group = enabled() && row.ref?.isRegularItem?.() && row.isOpen ? plugin._noteInGroups.get(row.ref.id) : null;
      if (!group) { output.push(row); at++; continue; }
      let end = at + 1; while (end < input.length && input[end].level > row.level) end++;
      const children = input.slice(at + 1, end);
      let anchorRow = children.find(r => r.ref?.id === group.anchor.id);
      const ids = new Set(group.notes.filter(n => !n.deleted && n.parentID === group.parent.id).map(n => n.id));
      const cache = stored.get(group.parent.id) || new Map();
      for (const child of children) if (ids.has(child.ref?.id)) cache.set(child.ref.id, child);
      for (const id of [...cache.keys()]) if (!ids.has(id)) cache.delete(id);
      stored.set(group.parent.id, cache);
      if (!anchorRow && cache.size) {
       anchorRow = create(group.anchor, row.level + 1); injected.add(anchorRow);
       const first = children.findIndex(child => ids.has(child.ref?.id));
       children.splice(first < 0 ? children.length : first, 0, anchorRow);
      }
      output.push(row);
      for (const child of children) {
       if (ids.has(child.ref?.id)) continue;
       output.push(child);
       if (child !== anchorRow) continue;
       child.isOpen = opened.has(group.anchor.id);
       if (child.isOpen) for (const note of group.notes) if (ids.has(note.id) && cache.has(note.id)) {
        const nested = cache.get(note.id) || create(note, row.level + 2); nested.level = row.level + 2;
        cache.set(note.id, nested); output.push(nested);
       }
      }
      at = end;
     }
     provider._rows = output; lastOutput = output;
    } finally { transforming = false; }
   };
   patch(provider, mapName, original => function(...args) { transform(); return original.apply(this, args); });
   const refresh = () => {
    if (!active) return;
    // A normal refresh re-reads native children when a directory was just added.
    provider[mapName](); view.tree?.invalidate();
   };
   const toggle = index => {
    const group = groupAt(index); if (!group) return false;
    const selected = view.getSelectedObjects?.() || [], focus = view.selection?.focused;
    if (opened.has(group.anchor.id)) opened.delete(group.anchor.id); else opened.add(group.anchor.id);
    provider[mapName]();
    const visible = new Set(provider._rows.map(r => r.ref.id));
    const selection = selected.map(item => visible.has(item.id) ? item : group.notes.some(note => note.id === item.id) ? group.anchor : item);
    if (view._restoreSelection) view._restoreSelection(selection, false, true);
    else if (view.selection && focus === index) view.selection.select(provider._rows.findIndex(r => r.ref.id === group.anchor.id));
    view.tree.invalidate(); return true;
   };
   for (const name of ['isContainer', 'isContainerEmpty', 'isContainerOpen']) patch(view, name, original => function(index, ...args) {
    const group = groupAt(index);
    return group ? name === 'isContainer' ? true : name === 'isContainerEmpty' ? !stored.get(group.parent.id)?.size : opened.has(group.anchor.id) : original.call(this, index, ...args);
   });
   const toggleName = modern ? 'onToggleOpenState' : 'toggleOpenState';
   patch(view, toggleName, original => function(index, ...args) { if (toggle(index)) return modern ? undefined : Promise.resolve(); return original.call(this, index, ...args); });
   if (!modern) {
    // Zotero 9 restores native containers by blindly toggling their saved IDs.
    // Virtual folders already follow our own open state when parents reopen.
    patch(view, '_saveOpenState', original => function(...args) { return original.apply(this, args).filter(id => !plugin._noteInAnchors.has(id)); });
    patch(view, '_rememberOpenState', original => function(ids, ...args) { return original.call(this, ids.filter(id => !plugin._noteInAnchors.has(id)), ...args); });
    patch(view, '_restoreSelection', original => function(selection, expand = true, ...args) {
     if (expand && enabled()) {
      for (const item of selection) {
       const group = plugin._noteInGroups.get(plugin._noteInNoteParents.get(item.id));
       if (group && group.anchor.id !== item.id) opened.add(group.anchor.id);
      }
      provider[mapName]();
     }
     return original.call(this, selection, expand, ...args);
    });
   }
   for (const name of ['selectItem', 'selectItems', 'expandToItem']) patch(view, name, original => function(ids, ...args) {
    for (const id of Array.isArray(ids) ? ids : [ids]) {
     const parent = plugin._noteInNoteParents.get(id), group = plugin._noteInGroups.get(parent);
     if (group && group.anchor.id !== id) opened.add(group.anchor.id);
    }
    provider[mapName](); return original.call(this, ids, ...args);
   });
   const tree = view.tree; let lastProps = null, lastNativeProps = tree.props;
   const projectProps = () => {
    if (!active || tree.props === lastProps) return;
    const base = tree.props; lastNativeProps = base;
    const props = { ...base, isContainer: view.isContainer.bind(view), isContainerEmpty: view.isContainerEmpty.bind(view), isContainerOpen: view.isContainerOpen.bind(view),
     [modern ? 'onToggleOpenState' : 'toggleOpenState']: view[toggleName].bind(view) };
    const render = base.renderItem;
    props.renderItem = (...args) => {
     const reused = args[2];
     if (reused?.dataset.abstractinNoteIn) { delete reused.dataset.abstractinNoteIn; reused.removeAttribute('aria-label'); reused.removeAttribute('aria-expanded'); }
     const element = render(...args), group = groupAt(args[0]);
     element.classList.toggle('abstractin-notein-row', !!group);
     if (group) {
      element.dataset.abstractinNoteIn = 'true';
      element.setAttribute('aria-label', 'NoteIn, ' + stored.get(group.parent.id).size + ' notes'); element.setAttribute('aria-expanded', String(opened.has(group.anchor.id)));
      const icon = element.querySelector('.cell-icon');
      if (icon) {
       const folder = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
       folder.setAttribute('viewBox', '0 0 24 24'); folder.setAttribute('width', '16'); folder.setAttribute('height', '16'); folder.setAttribute('aria-hidden', 'true');
       folder.classList.add('cell-icon', 'abstractin-notein-folder');
       const path = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
       path.setAttribute('d', 'M3 5h6l2 2h10v12H3Z'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-linejoin', 'round');
       folder.append(path); icon.replaceWith(folder);
      }
     }
     return element;
    };
    tree.props = props; lastProps = props;
   };
   patch(tree, 'render', original => function(...args) { projectProps(); return original.apply(this, args); });
   patch(tree, 'invalidate', original => function(...args) { projectProps(); return original.apply(this, args); });
   projectProps(); refresh();
   return { refresh, toggle, provider, opened, dispose() {
    active = false;
    // Restore only rows that belonged to the current native result set.
    restoreRows();
    for (const restore of undo.reverse()) restore();
    if (tree.props === lastProps) tree.props = lastNativeProps;
    for (const row of provider._rows) if (plugin._noteInAnchors.has(row.ref?.id)) row.isOpen = false;
    for (const element of view.domEl?.querySelectorAll('.abstractin-notein-row') || []) {
     element.classList.remove('abstractin-notein-row'); element.removeAttribute('aria-label'); element.removeAttribute('aria-expanded'); delete element.dataset.abstractinNoteIn;
    }
    provider[mapName](); tree.invalidate();
   } };
  },
 });
})();
