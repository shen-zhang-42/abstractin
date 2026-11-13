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
 win.Zotero.Search = class {
  constructor() { this.conditions = []; }
  addCondition(field, operator, value) { this.conditions.push([field, operator, value]); }
  async search() { return [...items.values()].filter(item => item.libraryID === this.libraryID && this.conditions.every(([field, operator, value]) =>
   field === 'itemType' ? item.itemType === value : field === 'tag' ? item.tags.includes(value) : true)).map(item => item.id); }
 };
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
 await p.moveReadingSurface(layout, 'notes', 'main', 'reading', 'bottom');
 assert.equal(layout.noteState.input, input); assert.equal(input.value, 'Unsaved text');
 assert.deepEqual([...p.readingLayoutPanels(layout.groups.get('main').tree)].sort(), ['editor', 'notes', 'reading']);
 const reading = layout.surfaces.get('reading').node;
 assert.equal(reading.style.width, '100%');
 assert.equal(layout.surfaces.get('editor').node.style.top, layout.surfaces.get('notes').node.style.top);
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
 assert.equal(layout.surfaces.get('notes').group, 'float', 'note discussion follows the editor into the same window');
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

test('reading-only and four-panel presets hide and restore the note pair without changing its history', async () => {
 const { p, layout, dispose } = await setup();
 const input = layout.noteState.input, discussion = layout.noteState.chatView.ctx.dir;
 await p.applyReadingLayoutPreset(layout, 'reading');
 assert.equal(layout.surfaces.get('editor').node.hidden, true); assert.equal(layout.surfaces.get('notes').node.hidden, true);
 assert.equal(layout.surfaces.get('reading').node.hidden, false);
 await p.applyReadingLayoutPreset(layout, 'stacked');
 assert.equal(layout.surfaces.get('editor').node.hidden, false); assert.equal(layout.surfaces.get('notes').node.hidden, false);
 assert.equal(layout.noteState.input, input); assert.equal(layout.noteState.chatView.ctx.dir, discussion);
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

test('keeping a recovery draft closes only the docked workspace, never the Zotero window', async () => {
 const { p, layout, win, files, dispose } = await setup();
 let mainClosed = false, workspaceClosed = false;
 const close = win.close.bind(win); win.close = () => { mainClosed = true; };
 p.closeReadingLayout = async (target, options) => { assert.equal(target, layout); assert.equal(options.discard, true); workspaceClosed = true; };
 layout.noteState.input.value = 'Keep this local draft';
 const button = [...layout.noteState.editor.querySelectorAll('button')].find(button => button.textContent === 'Close keeping local draft');
 await button.onclick();
 assert.equal(mainClosed, false); assert.equal(workspaceClosed, true);
 assert.equal(JSON.parse(files.get(layout.noteState.dir + '/draft.json')).markdown, 'Keep this local draft');
 dispose(); close();
});

test('docked note stylesheet cannot target native html/body or the document root', () => {
 const css = readFileSync(new URL('../src/content/reading-note.css', import.meta.url), 'utf8');
 assert.doesNotMatch(css, /(^|[\n{},])\s*(?:html|body|:root)\b/);
 assert.doesNotMatch(css, /^\[hidden\]/m);
});

test('four columns place reading discussion before the linked note and note discussion', async () => {
 const {p,layout,dispose}=await setup();await p.applyReadingLayoutPreset(layout,'columns');
 assert.deepEqual([...p.readingLayoutPanels(layout.groups.get('main').tree)],['reading','editor','notes']);
 assert.deepEqual([...p.READING_LAYOUTS.find(preset=>preset.id==='columns').boxes.map(box=>box[4])],['PDF','Read','Note','Chat']);
 dispose();
});

test('Save is followed by New note and Open note and each note retains its own text, history and draft', async () => {
 const {p,layout,win,a,dispose}=await setup();
 const first=layout.note,firstState=layout.noteState,readingRoot=layout.entry.root,readingDir=layout.readingContext.dir;
 const buttons=[...firstState.editor.querySelector('.abstractin-note-file-actions').children].filter(node=>node.tagName==='BUTTON');
 assert.deepEqual(buttons.slice(0,3).map(button=>button.getAttribute('aria-label')),['Save note','New note','Open note']);
 assert.ok(!buttons.some(button=>/Sources?/.test(button.textContent)));
 firstState.input.value='# First note';firstState.input.dispatchEvent(new win.Event('input'));
 firstState.chatView.input.value='Unsent first question';
 const firstDir=firstState.chatView.ctx.dir;await p.saveHistory(firstDir,[{role:'user',text:'First question'},{role:'assistant',text:'First answer'}]);
 const second=await p.newReadingNote(layout),secondState=layout.noteState,secondDir=secondState.chatView.ctx.dir;
 assert.notEqual(second.key,first.key);assert.equal(second.parentID,a.id);assert.equal(secondState.input.value,'');
 assert.equal(p.markdownNoteData(first).markdown,'# First note');assert.notEqual(secondDir,firstDir);
 assert.equal((await p.loadHistory(secondDir)).length,0);
 secondState.input.value='# Second note';secondState.input.dispatchEvent(new win.Event('input'));
 secondState.chatView.input.value='Unsent second question';
 await p.saveHistory(secondDir,[{role:'user',text:'Second question'},{role:'assistant',text:'Second answer'}]);
 await p.switchReadingNote(layout,first);
 assert.equal(layout.noteState.input.value,'# First note');assert.equal(layout.noteState.chatView.input.value,'Unsent first question');
 assert.equal((await p.loadHistory(layout.noteState.chatView.ctx.dir))[1].text,'First answer');
 await p.switchReadingNote(layout,second);
 assert.equal(layout.noteState.input.value,'# Second note');assert.equal(layout.noteState.chatView.input.value,'Unsent second question');
 assert.equal((await p.loadHistory(secondDir))[1].text,'Second answer');
 assert.equal(layout.entry.root,readingRoot);assert.equal(layout.readingContext.dir,readingDir);
 dispose();
});

test('Open note lists only current-document notes and opens the selected note',async()=>{
 const {p,layout,a,b,Item,dispose}=await setup();
 const first=layout.note,second=await p.newReadingNote(layout);
 const other=new Item('note');other.parentID=b.id;other.addTag('AbstractIn:Markdown');other.setNote(p.markdownNoteHTML(other,'Other document','Other',b,Date.now(),[p.noteDocumentRef(b)]));await other.saveTx();
 const button=layout.noteState.editor.querySelector('.abstractin-note-open');await button.onclick();
 const picker=layout.noteState.notePicker,keys=[...picker.querySelectorAll('[data-note-key]')].map(node=>node.dataset.noteKey);
 assert.ok(keys.includes(first.key)&&keys.includes(second.key));assert.ok(!keys.includes(other.key));
 await picker.querySelector('[data-note-key="'+first.key+'"]').onclick();
 assert.equal(layout.note.key,first.key);assert.equal(layout.note.parentID,a.id);assert.equal(picker.isConnected,false);
 dispose();
});

test('workspace notes share sources and collection while their discussion directories remain distinct',async()=>{
 const {p,layout,a,b,Item,files,dispose}=await setup();
 await p.updateReadingSources(layout,[p.noteDocumentRef(a),p.noteDocumentRef(b)],{name:'Shared problem'});
 const first=layout.note,workspaceID=layout.workspace.id,readingDir=layout.readingContext.dir;
 const second=await p.newReadingNote(layout),secondDir=layout.noteState.chatView.ctx.dir;
 assert.ok(second.collections.includes(layout.workspace.collectionID));assert.ok(!second.parentID);
 assert.equal(p.markdownNoteData(second).workspace.id,workspaceID);
 const c=new Item('book');c.title='Source C';c.pdf=new Item('attachment');c.pdf.parentItem=c;c.pdf.parentID=c.id;
 await p.updateReadingSources(layout,[p.noteDocumentRef(a),p.noteDocumentRef(b),p.noteDocumentRef(c)]);
 for(const note of [first,second]) assert.deepEqual([...p.markdownNoteData(note).documents.map(ref=>ref.key)],[a.key,b.key,c.key]);
 const manifest=JSON.parse(files.get(p.readingWorkspaceDir(first.libraryID,workspaceID)+'/workspace.json'));
 assert.equal(manifest.noteKey,workspaceID);assert.ok(manifest.noteKeys.includes(first.key)&&manifest.noteKeys.includes(second.key));
 await p.switchReadingNote(layout,first);
 assert.notEqual(layout.noteState.chatView.ctx.dir,secondDir);assert.equal(layout.readingContext.dir,readingDir);
 assert.equal(layout.workspace.id,workspaceID);
 dispose();
});

test('a failed save leaves the current note active and prevents creating a second note',async()=>{
 const {p,layout,win,items,dispose}=await setup();
 const first=layout.note,count=items.size,save=first.saveTx;
 layout.noteState.input.value='Unsaved';layout.noteState.input.dispatchEvent(new win.Event('input'));
 first.saveTx=async()=>{throw new Error('Save failed');};
 await assert.rejects(p.newReadingNote(layout),/Save failed/);
 assert.equal(layout.note.key,first.key);assert.equal(items.size,count);assert.equal(layout.noteCreating,false);
 first.saveTx=save;dispose();
});

test('panel actions share their title row and settings appear only in the global toolbar', async () => {
 const {p,layout,doc,dispose}=await setup();
 assert.equal(layout.shell.querySelectorAll('.abstractin-global-settings').length,1);
 assert.equal(layout.shell.querySelectorAll('.abstractin-open-settings,.abstractin-layout-open').length,0);
 for(const surface of layout.surfaces.values()) {
  assert.equal(surface.node.querySelectorAll('.abstractin-dock-header').length,1);
  assert.equal(surface.moveButton.closest('.abstractin-dock-header'),surface.header);
 }
 assert.ok(layout.surfaces.get('editor').header.contains(layout.noteState.saveButton));
 assert.ok(layout.surfaces.get('editor').header.contains(layout.noteState.title));
 for(const root of [layout.entry.root,layout.noteState.chatView.root]) {
  p.renderPaperChip(root,{label:'Duplicate source'});
  assert.equal(root.querySelector('.abstractin-context').hidden,true);
  assert.equal(root.querySelector('.abstractin-context').children.length,0);
  assert.ok(root.querySelector('.abstractin-composer .abstractin-model-btn'));
 }
 const select=layout.noteState.assistantMode;
 select.parentElement.querySelector('.abstractin-panel-choice').click();
 const edit=[...doc.querySelectorAll('.abstractin-panel-choice-menu button')].find(button=>button.textContent==='Edit note');
 edit.click();assert.equal(select.value,'edit');assert.equal(doc.querySelector('.abstractin-panel-choice-menu'),null);
 dispose();
});

test('Hide and Show notes restore custom split ratios and sidebar width without remounting docked input', async () => {
 const {p,layout,dispose}=await setup();
 await p.applyReadingLayoutPreset(layout,'columns');layout.groups.get('main').tree.ratio=.37;
 layout.panelState.panel.style.width='1123px';
 const tree=JSON.stringify(layout.groups.get('main').tree),input=layout.noteState.input;
 layout.noteState.chatView.input.value='Keep this draft';
 await p.toggleReadingNotes(layout,false);
 assert.equal(layout.noteToggle.title,'Show notes');assert.equal(layout.surfaces.get('editor').node.hidden,true);
 await p.toggleReadingNotes(layout,true);
 assert.equal(layout.noteToggle.title,'Hide notes');assert.equal(JSON.stringify(layout.groups.get('main').tree),tree);
 assert.equal(layout.panelState.panel.style.width,'1123px');assert.equal(layout.noteState.input,input);
 assert.equal(layout.noteState.chatView.input.value,'Keep this draft');
 dispose();
});

test('Hide and Show notes restore floating geometry, linked panels and unsent discussion drafts', async () => {
 const {p,layout,win,dispose}=await setup();
 const floating=new JSDOM('<main id="float"></main>',{url:'http://localhost/'});
 floating.window.outerWidth=930;floating.window.outerHeight=720;floating.window.screenX=100;floating.window.screenY=80;
 layout.groups.set('float',{id:'float',win:floating.window,host:floating.window.document.getElementById('float'),tree:null});
 await p.moveReadingSurface(layout,'editor','float');
 layout.groups.get('float').tree.ratio=.67;layout.noteState.chatView.input.value='A floating draft';
 const tree=JSON.stringify(layout.groups.get('float').tree);
 await p.toggleReadingNotes(layout,false);assert.equal(layout.groups.has('float'),false);
 const windows=[];
 win.openDialog=(url,name,features,args)=>{
  const env=new JSDOM('<main id="abstractin-floating-root"></main>',{url:'http://localhost/'}),w=env.window;
  w.resizeTo=(width,height)=>{w.outerWidth=width;w.outerHeight=height;};w.moveTo=(left,top)=>{w.screenX=left;w.screenY=top;};
  windows.push(w);queueMicrotask(()=>p.mountReadingGroup(layout,args.groupID,w));return w;
 };
 await p.toggleReadingNotes(layout,true);
 for(let i=0;i<60&&layout.restoring;i++) await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(layout.restoring,false);
 const group=layout.groups.get(layout.surfaces.get('editor').group);
 assert.notEqual(group.id,'main');assert.equal(layout.surfaces.get('notes').group,group.id);
 assert.equal(JSON.stringify(group.tree),tree);
 assert.deepEqual([group.win.outerWidth,group.win.outerHeight,group.win.screenX,group.win.screenY],[930,720,100,80]);
 assert.equal(layout.noteState.chatView.input.value,'A floating draft');
 assert.ok(layout.surfaces.get('editor').header.contains(layout.noteState.saveButton));
 dispose();for(const w of windows) w.close();
});
