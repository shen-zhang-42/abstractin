import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugin } from './load-plugin.mjs';

async function fixture(mode) {
 const env=loadPlugin({prefs:{'extensions.abstractin.noteSaveMode':mode}}), {plugin:p,window}=env;
 const dir=await mkdtemp(join(tmpdir(),'note-storage-'));
 window.OS={Path:{join},File:{exists:async path=>{try{await access(path);return true;}catch{return false;}}}};
 window.Zotero.File={getContentsAsync:path=>readFile(path,'utf8'),putContentsAsync:writeFile,createDirectoryIfMissingAsync:path=>mkdir(path,{recursive:true})};
 const notes=[];
 window.Zotero.Item=class { constructor(){this.id=notes.length+1;this.key='N'+this.id;this.tags=[];} getNote(){return this.html;} setNote(v){this.html=v;} addTag(tag){this.tags.push({tag});} getTags(){return this.tags;} async saveTx(){if(!notes.includes(this))notes.push(this);} };
 window.Zotero.Items={get:id=>notes.find(note=>note.id===id)};
 const parent={id:20,key:'PARENT',libraryID:1,getNotes:()=>notes.map(note=>note.id)};
 const ctx={dir,paperItem:parent};p.registerChatContext(ctx);
 let requests=[];p.runBackend=async (backend,request)=>{requests.push({backend,request});return{text:JSON.stringify({summary:'## Summary\n- Verified conclusion; unresolved question remains.\n- Equation: $x=1$.'})};};
 const history=[{role:'user',text:'RAW QUESTION SECRET',ts:1},{role:'assistant',text:'RAW ANSWER SECRET',backend:'claude',ts:2}];
 return {...env,p,dir,ctx,notes,history,requests};
}

test('full mode keeps the existing transcript and Zotero sync note',async()=>{
 const f=await fixture('full');await f.p.saveHistory(f.dir,f.history);
 assert.deepEqual(JSON.parse(await readFile(join(f.dir,'chat.json'),'utf8')),f.history);
 assert.equal(f.notes.length,1);assert.ok(f.notes[0].getNote().includes('RAW ANSWER SECRET'));assert.equal(f.requests.length,0);
});

test('none mode keeps history and CLI sessions only in memory and creates no notes or transcript files',async()=>{
 const f=await fixture('none');await f.p.saveHistory(f.dir,f.history);await f.p.saveSessions(f.dir,{claude:{id:'temporary'}});
 await f.p.appendClarification(f.dir,{answer:'RAW ANSWER SECRET'});await f.p.saveReadingRecord(f.ctx,'question',null,{});
 assert.deepEqual(Array.from(await f.p.loadHistory(f.dir),m=>m.text),f.history.map(m=>m.text));
 assert.equal((await f.p.loadSessions(f.dir)).claude.id,'temporary');assert.equal(f.notes.length,0);
 for(const file of ['chat.json','session.json','clarifications.json'])assert.equal(await f.window.OS.File.exists(join(f.dir,file)),false);
 f.p.endNoteSession(f.dir);assert.equal((await f.p.loadHistory(f.dir)).length,0);assert.deepEqual(Object.keys(await f.p.loadSessions(f.dir)),[]);assert.equal(f.requests.length,0);
});

test('summary mode persists only an agent-generated summary while keeping full messages until close',async()=>{
 const f=await fixture('summary');await f.p.saveHistory(f.dir,f.history);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].backend,'claude');assert.equal(f.requests[0].request.summaryOnly,true);assert.equal(f.requests[0].request.session,null);
 assert.ok(f.requests[0].request.question.includes('RAW QUESTION SECRET'));
 assert.equal((await f.p.loadHistory(f.dir)).length,2);
 const disk=await readFile(join(f.dir,'chat.json'),'utf8');assert.ok(!disk.includes('RAW QUESTION SECRET'));assert.ok(!disk.includes('RAW ANSWER SECRET'));assert.match(disk,/Verified conclusion/);
 assert.equal(f.notes.length,1);assert.ok(!f.notes[0].getNote().includes('RAW ANSWER SECRET'));
 await f.p.saveSessions(f.dir,{claude:{id:'full-thread'}});f.p.endNoteSession(f.dir);
 const reopened=await f.p.loadHistory(f.dir);assert.equal(reopened.length,1);assert.equal(reopened[0].savedSummary,true);assert.match(reopened[0].text,/\$x=1\$/);assert.deepEqual(Object.keys(await f.p.loadSessions(f.dir)),[]);
});

test('summary failures keep full text in the open session without silently persisting it or overwriting the prior summary',async()=>{
 const f=await fixture('summary');await f.p.saveHistory(f.dir,f.history);const before=await readFile(join(f.dir,'chat.json'),'utf8');
 f.p.runBackend=async()=>({error:'Agent offline'});
 const warning=await f.p.saveHistory(f.dir,[...f.history,{role:'user',text:'NEW UNSAVED SECRET'}]);
 assert.match(warning,/Summary was not saved: Agent offline/);assert.equal(await readFile(join(f.dir,'chat.json'),'utf8'),before);
 assert.equal((await f.p.loadHistory(f.dir)).length,3);f.p.endNoteSession(f.dir);assert.equal((await f.p.loadHistory(f.dir)).length,1);
});

test('the document mode change processes its open chats and preserves older saved notes',async()=>{
 const f=await fixture('full');await f.p.saveHistory(f.dir,f.history);
 const root=f.document.createElement('div');root.className='abstractin-root';f.document.body.append(root);f.p._views.set(root,{root,doc:f.document,ctx:f.ctx});
 await f.p.changeNoteSaveMode('summary', f.ctx);assert.equal(f.p.noteSaveMode(f.ctx),'summary');assert.equal((await f.p.loadHistory(f.dir)).length,2);
 f.p.endNoteSession(f.dir);assert.equal((await f.p.loadHistory(f.dir))[0].savedSummary,true);
 await f.p.changeNoteSaveMode('none', f.ctx);await f.p.saveHistory(f.dir,[{role:'user',text:'VOLATILE'}]);f.p.endNoteSession(f.dir);assert.equal((await f.p.loadHistory(f.dir)).length,0);
 assert.match(await readFile(join(f.dir,'chat.json'),'utf8'),/Verified conclusion/);
});

test('non-full modes keep automatic reading artifacts in memory without native note writes',async()=>{
 const f=await fixture('none');f.ctx.reading={type:'book'};
 const data={entries:[{title:'Chapter 1',pageIndex:0}]};await f.p.saveReadingArtifact(f.ctx,'Contents','Book contents','Contents',data);
 const note=f.p.readingArtifactNotes(f.ctx,'Contents')[0];assert.equal(f.p.readingArtifactData(note),data);assert.equal(f.notes.length,0);
 f.p.endNoteSession(f.dir);assert.equal(f.p._noteArtifacts.size,0);
});

for(const mode of ['none','summary']) test(`closing the reading panel in ${mode} mode replaces its cached full transcript and rejects late session writes`,async()=>{
 const f=await fixture(mode), body=f.document.createElement('div');f.document.body.append(body);f.p.renderSkeleton(f.document,body);
 const root=body.querySelector('.abstractin-root'), view={root,doc:f.document,ctx:f.ctx,logEl:root.querySelector('.abstractin-log'),input:root.querySelector('.abstractin-input')};f.p._views.set(root,view);
 await f.p.saveHistory(f.dir,f.history);f.p.renderMessages(view,f.history);
 const reader={}, state={active:true,reader,views:new Map([[reader,{root}]]),panel:body,splitter:f.document.createElement('div'),contextWasOpen:false,win:f.window};
 f.p.closeReaderPanelState(state);
 assert.equal(state.active,false);assert.ok(!view.logEl.textContent.includes('RAW ANSWER SECRET'));
 const reopened=await f.p.loadHistory(f.dir);assert.equal(reopened.length,mode==='none'?0:1);
 await f.p.saveSessions(f.dir,{claude:{id:'late-full-session'}});assert.deepEqual(Object.keys(await f.p.loadSessions(f.dir)),[]);
});

test('different documents retain independent modes, files and in-memory sessions',async()=>{
 const f=await fixture('full'), otherDir=await mkdtemp(join(tmpdir(),'note-other-'));
 const other={dir:otherDir,paperItem:{...f.ctx.paperItem,key:'OTHER'}};f.p.registerChatContext(other);
 await f.p.changeNoteSaveMode('none',f.ctx);
 await f.p.saveHistory(f.dir,f.history);await f.p.saveHistory(otherDir,f.history);
 assert.equal(f.p.noteSaveMode(f.ctx),'none');assert.equal(f.p.noteSaveMode(other),'full');
 assert.equal(await f.window.OS.File.exists(join(f.dir,'chat.json')),false);
 assert.match(await readFile(join(otherDir,'chat.json'),'utf8'),/RAW ANSWER SECRET/);
 await f.p.changeNoteSaveMode('summary',other);await f.p.saveHistory(otherDir,f.history);
 assert.equal(f.p.noteSaveMode(f.dir),'none');assert.equal(f.p.noteSaveMode(otherDir),'summary');
 f.p.endNoteSession(f.dir);assert.equal((await f.p.loadHistory(otherDir)).length,2);
 f.p.endNoteSession(otherDir);assert.equal((await f.p.loadHistory(otherDir))[0].savedSummary,true);
 assert.equal((await f.p.loadHistory(f.dir)).length,0);
});

test('a busy different document does not block mode changes and new chat directories inherit their document mode',async()=>{
 const f=await fixture('full'), otherDir=await mkdtemp(join(tmpdir(),'note-busy-'));
 const other={dir:otherDir,paperItem:{...f.ctx.paperItem,key:'OTHER'}};f.p.registerChatContext(other);f.p._pending.set(otherDir,{});
 await f.p.changeNoteSaveMode('none',f.ctx);
 await assert.rejects(f.p.changeNoteSaveMode('summary',other),/this document/);
 const child=join(f.dir,'discussions','new-chat');f.p.registerNoteDocument(child,f.ctx);
 assert.equal(f.p.noteSaveMode(child),'none');assert.equal(f.p.noteSaveMode(otherDir),'full');
 const sameDocument={...f.ctx,dir:join(f.dir,'another-pdf'),attachmentItem:{key:'ANOTHER'}};f.p.registerChatContext(sameDocument);
 assert.equal(f.p.noteSaveMode(sameDocument),'none');assert.equal(f.p.noteSaveMode(sameDocument.dir),'none');
 const differentLibrary={...f.ctx,dir:join(f.dir,'different-library'),paperItem:{...f.ctx.paperItem,libraryID:2}};f.p.registerChatContext(differentLibrary);
 assert.equal(f.p.noteSaveMode(differentLibrary),'full');
});

test('the document sidebar uses English labels and follows the current document when a root is reused',async()=>{
 const f=await fixture('full'), body=f.document.createElement('div');f.document.body.append(body);f.p.renderSkeleton(f.document,body);
 const root=body.querySelector('.abstractin-root'), view={root,doc:f.document,ctx:f.ctx,logEl:root.querySelector('.abstractin-log'),input:root.querySelector('.abstractin-input')};f.p._views.set(root,view);f.p.renderMessages(view,[]);
 let control=root.querySelector('.abstractin-note-save-mode');
 assert.equal(control.parentElement,root.querySelector('.abstractin-controls'));
 assert.equal(control.previousElementSibling,root.querySelector('.abstractin-effort-btn'));
 assert.equal(control.dataset.mode,'full');assert.equal(control.querySelector('.abstractin-i').dataset.icon,'noteFull');
 control.click();
 let items=[...root.querySelectorAll('.abstractin-menu-item')];
 assert.deepEqual(items.map(item=>item.querySelector('.abstractin-menu-label').textContent),['Full','Summary','Don’t save']);
 assert.deepEqual(items.map(item=>item.querySelector('.abstractin-reading-menu-icon').dataset.icon),['noteFull','noteSummary','noteNone']);
 assert.equal(items[0].getAttribute('aria-checked'),'true');f.p.closeMenu(root);
 assert.equal(root.querySelector('.abstractin-document-note-saving').textContent.match(/[\u3400-\u9fff]/),null);
 assert.equal(f.p.buildChatCard(f.document).querySelector('.abstractin-note-save-mode'),null);
 const other={dir:await mkdtemp(join(tmpdir(),'note-ui-other-')),paperItem:{...f.ctx.paperItem,key:'OTHER'}};f.p.registerChatContext(other);
 const next={...view,ctx:other};f.p._views.set(root,next);f.p.renderMessages(next,[]);
 control=root.querySelector('.abstractin-note-save-mode');control.click();
 root.querySelectorAll('.abstractin-menu-item')[2].click();
 for(let attempt=0;control.disabled&&attempt<100;attempt++) await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(control.disabled,false);assert.equal(control.dataset.mode,'none');assert.equal(control.querySelector('.abstractin-i').dataset.icon,'noteNone');
 assert.equal(f.p.noteSaveMode(other),'none');assert.equal(f.p.noteSaveMode(f.ctx),'full');
 assert.ok([...f.p.buildChatCard(f.document).querySelectorAll('option')].some(option=>option.value==='中文'&&option.textContent==='Chinese'));
});


test('summary saving shows its icon and keeps retry in the composer menu',async()=>{
 const f=await fixture('summary'), body=f.document.createElement('div');f.document.body.append(body);f.p.renderSkeleton(f.document,body);
 const root=body.querySelector('.abstractin-root'),view={root,doc:f.document,ctx:f.ctx,logEl:root.querySelector('.abstractin-log'),input:root.querySelector('.abstractin-input')};f.p._views.set(root,view);f.p.renderMessages(view,[]);
 const button=root.querySelector('.abstractin-note-save-mode');
 assert.equal(button.querySelector('.abstractin-i').dataset.icon,'noteSummary');
 assert.match(button.getAttribute('aria-label'),/Summary/);button.click();
 assert.equal(root.querySelectorAll('.abstractin-menu-item')[1].getAttribute('aria-checked'),'true');
 assert.equal(root.querySelectorAll('.abstractin-menu-item')[3].textContent,'Retry summaryRegenerate summaries for this document’s open conversations.');
 f.p.closeMenu(root);f.p.renderMessages({...view,ctx:{}},[]);
 assert.equal(root.querySelector('.abstractin-note-save-mode'),null);
 assert.equal(root.querySelector('.abstractin-note-saving-status'),null);
});
