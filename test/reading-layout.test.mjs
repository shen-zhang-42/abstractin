import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadPlugin } from './load-plugin.mjs';

async function setup({ initialPreset = 'unified', coldStart = false, beforeOpen = null } = {}) {
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
 p.prepareReadingSkills = async ctx => ({...ctx.reading,skillPath:'/bundled/reading/SKILL.md'});
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
 beforeOpen?.({ ...env, p, win, reader, a });
 files.set('/data/source-' + a.pdf.key + '/chat.json', JSON.stringify([{ role: 'user', text: 'Explain A' }, { role: 'assistant', text: 'Original answer' }]));
 if (!coldStart) {
  await p.openReaderPanel(reader);
  await p.readerPanelState(win).views.get(reader).render;
 }
 if (initialPreset) await p.startReadingLayout(win, initialPreset, reader);
 const panel = p.readerPanelState(win), entry = panel.views.get(reader);
 const layout = initialPreset ? entry.layout : await p.openReadingLayout(panel, entry, reader);
 const dispose = () => { if (layout) p.disposeReadingLayout(layout); win.close(); };
 return { ...env, p, win, doc, layout, files, items, collections, Item, Collection, a, b, reader, panel, dispose };
}

for (const preset of ['unified', 'reading']) test('cold '+preset+' launch never exposes the legacy panel while context, note and preset load', async()=>{
 const stages=[];
 const env=await setup({initialPreset:preset,coldStart:true,beforeOpen({p,win,reader}){
  const assertPreparing=name=>{
   const entry=p.readerPanelState(win).views.get(reader);
   assert.equal(entry.body.style.visibility,'hidden',name);assert.equal(entry.body.getAttribute('aria-busy'),'true');
   assert.equal(entry.openingLayout.loading.style.visibility,'visible');assert.equal(entry.globalToolbar,undefined);
   stages.push(name);return entry;
  };
  const render=p.renderContent,mount=p.mountLayoutNote,apply=p.applyReadingLayoutPreset,reveal=p.revealReadingLayoutEntry;
  p.renderContent=async(...args)=>{assertPreparing('context');await new Promise(resolve=>win.setTimeout(resolve,0));return render.apply(p,args);};
  p.mountLayoutNote=async layout=>{assertPreparing('note');await mount.call(p,layout);assertPreparing('note-ready');};
  p.applyReadingLayoutPreset=async(...args)=>{assertPreparing('preset');await apply.apply(p,args);assertPreparing('preset-ready');};
  p.revealReadingLayoutEntry=entry=>{
   if(entry?.openingLayout){assert.ok(entry.layout.shell);assert.ok(entry.layout.surfaces.get('reading').content.contains(entry.root));assert.equal(!!entry.layout.notesHidden,preset==='reading');}
   return reveal.call(p,entry);
  };
 }});
 assert.deepEqual(stages,['context','note','note-ready','preset','preset-ready']);
 assert.equal(env.layout.entry.body.style.visibility,'');assert.equal(env.layout.entry.body.hasAttribute('aria-busy'),false);
 assert.equal(env.doc.querySelector('.abstractin-layout-loading'),null);env.dispose();
});

test('failed layout preparation removes the loading cover and exposes the recoverable error state',async()=>{
 let captured;
 await assert.rejects(setup({coldStart:true,beforeOpen(env){captured=env;env.p.mountLayoutNote=async()=>{throw new Error('Simulated note load failure');};}}),/Simulated note load failure/);
 const {p,win,reader}=captured,entry=p.readerPanelState(win).views.get(reader);
 assert.equal(entry.openingLayout,undefined);assert.equal(entry.body.style.visibility,'');assert.equal(entry.body.hasAttribute('aria-busy'),false);
 if(entry.layout)p.disposeReadingLayout(entry.layout);win.close();
});

test('a cold layout becomes visible without waiting for a resumed answer to finish',async()=>{
 let finish;
 const answer=new Promise(resolve=>{finish=resolve;});
 const opened=setup({coldStart:true,beforeOpen({p}){
  const render=p.renderContent;
  p.renderContent=async(...args)=>{await render.apply(p,args);const root=args[1].querySelector('.abstractin-root');root._readingLayoutReady?.(p._views.get(root));await answer;};
 }});
 let timer;
 try {
  const env=await Promise.race([opened,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Layout waited for the answer')),1500);})]);
  assert.equal(env.layout.entry.body.style.visibility,'');assert.ok(env.layout.shell);finish();env.dispose();
 }finally{clearTimeout(timer);finish();}
});

test('the default layout has one shared discussion and restores it after hiding notes', async () => {
 const {p,layout,dispose}=await setup({initialPreset:null});
 assert.deepEqual([...p.readingLayoutPanels(layout.groups.get('main').tree)],['editor','reading']);
 assert.equal(layout.surfaces.has('notes'),false);assert.equal(layout.noteState.chatView,null);
 assert.equal(p.READING_LAYOUTS[0].id,'unified');
 await p.toggleReadingNotes(layout,false); await p.toggleReadingNotes(layout,true);
 assert.deepEqual([...p.readingLayoutPanels(layout.groups.get('main').tree)],['editor','reading']);
 assert.equal(layout.surfaces.has('notes'),false);
 assert.equal(layout.surfaces.get('reading').label.textContent,'Discussion');
 p.saveReadingDockLayout(layout);
 assert.deepEqual([...p.readingLayoutPanels(p.getJSONPref('readingDockLayout',null))],['editor','reading']);
 assert.equal(p.getJSONPref('readingDockGroups',null).flatMap(group=>p.readingLayoutPanels(group.tree)).length,2);
 dispose();
});

test('new chat windows share the source store but start with empty histories, sessions and drafts',async()=>{
 const {p,layout,win,a,dispose}=await setup();
 const original=p._views.get(layout.entry.root);original.ctx=await p.ensureDiscussion(original.ctx);layout.readingContext=original.ctx;
 await p.saveHistory(original.ctx.dir,[{role:'user',text:'Original private question'},{role:'assistant',text:'Original private answer'}]);
 await p.saveSessions(original.ctx.dir,{codex:{id:'original-agent-thread'}});original.input.value='Unsent original draft';
 original.ctx.reading.knowledgeContext='Transient original context';original.ctx.reading.sourceSearchHistory=['old search'];
 const windows=[],mounts=[];
 win.openDialog=(url,name,features,args)=>{
  assert.ok(url.endsWith('chat-window.xhtml'));
  const dom=new JSDOM('<main id="abstractin-chat-window-root"></main>'),w=dom.window;w.focus=()=>{};windows.push(w);
  queueMicrotask(()=>mounts.push(p.mountChatWindow(p._chatWindows.get(args.chatWindowID),w)));return w;
 };
 try{
  const first=await p.openNewChatWindow({view:original}),second=await p.openNewChatWindow({view:original});await Promise.all(mounts);
  assert.notEqual(first.view.ctx.dir,second.view.ctx.dir);assert.notEqual(first.view.ctx.dir,original.ctx.dir);
  assert.equal(p.discussionRoot(first.view.ctx),p.discussionRoot(original.ctx));assert.equal(first.view.ctx.paperItem.key,a.key);
  for(const state of [first,second]){
   assert.equal((await p.loadHistory(state.view.ctx.dir)).length,0);assert.equal(Object.keys(await p.loadSessions(state.view.ctx.dir)).length,0);
   assert.equal(state.view.input.value,'');assert.equal(state.view.ctx.reading.knowledgeContext,undefined);assert.equal(state.view.ctx.reading.sourceSearchHistory,undefined);
  }
  const firstID=first.view.ctx.discussion.id,secondID=second.view.ctx.discussion.id,originalID=original.ctx.discussion.id;
  await p.newChat(first.view.root);
  assert.notEqual(first.view.ctx.discussion.id,firstID);assert.equal(original.ctx.discussion.id,originalID);assert.equal(second.view.ctx.discussion.id,secondID);
  assert.equal((await p.discussionIndex(original.ctx)).active,originalID);
  assert.equal(p._activeDiscussionDirs.get(p.discussionRoot(original.ctx)),original.ctx.dir);
  assert.equal(original.input.value,'Unsent original draft');
  await p.newChat(original.root);assert.equal(second.view.ctx.discussion.id,secondID);
  let cancelled=0;p._pending.set(original.ctx.dir,{cancel(){throw new Error('Another window was cancelled');}});
  p.setPref('documentNoteSaveModes',JSON.stringify({[p.noteDocumentKey(first.view.ctx)]:'none'}));
  p._noteLiveHistories.set(first.view.ctx.dir,[{role:'assistant',text:'First volatile answer'}]);p._noteLiveHistories.set(second.view.ctx.dir,[{role:'assistant',text:'Second volatile answer'}]);
  p._pending.set(first.view.ctx.dir,{cancel(){cancelled++;}});first.dispose();assert.equal(cancelled,1);assert.ok(p._views.has(second.view.root));
  assert.equal(p._noteLiveHistories.has(first.view.ctx.dir),false);assert.equal(p._noteLiveHistories.has(second.view.ctx.dir),true);
  p._pending.clear();second.dispose();
 }finally{for(const state of [...p._chatWindows.values()])state.dispose?.();for(const w of windows)w.close();dispose();}
});

test('a new workspace conversation keeps workspace membership and cannot auto-route into another chat',async()=>{
 const {p,layout,win,a,b,dispose}=await setup();
 await p.updateReadingSources(layout,[p.noteDocumentRef(a),p.noteDocumentRef(b)],{name:'Workspace chats'});
 const original=p._views.get(layout.entry.root),windows=[],mounts=[];
 win.openDialog=(url,name,features,args)=>{const dom=new JSDOM('<main id="abstractin-chat-window-root"></main>'),w=dom.window;w.focus=()=>{};windows.push(w);queueMicrotask(()=>mounts.push(p.mountChatWindow(p._chatWindows.get(args.chatWindowID),w)));return w;};
 try{
  const fresh=await p.openNewChatWindow({view:original});await Promise.all(mounts);
  assert.equal(fresh.view.ctx.readingWorkspace.id,layout.workspace.id);
  assert.equal(p.discussionRoot(fresh.view.ctx),p.discussionRoot(original.ctx));
  assert.deepEqual([...fresh.view.ctx.workspaceDocuments.map(ref=>ref.key)],[a.key,b.key]);
  const id=fresh.view.ctx.discussion.id;
  p.resolveDiscussionChapter=()=>({chapterID:'another-chapter'});
  let answered;p.ask=async(ctx,question)=>{answered={dir:ctx.dir,id:ctx.discussion.id,question};p._pending.delete(ctx.dir);return {};};
  await p.startRequest(fresh.view,'Chapter 99: discuss this independently');
  const pending=p._pending.get(fresh.view.ctx.dir);if(pending)await pending.promise;
  assert.equal(answered.id,id);assert.equal(answered.dir,fresh.view.ctx.dir);assert.equal(fresh.view.ctx.discussion.id,id);
  fresh.dispose();p._pending.clear();
 }finally{for(const state of [...p._chatWindows.values()])state.dispose?.();for(const w of windows)w.close();dispose();}
});

test('moving the default note into a window does not open a second chat',async()=>{
 const {p,layout,dispose}=await setup({initialPreset:null});
 const floating=new JSDOM('<main id="float"></main>',{url:'http://localhost/'});
 layout.groups.set('float',{id:'float',win:floating.window,host:floating.window.document.getElementById('float'),tree:null});
 await p.moveReadingSurface(layout,'editor','float');
 assert.equal(layout.surfaces.get('editor').group,'float');assert.equal(layout.surfaces.get('reading').group,'main');
 assert.equal(layout.surfaces.has('notes'),false);
 assert.equal(p.getJSONPref('readingDockGroups',[]).flatMap(group=>p.readingLayoutPanels(group.tree)).length,2);
 await p.moveReadingSurface(layout,'editor','main');assert.equal(layout.surfaces.has('notes'),false);
 dispose();floating.window.close();
});

test('opening reading-only directly matches hiding the editor in the shared layout', async () => {
 const direct = await setup({ initialPreset: 'reading' });
 const switched = await setup({ initialPreset: 'unified' });
 try {
  assert.ok(direct.layout, 'reading-only startup must mount the shared panel layout');
  await switched.p.applyReadingLayoutPreset(switched.layout, 'reading');
  const display = ({ layout, p }) => ({
   notesHidden: layout.notesHidden,
   visiblePanels: [...layout.surfaces.values()].filter(surface => !surface.node.hidden).map(surface => surface.id),
   tree: [...p.readingLayoutPanels(layout.groups.get('main').tree)],
   mode: layout.title.title,
   actions: [...layout.toolbar.querySelectorAll('button')].map(button => button.className),
   header: layout.entry.root.querySelector('.abstractin-header').className,
   sharedSources: layout.entry.root.dataset.sharedSources,
   neutralTheme: layout.entry.root.dataset.readingTheme,
   oldToolbar: !!layout.entry.globalToolbar,
   panelClass: layout.panelState.panel.className
  });
  assert.deepEqual(display(direct), display(switched));
  assert.equal(direct.layout.noteToggle.title, 'Show notes');
  assert.equal(direct.layout.surfaces.get('reading').header.contains(direct.layout.entry.root.querySelector('.abstractin-chats')), true);
 } finally { direct.dispose(); switched.dispose(); }
});

test('one-source docking preserves the native reader and does not create a note chat', async () => {
 const { p, layout, doc, a, collections, files, dispose } = await setup();
 assert.ok(doc.querySelector('#native-reader'));
 assert.equal(layout.note.parentID, a.id); assert.equal(collections.size, 0);
 assert.ok(![...files.keys()].some(path => path.includes('/workspaces/')));
 assert.equal(layout.surfaces.size, 2);
 assert.equal(layout.noteState.chatView, null);
 assert.equal(layout.surfaces.get('editor').content.contains(layout.noteState.editor), true);
 assert.equal(p.readingLayoutPanels(layout.groups.get('main').tree).join(','), 'editor,reading');
 assert.equal(layout.noteState.editor.querySelector('.abstractin-note-source-control'), null, 'a docked note cannot maintain a separate source list');
 dispose();
});

test('drag docking rearranges panels without rebuilding editor or losing its input', async () => {
 const { p, layout, dispose } = await setup();
 const input = layout.noteState.input; input.value = 'Unsaved text';
 await p.moveReadingSurface(layout, 'editor', 'main', 'reading', 'bottom');
 assert.equal(layout.noteState.input, input); assert.equal(input.value, 'Unsaved text');
 assert.deepEqual([...p.readingLayoutPanels(layout.groups.get('main').tree)].sort(), ['editor', 'reading']);
 const reading = layout.surfaces.get('reading').node;
 assert.equal(reading.style.width, '100%');
 assert.notEqual(layout.surfaces.get('editor').node.style.top, reading.style.top);
 dispose();
});

test('cross-window panels can join, retain note and chat drafts, and dock back', async () => {
 const { p, layout, win, dispose } = await setup();
 const floating = new JSDOM('<main id="float"></main>', { url: 'http://localhost/' });
 const group = { id: 'float', win: floating.window, host: floating.window.document.getElementById('float'), tree: null };
 layout.groups.set(group.id, group);
 layout.noteState.input.value = '# Exact **Markdown**'; layout.noteState.input.dispatchEvent(new win.Event('input'));
 p._views.get(layout.entry.root).input.value = 'Unsent question';
 await p.moveReadingSurface(layout, 'editor', 'float');
 assert.equal(layout.surfaces.get('reading').group, 'main', 'moving a note leaves the discussion in place');
 assert.equal(layout.noteState.input.value, '# Exact **Markdown**');
 assert.equal(p._views.get(layout.entry.root).input.value, 'Unsent question');
 assert.equal(layout.noteState.input.ownerDocument, floating.window.document);
 await p.moveReadingSurface(layout, 'reading', 'float', 'editor', 'bottom');
 assert.equal(layout.entry.root.ownerDocument, floating.window.document);
 await p.moveReadingSurface(layout, 'editor', 'main');
 await p.moveReadingSurface(layout, 'reading', 'main');
 assert.equal(layout.groups.has('float'), false);
 assert.equal(layout.noteState.input.value, '# Exact **Markdown**');
 assert.equal(p._views.get(layout.entry.root).input.value, 'Unsent question');
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
 assert.equal(layout.noteState.chatView, null);
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

test('reading-only and shared presets hide and restore the editor without changing its history', async () => {
 const { p, layout, dispose } = await setup();
 const input = layout.noteState.input, discussion = layout.readingContext.dir;
 await p.applyReadingLayoutPreset(layout, 'reading');
 assert.equal(layout.surfaces.get('editor').node.hidden, true); assert.equal(layout.surfaces.has('notes'), false);
 assert.equal(layout.surfaces.get('reading').node.hidden, false);
 await p.applyReadingLayoutPreset(layout, 'unified');
 assert.equal(layout.surfaces.get('editor').node.hidden, false); assert.equal(layout.surfaces.has('notes'), false);
 assert.equal(layout.noteState.input, input); assert.equal(layout.readingContext.dir, discussion);
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

test('all four-panel presets are removed and cannot be selected programmatically', async () => {
 const {p,layout,dispose}=await setup();
 assert.deepEqual([...p.READING_LAYOUTS.map(preset=>preset.id)],['unified','reading','separate']);
 for(const name of ['columns','stacked'])await assert.rejects(p.applyReadingLayoutPreset(layout,name),/Unknown/);
 dispose();
});

test('Save is followed by New note and Open note and each note retains its own text, history and draft', async () => {
 const {p,layout,win,a,dispose}=await setup();
 const first=layout.note,firstState=layout.noteState,readingRoot=layout.entry.root,readingDir=layout.readingContext.dir;
 const buttons=[...firstState.editor.querySelector('.abstractin-note-file-actions').children].filter(node=>node.tagName==='BUTTON');
 assert.deepEqual(buttons.slice(0,3).map(button=>button.getAttribute('aria-label')),['Save note','New note','Open note']);
 assert.ok(!buttons.some(button=>/Sources?/.test(button.textContent)));
 firstState.input.value='# First note';firstState.input.dispatchEvent(new win.Event('input'));
 const firstDir=firstState.dir+'/discussion';await p.saveHistory(firstDir,[{role:'user',text:'First question'},{role:'assistant',text:'First answer'}]);
 const second=await p.newReadingNote(layout),secondState=layout.noteState,secondDir=secondState.dir+'/discussion';
 assert.notEqual(second.key,first.key);assert.equal(second.parentID,a.id);assert.equal(secondState.input.value,'');
 assert.equal(p.markdownNoteData(first).markdown,'# First note');assert.notEqual(secondDir,firstDir);
 assert.equal((await p.loadHistory(secondDir)).length,0);
 secondState.input.value='# Second note';secondState.input.dispatchEvent(new win.Event('input'));
 await p.saveHistory(secondDir,[{role:'user',text:'Second question'},{role:'assistant',text:'Second answer'}]);
 await p.switchReadingNote(layout,first);
 assert.equal(layout.noteState.input.value,'# First note');assert.equal(layout.noteState.chatView,null);
 assert.equal((await p.loadHistory(firstDir))[1].text,'First answer');
 await p.switchReadingNote(layout,second);
 assert.equal(layout.noteState.input.value,'# Second note');assert.equal(layout.noteState.chatView,null);
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
 const second=await p.newReadingNote(layout),secondDir=layout.noteState.dir;
 assert.ok(second.collections.includes(layout.workspace.collectionID));assert.ok(!second.parentID);
 assert.equal(p.markdownNoteData(second).workspace.id,workspaceID);
 const c=new Item('book');c.title='Source C';c.pdf=new Item('attachment');c.pdf.parentItem=c;c.pdf.parentID=c.id;
 await p.updateReadingSources(layout,[p.noteDocumentRef(a),p.noteDocumentRef(b),p.noteDocumentRef(c)]);
 for(const note of [first,second]) assert.deepEqual([...p.markdownNoteData(note).documents.map(ref=>ref.key)],[a.key,b.key,c.key]);
 const manifest=JSON.parse(files.get(p.readingWorkspaceDir(first.libraryID,workspaceID)+'/workspace.json'));
 assert.equal(manifest.noteKey,workspaceID);assert.ok(manifest.noteKeys.includes(first.key)&&manifest.noteKeys.includes(second.key));
 await p.switchReadingNote(layout,first);
 assert.notEqual(layout.noteState.dir,secondDir);assert.equal(layout.readingContext.dir,readingDir);
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
 for(const root of [layout.entry.root]) {
  p.renderPaperChip(root,{label:'Duplicate source'});
  assert.equal(root.querySelector('.abstractin-context').hidden,true);
  assert.equal(root.querySelector('.abstractin-context').children.length,0);
  assert.ok(root.querySelector('.abstractin-composer .abstractin-model-btn'));
 }
 assert.equal(layout.noteState.assistantMode,undefined);
 assert.equal(doc.querySelector('[aria-label="Note assistant action"]'),null);
 dispose();
});

test('Hide and Show notes restore custom split ratios and sidebar width without remounting docked input', async () => {
 const {p,layout,dispose}=await setup();
 await p.applyReadingLayoutPreset(layout,'unified');layout.groups.get('main').tree.ratio=.37;
 layout.panelState.panel.style.width='1123px';
 const tree=JSON.stringify(layout.groups.get('main').tree),input=layout.noteState.input;
 p._views.get(layout.entry.root).input.value='Keep this draft';
 await p.toggleReadingNotes(layout,false);
 assert.equal(layout.noteToggle.title,'Show notes');assert.equal(layout.surfaces.get('editor').node.hidden,true);
 await p.toggleReadingNotes(layout,true);
 assert.equal(layout.noteToggle.title,'Hide notes');assert.equal(JSON.stringify(layout.groups.get('main').tree),tree);
 assert.equal(layout.panelState.panel.style.width,'1123px');assert.equal(layout.noteState.input,input);
 assert.equal(p._views.get(layout.entry.root).input.value,'Keep this draft');
 dispose();
});

test('Formatting keeps iframe controls clickable when Gecko forwards their mousedown to chrome', async () => {
 const {layout,doc,win,dispose}=await setup(),state=layout.noteState;
 const frame=doc.createElement('iframe');frame.className='abstractin-note-rich-frame';state.editor.append(frame);
 const command=frame.contentDocument.createElement('button');frame.contentDocument.body.append(command);
 let executed=0,open=false;
 state.input._composerEditor={toggleToolbar(){open=!open;state.formatButton.setAttribute('aria-expanded',String(open));}};
 command.onclick=()=>{if(open) executed++;};
 const forwarded=target=>{const event=new win.MouseEvent('mousedown',{bubbles:true,button:0});Object.defineProperty(event,'target',{value:target});doc.dispatchEvent(event);};
 try {
  state.formatButton.click();assert.equal(open,true);
  forwarded(command);command.click();assert.equal(open,true);assert.equal(executed,1);
  forwarded(frame);assert.equal(open,true,'a retargeted iframe hit is also inside the editor');
  layout.entry.root.dispatchEvent(new win.MouseEvent('mousedown',{bubbles:true,button:0}));
  assert.equal(open,false,'a click outside the note editor still dismisses Formatting');
 } finally { delete state.input._composerEditor;dispose(); }
});

test('Hide and Show notes restore floating geometry, linked panels and unsent discussion drafts', async () => {
 const {p,layout,win,dispose}=await setup();
 const floating=new JSDOM('<main id="float"></main>',{url:'http://localhost/'});
 floating.window.outerWidth=930;floating.window.outerHeight=720;floating.window.screenX=100;floating.window.screenY=80;
 layout.groups.set('float',{id:'float',win:floating.window,host:floating.window.document.getElementById('float'),tree:null});
 await p.moveReadingSurface(layout,'editor','float');
 layout.groups.get('float').tree.ratio=.67;p._views.get(layout.entry.root).input.value='A floating draft';
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
 assert.notEqual(group.id,'main');assert.equal(layout.surfaces.get('reading').group,'main');
 assert.equal(JSON.stringify(group.tree),tree);
 assert.deepEqual([group.win.outerWidth,group.win.outerHeight,group.win.screenX,group.win.screenY],[930,720,100,80]);
 assert.equal(p._views.get(layout.entry.root).input.value,'A floating draft');
 assert.ok(layout.surfaces.get('editor').header.contains(layout.noteState.saveButton));
 dispose();for(const w of windows) w.close();
});

test('hot updates refresh layout styles and retain their priority over legacy note styles', () => {
 const {plugin:p,document:doc,window:win}=loadPlugin();
 p.resourceURI='chrome://old/content/';p.installReadingLayoutStyle(doc,'reading-layout.css');p.installReadingLayoutStyle(doc,'reading-note.css');
 const link=doc.querySelector('[data-reading-style="reading-layout.css"]');
 p.resourceURI='chrome://updated/content/';p.installReadingLayoutStyle(doc,'reading-note.css');p.installReadingLayoutStyle(doc,'reading-layout.css');
 assert.equal(link.getAttribute('href'),'chrome://updated/content/content/reading-layout.css');
 assert.equal(doc.querySelectorAll('[data-reading-style="reading-layout.css"]').length,1);
 assert.equal(doc.documentElement.lastElementChild,link);
 p.removeFromWindow(win);assert.equal(doc.querySelector('[data-reading-style]'),null);win.close();
});

test('mode and source share one toolbar and source menu starts with the existing add-documents action',async()=>{
 const {p,layout,doc,a,b,dispose}=await setup();
 assert.equal(layout.title.title,'Single document');assert.equal(layout.title.textContent,'');
 assert.equal(layout.title.nextElementSibling.className,'abstractin-layout-separator');
 assert.equal(layout.title.nextElementSibling.nextElementSibling,layout.sources);
 assert.ok(layout.sources.textContent.includes(a.title));assert.equal(layout.sources.parentElement,layout.toolbar);
 let added;p.showReadingSources=value=>{added=value;};layout.sources.click();
 const menu=doc.querySelector('.abstractin-layout-source-menu');assert.equal(menu.querySelector('button').textContent,'+ Add documents');
 menu.querySelector('button').click();assert.equal(added,layout);assert.equal(doc.querySelector('.abstractin-layout-source-menu'),null);
 await p.updateReadingSources(layout,[p.noteDocumentRef(a),p.noteDocumentRef(b)],{name:'Compare'});
 assert.equal(layout.title.title,'Workspace: Compare');layout.sources.click();
 assert.equal(doc.querySelectorAll('.abstractin-layout-source-menu .abstractin-layout-source').length,2);
 layout.closeSourceMenu();dispose();
});
