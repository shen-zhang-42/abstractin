import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

function fixture(modern = false) {
 const env = loadPlugin(), { plugin: p, window, document } = env;
 let next = 100;
 const items = new Map();
 const parent = { id: 1, libraryID: 1, key: 'PAPER', isRegularItem: () => true, isEditable: () => true, getNotes: () => [...items.values()].filter(n => n.parentID === 1 && !n.deleted).map(n => n.id) };
 items.set(1, parent);
 class Note {
  constructor() { this.id = next++; this.key = 'N' + this.id; this.libraryID = 1; this.parentID = 1; this.tags = []; this.html = ''; }
  isNote() { return true; } isRegularItem() { return false; } get treeViewID() { return this.id; }
  getTags() { return this.tags.map(tag => ({ tag })); } addTag(tag) { this.tags.push(tag); }
  getNote() { return this.html; } setNote(html) { this.html = html; } async saveTx() { items.set(this.id, this); }
  getField() { return this.key; }
 }
 window.Zotero.Items = { get: id => items.get(id), getAsync: async ids => Array.isArray(ids) ? ids.map(id => items.get(id)) : items.get(ids) };
 window.Zotero.Item = Note;
 const note = (kind, html) => { const n = new Note(); n.html = html; if (kind) n.tags = ['AbstractIn', kind]; items.set(n.id, n); return n; };
 const ordinary = note('', '<p>Personal note</p>');
 const collision = note('UserTag', '<h1>My note tagged AbstractIn</h1>');
 const chat = note('AbstractIn:Chat', '<pre>{"format":"abstractin-chat-v1","itemKey":"PAPER"}</pre>');
 const reading = note('AbstractIn:Summary', '<h1>AbstractIn — Summary</h1><p>Zotero item: PAPER; attachment: PDF</p><p>Keep edited text</p>');
 const selected = new Set();
 const view = { props: {}, collectionTreeRow: { isTrash: () => false }, selection: { focused: 0, select(i) { selected.clear(); selected.add(i); } },
  getSelectedObjects() { return [...selected].map(i => provider._rows[i]?.ref).filter(Boolean); },
  _restoreSelection(objects) { selected.clear(); for (const item of objects) { const i = provider._rows.findIndex(r => r.ref.id === item.id); if (i >= 0) selected.add(i); } },
  selectItems(ids) { for (const id of ids) { const i = provider._rows.findIndex(r => r.ref.id === id); if (i >= 0) this.selection.select(i); } },
  getRow(i) { return provider._rows[i]; },
  isContainer(i) { return provider._rows[i]?.ref.isRegularItem(); },
  isContainerEmpty() { return false; }, isContainerOpen(i) { return !!provider._rows[i]?.isOpen; },
  tree: { props: { renderItem: () => document.createElement('div') }, invalidate() {}, render() {} },
 };
 const row = (ref, level) => ({ ref, id: ref.id, level, isOpen: ref === parent });
 const provider = modern ? { _rows: [], createRow: row, refreshRowMap() { this._rowMap = new Map(this._rows.map((r,i) => [r.id,i])); } } : view;
 if (modern) { view.rowProvider = provider; view.onToggleOpenState = () => {}; } else { view.toggleOpenState = () => Promise.resolve(); provider._refreshRowMap = function() { this._rowMap = new Map(this._rows.map((r,i) => [r.id,i])); }; }
 const populate = () => { provider._rows = [row(parent,0), ...[...items.values()].filter(n => n !== parent && !n.deleted).map(n => row(n,1))]; };
 return { ...env, p, items, parent, ordinary, collision, chat, reading, view, provider, row, populate, note, selected };
}

for (const modern of [false, true]) test(`NoteIn ${modern ? '10' : '9'} projection collapses old plugin notes, preserves native notes and restores on disable`, async () => {
 const f = fixture(modern), { p, parent, ordinary, collision, chat, reading, view, provider } = f;
 const before = [ordinary, collision, chat, reading].map(n => [n.id, n.parentID, n.getNote()]);
 await Promise.all([p.organizeNoteInParent(parent.id), p.organizeNoteInParent(parent.id)]);
 const group = p._noteInGroups.get(1); assert.ok(group); assert.equal(f.items.size, 6, 'one managed index created');
 assert.deepEqual(Array.from(group.notes, n => n.id), [chat.id, reading.id]);
 f.populate(); const adapter = p.installNoteInTree(view);
 assert.deepEqual(Array.from(provider._rows, r => r.ref.id), [parent.id, ordinary.id, collision.id, group.anchor.id]);
 const index = provider._rows.findIndex(r => r.ref === group.anchor);
 assert.equal(view.isContainer(index), true); assert.equal(view.isContainerOpen(index), false);
 await view.tree.props[modern ? 'onToggleOpenState' : 'toggleOpenState'](index);
 assert.deepEqual(Array.from(provider._rows.slice(index+1), r => [r.ref.id,r.level]), [[chat.id,2],[reading.id,2]]);
 await view.selectItems([reading.id]); assert.equal(view.getSelectedObjects()[0], reading);
 adapter.toggle(index); assert.ok(!provider._rows.some(r => r.ref === reading));
 adapter.dispose();
 assert.ok(provider._rows.some(r => r.ref === reading && r.level === 1));
 assert.deepEqual([ordinary, collision, chat, reading].map(n => [n.id,n.parentID,n.getNote()]), before);
});

test('new owned notes join the group and deleted notes do not reappear from the hidden-row cache', async () => {
 const f = fixture(), { p, view, provider, parent, chat } = f;
 await p.organizeNoteInParent(1); f.populate(); const adapter = p.installNoteInTree(view);
 chat.deleted = true;
 const added = f.note('AbstractIn:Position', '<h1>AbstractIn — Position</h1><p>Zotero item: PAPER; attachment: PDF</p>');
 await p.organizeNoteInParent(1); f.populate(); adapter.refresh();
 adapter.toggle(provider._rows.findIndex(r => r.ref === p._noteInGroups.get(1).anchor));
 assert.ok(provider._rows.some(r => r.ref === added)); assert.ok(!provider._rows.some(r => r.ref === chat));
 adapter.dispose(); assert.ok(!provider._rows.some(r => r.ref === chat));
});

test('search and trash views keep ordinary native rows instead of hiding note matches', async () => {
 const f = fixture(), { p, view, provider } = f; await p.organizeNoteInParent(1); f.populate();
 view._searchMode = true; const adapter = p.installNoteInTree(view);
 assert.equal(provider._rows.length, f.items.size);
 view._searchMode = false; view.collectionTreeRow.isTrash = () => true; adapter.refresh(); assert.equal(provider._rows.length, f.items.size);
 adapter.dispose();
});

test('unmarked native notes, misleading tags and another parent metadata remain ungrouped', async () => {
 const f = fixture();
 const wrong = f.note('AbstractIn:Chat', '<pre>{"format":"abstractin-chat-v1","itemKey":"OTHER"}</pre>');
 assert.equal(f.p.noteInMetadata(wrong, f.parent), null);
 assert.equal(f.p.noteInMetadata(f.ordinary, f.parent), null); assert.equal(f.p.noteInMetadata(f.collision, f.parent), null);
 await f.p.organizeNoteInParent(1); assert.ok(!f.p._noteInGroups.get(1).notes.includes(wrong));
});

test('read-only libraries do not create directory records or change existing notes', async () => {
 const f = fixture(); f.parent.isEditable = () => false;
 const before = f.items.size;
 await f.p.organizeNoteInParent(1);
 assert.equal(f.items.size, before); assert.equal(f.p._noteInGroups.size, 0);
});

test('manual grouping includes title-only legacy notes and remembers their keys without editing them', async () => {
 const f = fixture(), { p, parent } = f;
 const legacy = f.note('', '<h1>AbstractIn — De Finetti 表示与几乎必然</h1><p>Earlier answer</p>');
 const before = [legacy, f.ordinary, f.collision].map(n => [n.id, n.parentID, n.getNote(), [...n.tags]]);
 await p.organizeNoteInParent(1);
 assert.ok(!p._noteInGroups.get(1).notes.includes(legacy));
 const result = await p.groupNoteInManually(parent.id);
 assert.equal(result.count, 3); assert.equal(result.documents, 1);
 const anchor = p._noteInGroups.get(1).anchor;
 assert.ok(anchor.getNote().includes(legacy.key));
 p._noteInGroups.clear(); p._noteInAnchors.clear(); p._noteInNoteParents.clear();
 await p.organizeNoteInParent(1);
 assert.ok(p._noteInGroups.get(1).notes.includes(legacy), 'startup recognizes explicitly grouped legacy notes');
 await p.groupNoteInManually(1);
 assert.equal(p._noteInGroups.get(1).anchor.id, anchor.id);
 assert.deepEqual([legacy, f.ordinary, f.collision].map(n => [n.id, n.parentID, n.getNote(), [...n.tags]]), before);
 const wrong = f.note('AbstractIn:Chat', '<h1>AbstractIn — Wrong document</h1><pre>{"format":"abstractin-chat-v1","itemKey":"OTHER"}</pre>');
 await p.groupNoteInManually(1);
 assert.ok(!p._noteInGroups.get(1).notes.includes(wrong));
});

test('verifiable ownership metadata works even when a legacy note has lost its tag', async () => {
 const f = fixture(); f.chat.tags = []; f.reading.tags = [];
 await f.p.organizeNoteInParent(1);
 assert.deepEqual(Array.from(f.p._noteInGroups.get(1).notes, n => n.id), [f.chat.id, f.reading.id]);
});

test('settings and document buttons run the correct grouping scope and show completion or failure', async () => {
 const f = fixture(), { p, document } = f;
 const calls = [];
 p.groupNoteInManually = async id => { calls.push(id); return { count: 3, documents: 1, skipped: 0 }; };
 const card = p.buildNoteInCard(document); document.body.append(card);
 const all = card.querySelector('button'); all.click();
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(calls[0], null); assert.match(card.textContent, /Grouped 3 notes/); assert.equal(all.disabled, false);
 const root = document.createElement('div'); document.body.append(root); p._views.set(root, { ctx: { paperItem: f.parent } });
 p.openNoteInGrouping(root); root.querySelector('.abstractin-notein-group-current').click();
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(calls[1], f.parent.id); assert.match(root.textContent, /Grouped 3 notes/);
 p.groupNoteInManually = async () => { throw new Error('Read failed'); };
 await p.runNoteInButton(all, card.querySelector('[role=status]'));
 assert.match(card.textContent, /Could not group notes: Read failed/); assert.equal(all.disabled, false);
});

for (const type of ['unfiled', 'library', 'collection']) test(`Zotero 10 ${type} view groups notes even when Zotero internally uses search mode`, async () => {
 const f = fixture(true), { p, view, provider } = f;
 await p.organizeNoteInParent(1); f.populate();
 view.collectionTreeRows = [{ type, searchText: '', tags: new Set(['AbstractIn']) }]; delete view.collectionTreeRow;
 provider._searchMode = true;
 const adapter = p.installNoteInTree(view);
 const anchor = p._noteInGroups.get(1).anchor;
 assert.ok(provider._rows.some(row => row.ref === anchor));
 assert.ok(!provider._rows.some(row => row.ref === f.chat));
 adapter.toggle(provider._rows.findIndex(row => row.ref === anchor));
 assert.ok(provider._rows.some(row => row.ref === f.chat && row.level === 2));
 adapter.dispose();
});

test('a real text query stays flat and the grouping button offers a verified Show NoteIn action', async () => {
 const f = fixture(true), { p, view, provider, document } = f;
 await p.organizeNoteInParent(1); f.populate();
 view.collectionTreeRow.type = 'library'; view.collectionTreeRow.searchText = 'Earlier'; provider._searchMode = true;
 const adapter = p.installNoteInTree(view);
 assert.ok(provider._rows.some(row => row.ref === f.chat));
 p.groupNoteInManually = async () => ({ count: 2, documents: 1, skipped: 0, documentIDs: [1], displayed: false, reason: p.noteInViewReason(view) });
 let shown = null; p.showNoteIn = async id => { shown = id; };
 const card = p.buildNoteInCard(document); document.body.append(card);
 await p.runNoteInButton(card.querySelector('button'), card.querySelector('[role=status]'));
 assert.match(card.textContent, /not visible in the current list/);
 await card.querySelector('.abstractin-notein-show').onclick();
 assert.equal(shown, 1); assert.match(card.textContent, /now visible and selected/);
 adapter.dispose();
});

test('switching Zotero 10 lists reconnects the adapter before grouping is displayed', async () => {
 const first = fixture(true), second = fixture(true), { p, window } = first;
 await p.organizeNoteInParent(1); first.populate();
 const anchor = p._noteInGroups.get(1).anchor; second.items.set(anchor.id, anchor); second.populate();
 const oldAdapter = p.installNoteInTree(first.view);
 p._noteInWindows.set(window, { adapter: oldAdapter, view: first.view, provider: first.provider, tree: first.view.tree });
 window.ZoteroPane = { itemsView: second.view };
 const state = await p.waitNoteInWindow(window);
 assert.equal(state.view, second.view); assert.notEqual(state.adapter, oldAdapter);
 assert.ok(first.provider._rows.some(row => row.ref.id === first.chat.id), 'old list returns to native rows');
 assert.ok(!second.provider._rows.some(row => row.ref.id === first.chat.id), 'new list hides grouped notes');
 assert.ok(second.provider._rows.some(row => row.ref.id === anchor.id));
 state.adapter.dispose(); p._noteInWindows.clear();
});
