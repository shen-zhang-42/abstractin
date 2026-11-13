import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPlugin } from './load-plugin.mjs';

async function setup() {
 const env = loadPlugin(), { plugin: p, window: win, document: doc } = env;
 win.focus = () => {};
 const files = new Map(), items = new Map(), collections = new Map(); let next = 10;
 win.OS = { Path: { join: (...parts) => parts.join('/') }, File: { exists: async path => files.has(path) } };
 win.Zotero.File = { createDirectoryIfMissingAsync: async () => {}, putContentsAsync: async (path, value) => files.set(path, value), getContentsAsync: async path => { if (!files.has(path)) throw new Error('Missing file'); return files.get(path); } };
 class Item {
  constructor(type) { this.itemType = type; this.libraryID = 1; this.id = ++next; this.key = 'KEY' + this.id; this.tags = []; this.html = ''; this.collections = []; items.set(this.id, this); }
  isNote() { return this.itemType === 'note'; } isRegularItem() { return this.itemType === 'book'; } isAttachment() { return this.itemType === 'attachment'; } isPDFAttachment() { return this.isAttachment(); } isEditable() { return true; }
  getTags() { return this.tags.map(tag => ({ tag })); } addTag(tag) { this.tags.push(tag); } getNote() { return this.html; } setNote(html) { this.html = html; }
  async saveTx() { return this.id; } getField() { return this.title || ''; } getNotes() { return [...items.values()].filter(item => item.parentID === this.id).map(item => item.id); }
  async getBestAttachment() { return this.pdf; } addToCollection(id) { if (!this.collections.includes(id)) this.collections.push(id); } removeFromCollection(id) { this.collections = this.collections.filter(value => value !== id); }
 }
 class Collection {
  constructor() { this.id = ++next; this.key = 'COL' + this.id; this.libraryID = 1; }
  async saveTx() { collections.set(this.id, this); return this.id; }
 }
 win.Zotero.Item = Item; win.Zotero.Collection = Collection;
 win.Zotero.Collections = { get: id => collections.get(id), getByLibrary: libraryID => [...collections.values()].filter(item => item.libraryID === libraryID && !item.parentID), getByParent: id => [...collections.values()].filter(item => item.parentID === id) };
 win.Zotero.Items = { get: id => items.get(id), getAsync: async id => Array.isArray(id) ? id.map(value => items.get(value)) : items.get(id), getByLibraryAndKey: (libraryID, key) => [...items.values()].find(item => item.libraryID === libraryID && item.key === key) };
 win.Zotero.Notifier = { registerObserver: () => 1, unregisterObserver() {} }; win.Zotero.Libraries = { userLibraryID: 1, get: () => ({ editable: true }) };
 win.Zotero.Search = class { addCondition() {} async search() { return []; } };
 p.getDataDir = () => '/data'; p.checkInstalledBackends = async () => {};
 p.installMathComposer = () => () => {};
 doc.createXULElement = name => doc.createElement(name);
 win.MozXULElement = { insertFTLIfNeeded() {} };
 doc.body.innerHTML = '<div id="layout"><div id="native-reader"></div><div id="zotero-context-splitter"></div><div id="zotero-context-pane"></div></div>';
 const a = new Item('book'), b = new Item('book'); a.title = 'Book A'; b.title = 'Book B';
 for (const item of [a, b]) { item.pdf = new Item('attachment'); item.pdf.parentItem = item; item.pdf.parentID = item.id; }
 const reader = { type: 'pdf', itemID: a.pdf.id, tabID: 'tab-a', _window: win };
 win.Zotero.Reader = { getByTabID: () => reader, open: async () => reader };
 win.Zotero_Tabs = { selectedType: 'reader', selectedID: 'tab-a' };
 const context = item => ({ dir: '/data/source-' + item.key, paperItem: item.parentItem, attachmentItem: item, reading: { type: 'book', title: item.parentItem.title } });
 p.renderContent = async (doc, body, item, boundReader) => {
  const root = body.querySelector('.abstractin-root'), input = root.querySelector('.abstractin-input'), logEl = root.querySelector('.abstractin-log');
  const ctx = await p.readingLayoutContext(context(item), boundReader);
  p._views.set(root, { root, input, doc, logEl, ctx });
 };
 await p.openReaderPanel(reader);
 const panel = p.readerPanelState(win), entry = panel.views.get(reader); await entry.render;
 files.set('/data/source-' + a.pdf.key + '/chat.json', JSON.stringify([{ role: 'user', text: 'Explain A' }, { role: 'assistant', text: 'Original answer' }]));
 const layout = await p.openReadingLayout(panel, entry, reader);
 const dispose = () => { p.disposeReadingLayout(layout); win.close(); };
 return { ...env, p, win, doc, layout, files, items, collections, Item, Collection, a, b, reader, panel, dispose };
}

test('one-source docking preserves native reader and both independent discussion scopes', async () => {
 const { p, layout, doc, a, collections, files, dispose } = await setup();
 assert.ok(doc.querySelector('#native-reader'));
 assert.equal(layout.note.parentID, a.id); assert.equal(collections.size, 0);
 assert.ok(![...files.keys()].some(path => path.includes('/workspaces/')));
 assert.equal(layout.surfaces.size, 3);
 assert.notEqual(layout.noteState.chatView.ctx.dir, layout.readingContext.dir);
 assert.equal(layout.surfaces.get('editor').content.contains(layout.noteState.editor), true);
 assert.equal(p.readingLayoutPanels(layout.groups.get('main').tree).join(','), 'editor,reading,notes');
 assert.equal(layout.noteState.editor.querySelector('.abstractin-note-source-control'), null, 'a docked note cannot maintain a separate source list');
 dispose();
});

test('drag docking rearranges panels without rebuilding editor or losing its input', async () => {
 const { p, layout, dispose } = await setup();
 const input = layout.noteState.input; input.value = 'Unsaved text';
 await p.moveReadingSurface(layout, 'notes', 'main', 'editor', 'bottom');
 assert.equal(layout.noteState.input, input); assert.equal(input.value, 'Unsaved text');
 assert.deepEqual([...p.readingLayoutPanels(layout.groups.get('main').tree)].sort(), ['editor', 'notes', 'reading']);
 const reading = layout.surfaces.get('reading').node;
 assert.equal(reading.style.height, '100%');
 dispose();
});

test('cross-window panels can join, retain note and chat drafts, and dock back', async () => {
 const { p, layout, win, dispose } = await setup();
 const floating = new JSDOM('<main id="float"></main>', { url: 'http://localhost/' });
 const group = { id: 'float', win: floating.window, host: floating.window.document.getElementById('float'), tree: null };
 layout.groups.set(group.id, group);
 layout.noteState.input.value = '# Exact **Markdown**'; layout.noteState.input.dispatchEvent(new win.Event('input'));
 layout.noteState.chatView.input.value = 'Unsent note question';
 await p.moveReadingSurface(layout, 'editor', 'float');
 assert.equal(layout.noteState.input.value, '# Exact **Markdown**');
 assert.equal(layout.noteState.chatView.input.value, 'Unsent note question');
 assert.equal(layout.noteState.input.ownerDocument, floating.window.document);
 await p.moveReadingSurface(layout, 'notes', 'float', 'editor', 'right');
 assert.equal(layout.noteState.chatView.doc, floating.window.document);
 await p.moveReadingSurface(layout, 'reading', 'float', 'notes', 'bottom');
 assert.equal(layout.entry.root.ownerDocument, floating.window.document);
 await p.moveReadingSurface(layout, 'editor', 'main');
 await p.moveReadingSurface(layout, 'notes', 'main');
 await p.moveReadingSurface(layout, 'reading', 'main');
 assert.equal(layout.groups.has('float'), false);
 assert.equal(layout.noteState.input.value, '# Exact **Markdown**');
 assert.equal(layout.noteState.chatView.input.value, 'Unsent note question');
 dispose();
});

test('a native detached PDF window does not relocate any plugin surface or change the selected source', async () => {
 const { p, layout, a, dispose } = await setup();
 const another = new JSDOM('<main/>');
 const root = layout.entry.root, input = layout.noteState.input, reader = layout.reader;
 another.window.focus = () => {};
 await p.openReaderPanel({ type: 'pdf', itemID: a.pdf.id, _window: another.window });
 assert.equal(layout.entry.root, root); assert.equal(layout.noteState.input, input); assert.equal(layout.reader, reader);
 another.window.close(); dispose();
});

test('second source creates a child collection and shared history without changing unrelated notes', async () => {
 const { p, layout, a, b, Collection, Item, files, dispose } = await setup();
 const parent = new Collection(); parent.name = 'Research'; await parent.saveTx();
 const unrelated = new Item('note'); unrelated.parentID = a.id; unrelated.setNote('<p>Unrelated note</p>');
 const original = files.get(layout.readingContext.dir + '/chat.json');
 await p.updateReadingSources(layout, [p.noteDocumentRef(a), p.noteDocumentRef(b)], { name: 'Compare models', parentCollectionID: parent.id });
 const collection = layout.workspace.collectionID;
 assert.ok(collection); assert.equal(layout.note.parentID, false);
 assert.ok(a.collections.includes(collection)); assert.ok(b.collections.includes(collection)); assert.ok(layout.note.collections.includes(collection));
 assert.equal(unrelated.parentID, a.id); assert.equal(unrelated.getNote(), '<p>Unrelated note</p>');
 assert.equal(files.get('/data/source-' + a.pdf.key + '/chat.json'), original);
 assert.equal(p.markdownNoteData(layout.note).workspace.id, layout.workspace.id);
 assert.equal(layout.readingContext.readingWorkspace.id, layout.workspace.id);
 assert.equal((await p.loadHistory(layout.readingContext.dir))[1].text, 'Original answer');
 assert.equal(layout.noteState.documents.length, 2);
 assert.equal(layout.noteState.chatView.ctx.noteState.documents.length, 2);
 const readerB = { ...layout.reader, itemID: b.pdf.id, tabID: 'tab-b' };
 const sharedDir = layout.readingContext.dir;
 await p.openReaderPanel(readerB);
 assert.equal(layout.readingContext.paperItem.key, b.key); assert.equal(layout.readingContext.dir, sharedDir);
 assert.equal((await p.loadHistory(sharedDir))[1].text, 'Original answer');
 await p.updateReadingSources(layout, [p.noteDocumentRef(b)]);
 assert.equal(layout.workspace.collectionID, collection, 'an established workspace does not downgrade when one source remains');
 assert.equal(layout.note.parentID, false); assert.equal(a.collections.includes(collection), false); assert.equal(b.collections.includes(collection), true);
 dispose();
});

test('a running reading turn keeps its document binding when another workspace PDF is opened', async () => {
 const { p, layout, a, b, reader, dispose } = await setup();
 p._readingLayoutReaders.set(b.pdf.id, layout);
 const root = layout.entry.root;
 p._pending.set(layout.readingContext.dir, { cancel() {} });
 await p.openReaderPanel({ ...reader, itemID: b.pdf.id, tabID: 'tab-b' });
 assert.equal(layout.entry.root, root); assert.equal(layout.reader.itemID, a.pdf.id);
 p._pending.clear(); dispose();
});

test('remounting reading discussion finishes while its streamed answer is still pending', async () => {
 const { p, layout, dispose } = await setup();
 const render = p.renderContent; let finish;
 const answer = new Promise(resolve => { finish = resolve; });
 p.renderContent = async (...args) => {
  await render(...args);
  const root = args[1].querySelector('.abstractin-root'); root._readingLayoutReady?.(p._views.get(root));
  await answer;
 };
 let timeout;
 try {
  await Promise.race([p.refreshLayoutReading(layout), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Panel move waited for the answer')), 1000); })]);
  assert.ok(p._views.get(layout.entry.root));
 } finally { clearTimeout(timeout); finish(); dispose(); }
});

test('source validation runs before collection creation or note migration', async () => {
 const { p, layout, a, b, collections, dispose } = await setup(); b.pdf = null;
 await assert.rejects(p.updateReadingSources(layout, [p.noteDocumentRef(a), p.noteDocumentRef(b)], { name: 'Invalid' }), /with a PDF/);
 assert.equal(collections.size, 0); assert.equal(layout.workspace, null); assert.equal(layout.note.parentID, a.id);
 dispose();
});

test('closing the native reader snapshots an unsaved docked note before disposing its editor', async () => {
 const { p, layout, win, dispose } = await setup();
 layout.noteState.input.value = 'Last keystroke before the tab closes';
 layout.noteState.input.dispatchEvent(new win.Event('input'));
 p.disposeReadingLayout(layout);
 await Promise.all([...p._readingLayoutSaves]);
 assert.equal(p.markdownNoteData(layout.note).markdown, 'Last keystroke before the tab closes');
 dispose();
});

test('docked note stylesheet cannot target native html/body or the document root', () => {
 const css = readFileSync(new URL('../src/content/reading-note.css', import.meta.url), 'utf8');
 assert.doesNotMatch(css, /(^|[\n{},])\s*(?:html|body|:root)\b/);
 assert.doesNotMatch(css, /^\[hidden\]/m);
});
