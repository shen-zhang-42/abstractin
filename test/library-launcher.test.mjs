import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlugin} from './load-plugin.mjs';

function setup() {
	const env=loadPlugin({prefs:{'extensions.abstractin.onboarded':true}}),{plugin:p,window:win,document:doc}=env;
	doc.body.innerHTML='<div id="zotero-tabs-toolbar"><button id="zotero-tb-tabs-menu"></button><button id="zotero-tb-sync"></button></div><div id="layout"><div id="reader-deck"></div><div id="zotero-context-splitter"></div><div id="zotero-context-pane"></div></div>';
	doc.createXULElement=name=>doc.createElement(name);win.MozXULElement={insertFTLIfNeeded(){}};
	let selectedItems=[];
	win.ZoteroPane={itemsView:{getSelectedItems:()=>selectedItems}};win.Zotero_Tabs={selectedType:'library',selectedID:'library',getTabIDByItemID:()=> 'pdf-tab'};
	let collapsed=false;win.ZoteroContextPane={get collapsed(){return collapsed;},set collapsed(value){collapsed=value;doc.getElementById('zotero-context-pane').toggleAttribute('collapsed',value);}};
	win.Zotero.Notifier={registerObserver:()=>1,unregisterObserver(){}};
	const item=(id,title)=>({id,key:'ITEM'+id,libraryID:5,isRegularItem:()=>true,isAttachment:()=>false,getField:field=>field==='title'?title:'',getNotes:()=>[],getAttachments:()=>[12]});
	const a=item(1,'Alpha paper'),b=item(2,'Beta book');
	const pdf={id:12,key:'PDF',libraryID:5,parentID:a.id,parentItem:a,isPDFAttachment:()=>true,isAttachment:()=>true};
	const note={id:31,key:'NOTE',libraryID:5,parentID:a.id,isNote:()=>true,getTags:()=>[{tag:'AbstractIn:NoteIn'}],getNote:()=>'<h1>NoteIn</h1><pre>{"format":"abstractin-notein-v1","itemKey":"ITEM1"}</pre>'};
	const items=new Map([[1,a],[2,b],[12,pdf],[31,note]]),loads=[],opens=[];
	win.Zotero.Items={get:id=>items.get(id),getAsync:async ids=>Array.isArray(ids)?ids.map(id=>items.get(id)):items.get(ids),loadDataTypes:async(objects,types)=>loads.push({ids:objects.map(o=>o.id),types:[...types]})};
	let searchedLibrary;
	win.Zotero.Search=class{addCondition(){} async search(){searchedLibrary=this.libraryID;return [1,2];}};
	const reader={itemID:12,tabID:'pdf-tab',type:'pdf',_window:win,_initPromise:Promise.resolve()};
	win.Zotero.Reader={getByTabID:()=>reader,open:async id=>{opens.push(id);win.Zotero_Tabs.selectedType='reader';win.Zotero_Tabs.selectedID=reader.tabID;return reader;}};
	const ctx={dir:'existing-discussion',paperItem:a,attachmentItem:pdf,reading:{type:'paper'},discussion:{id:'existing-chat'}};
	p.getContext=async()=>({...ctx});p.checkInstalledBackends=async()=>{};
	p.renderContent=async(doc,body)=>{
		const root=body.querySelector('.abstractin-root'),view={doc,root,ctx:await p.getContext(a),input:root.querySelector('textarea'),logEl:root.querySelector('.abstractin-log')};
		p._views.set(root,view);p.renderMessages(view,[{role:'user',text:'Earlier question'},{role:'assistant',text:'Saved answer',backend:'codex'}]);
	};
	p.contextDirFor=()=>ctx.dir;
	return {...env,p,a,b,pdf,note,reader,ctx,loads,opens,searchedLibrary:()=>searchedLibrary,select:items=>{selectedItems=items;}};
}

test('title-bar entry is icon only, immediately before a thin separator and the native dropdown',()=>{
	const {p,window:win,document:doc,reader}=setup();
	p.addToWindow(win);p.addToWindow(win);
	const button=doc.getElementById('abstractin-main-toggle'),separator=doc.getElementById('abstractin-main-separator');
	assert.equal(button.textContent.trim(),'');assert.ok(button.querySelector('svg'));
	assert.equal(button.title,'Open AbstractIn');assert.equal(button.nextElementSibling,separator);
	assert.equal(separator.nextElementSibling.id,'zotero-tb-tabs-menu');assert.equal(separator.getAttribute('aria-orientation'),'vertical');
	assert.equal(doc.querySelectorAll('#abstractin-main-toggle').length,1);
	let appended=0;p.renderReaderToolbar({reader,doc,append:()=>appended++});assert.equal(appended,0,'main-window PDFs use the shared title-bar entry');
	p.removeFromWindow(win);assert.equal(doc.getElementById('abstractin-main-toggle'),null);assert.ok(doc.getElementById('zotero-tb-tabs-menu'));
});

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('library welcome shows the chosen companion without querying or listing the library or adding existing selection',async()=>{
	const {p,window:win,document:doc,a,select,loads}=setup();select([a]);
	win.Zotero.Search=class{constructor(){assert.fail('welcome must not search the library');}};
	await p.openLibraryLauncher(win);
	assert.ok(doc.querySelector('.abstractin-library-welcome .abstractin-mascot'));
	assert.match(doc.querySelector('.abstractin-library-welcome').textContent,/Read with Ohberto/);
	assert.match(doc.querySelector('.abstractin-library-welcome').textContent,/document list on the left/);
	assert.equal(doc.querySelectorAll('.abstractin-library-item').length,0);assert.equal(loads.length,0);
	assert.equal(doc.querySelector('.abstractin-library-start').disabled,true);
});

test('explicit native selection adds only chosen documents, deduplicates and permits removing before single-document start',async()=>{
	const {p,window:win,document:doc,a,b,select,loads}=setup();await p.openLibraryLauncher(win);
	const add=doc.querySelector('.abstractin-library-add'),start=doc.querySelector('.abstractin-library-start');
	select([a]);add.click();await tick();assert.equal(start.disabled,false);
	assert.deepEqual([...loads.at(-1).ids],[1]);
	select([a,b]);add.click();await tick();assert.equal(doc.querySelectorAll('.abstractin-library-item').length,2);
	assert.equal(start.disabled,true);assert.match(doc.querySelector('.abstractin-library-status').textContent,/2 documents added/);
	doc.querySelector('[data-item-id="2"] button').click();assert.equal(start.disabled,false);
	let chosen;p.startLibraryReading=async(_,item)=>chosen=item;
	start.click();await tick();assert.equal(chosen.id,1);
});

test('selected child PDF and NoteIn resolve to one parent; standalone notes, annotations and deleted items are skipped',async()=>{
	const {p,window:win,document:doc,a,b,pdf,note,select}=setup();await p.openLibraryLauncher(win);
	b.deleted=true;
	select([pdf,note,a,b,{id:99,isNote:()=>true},{id:100,isAnnotation:()=>true}]);
	doc.querySelector('.abstractin-library-add').click();await tick();
	assert.equal(doc.querySelectorAll('.abstractin-library-item').length,1);
	assert.equal(doc.querySelector('.abstractin-library-item').dataset.itemId,'1');
});

test('empty selection gives guidance and reopening preserves added documents without adding the new native selection',async()=>{
	const {p,window:win,document:doc,a,b,select}=setup();await p.openLibraryLauncher(win);
	doc.querySelector('.abstractin-library-add').click();await tick();
	assert.match(doc.querySelector('.abstractin-library-status').textContent,/Select a book or paper/);
	select([a]);doc.querySelector('.abstractin-library-add').click();await tick();
	await p.openLibraryLauncher(win);select([b]);await p.openLibraryLauncher(win);
	assert.equal(doc.querySelectorAll('.abstractin-library-item').length,1);
	assert.equal(doc.querySelector('.abstractin-library-item').dataset.itemId,'1');
});

test('startup removes a leftover in-PDF entry when moving the launcher to the title bar',async()=>{
	const {p,window:win,document:doc,reader}=setup();
	const old=doc.createElement('button');old.className='abstractin-reader-toggle';doc.body.append(old);
	reader._iframeWindow={document:doc};win.Zotero.Reader._readers=[reader];
	await p.restoreReaderToolbarEntries();
	assert.ok(doc.getElementById('abstractin-main-toggle'));
	assert.equal(doc.querySelectorAll('.abstractin-reader-toggle').length,0);
});

test('Start Reading opens the saved PDF and existing chat without initialization or replacing its context',async()=>{
	const {p,window:win,document:doc,a,reader,ctx,opens}=setup();
	p.activateReading=()=>assert.fail('existing reading must not be initialized again');
	p.beginReadingWorkflow=()=>assert.fail('existing reading must not restart its workflow');
	p.runBackend=()=>assert.fail('resuming does not need an AI request');
	await p.openLibraryLauncher(win);await p.startLibraryReading(win,a);
	assert.deepEqual(opens,[12]);assert.equal(win.Zotero_Tabs.selectedID,'pdf-tab');
	const state=p.readerPanelState(win),view=p._views.get(state.views.get(reader).root);
	assert.equal(view.ctx.discussion.id,ctx.discussion.id);assert.equal(view.ctx.dir,ctx.dir);
	assert.equal(state.launcher.hidden,true);assert.equal(doc.querySelectorAll('.abstractin-reader-panel').length,1);
	assert.match(state.panel.textContent,/Saved answer/);
});

test('NoteIn-only reading recovers its type after loading note data and opens the original reader interface',async()=>{
	const {p,window:win,a,pdf,ctx,loads,opens}=setup();a.getNotes=()=>[31];
	p.getContext=async()=>({...ctx,reading:p._readingStates.get(pdf.id)});
	p.readingType=()=> 'paper';
	await p.startLibraryReading(win,a);
	assert.equal(p._readingStates.get(pdf.id).type,'paper');assert.deepEqual(opens,[12]);
	assert.ok(loads.some(load=>load.ids.includes(31)&&load.types.includes('tags')&&load.types.includes('note')));
});

test('Start Reading waits for Zotero to load an existing unloaded PDF tab',async()=>{
	const {p,window:win,a,reader}=setup();let calls=0;
	win.Zotero.Reader.open=async()=>undefined;
	win.Zotero.Reader.getByTabID=()=>++calls<2?null:reader;
	assert.equal(await p.startLibraryReading(win,a),reader);assert.equal(calls,2);
});

test('missing PDF is reported without opening a reader or starting initialization',async()=>{
	const {p,window:win,a,ctx,opens}=setup();p.getContext=async()=>({...ctx,attachmentItem:null});
	await assert.rejects(p.startLibraryReading(win,a),/Attach a PDF/);assert.deepEqual(opens,[]);
});

test('a new document continues through the existing confirmation flow after opening its PDF',async()=>{
	const {p,window:win,a,ctx,opens}=setup();p.getContext=async()=>({...ctx,reading:undefined,discussion:undefined});p.needsAgentSetup=()=>false;
	let setupRoot;p.openReadingSetup=async root=>{setupRoot=root;};
	await p.startLibraryReading(win,a);assert.deepEqual(opens,[12]);assert.ok(setupRoot);
	assert.equal(p._views.get(setupRoot).ctx.reading,undefined,'reading is not initialized before confirmation');
});

test('the shared entry toggles the current PDF panel and the chooser can be reopened without duplicate panels',async()=>{
	const {p,window:win,document:doc,reader}=setup();
	await p.openLibraryLauncher(win);await p.openLibraryLauncher(win);assert.equal(p.readerPanelState(win).panel.hidden,true);
	win.Zotero_Tabs.selectedType='reader';await p.openLibraryLauncher(win);
	assert.equal(p.readerPanelState(win).reader,reader);assert.equal(p.readerPanelState(win).launcher.hidden,true);
	await p.openLibraryLauncher(win);assert.equal(p.readerPanelState(win).panel.hidden,true);
	assert.equal(doc.querySelectorAll('.abstractin-reader-panel').length,1);
});
