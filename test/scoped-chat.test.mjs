import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

function setup() {
 const env = loadPlugin(), {plugin:p,window:w}=env, files=new Map(), items=new Map(); let serial=0;
 w.OS={Path:{join:(...parts)=>parts.join('/')}};
 w.Zotero.File={createDirectoryIfMissingAsync:async()=>{},putContentsAsync:async(path,text)=>files.set(path,text),getContentsAsync:async path=>files.get(path)||''};
 w.Zotero.Search=class{addCondition(){} async search(){return [...items.keys()];}};
 w.Zotero.Items={get:id=>items.get(id),getAsync:async ids=>Array.isArray(ids)?ids.map(id=>items.get(id)):items.get(ids),getByLibraryAndKey:(lib,key)=>[...items.values()].find(item=>item.libraryID===lib&&item.key===key)};
 p.getDataDir=()=>'/data'; p.syncNoteOutLinks=async()=>{};
 const document=(key,type='book')=>{
  const item={id:++serial,key,libraryID:1,itemType:type,isRegularItem:()=>true,isEditable:()=>true,getField:()=>key,isAttachment:()=>false,getAttachments:()=>[item.pdf.id]};
  item.pdf={id:++serial,key:key+'PDF',libraryID:1,parentItem:item,isPDFAttachment:()=>true}; items.set(item.id,item);items.set(item.pdf.id,item.pdf);return item;
 };
 const a=document('BOOKA'),b=document('PAPERB','journalArticle');
 const note=(key,markdown,documents=[p.noteDocumentRef(a)],workspace=null,libraryID=1)=>{
  const item={id:++serial,key,libraryID,parentItem:documents.length===1?a:null,isNote:()=>true,getTags:()=>[{tag:'AbstractIn:Markdown'}],isEditable:()=>true,getNote:()=>item.html,setNote:html=>{item.html=html;},saveTx:async()=>item.id};
  item.html=p.markdownNoteHTML(item,key,markdown,item.parentItem,1,documents,workspace);items.set(item.id,item);return item;
 };
 const one=note('ONE','Only note one. Unique chloroplast finding.\n\nKeep this paragraph.'),two=note('TWO','Second note on chloroplast analysis.');
 const ctx={dir:'/chat',paperItem:a,attachmentItem:a.pdf,reading:{type:'book',action:'discuss',answerMode:'balanced'}};
 const turn=()=>({backend:'codex',reads:new Map(),excerpts:new Set(),documentSearches:new Map(),images:[],edits:[],editSerial:0});
 const request=(context=ctx)=>({ctx:context,files:{},history:[],commonChat:true,question:'Improve the chloroplast explanation in note TWO.',model:'fixture',onProgress(){}});
 return {...env,p,w,files,items,a,b,note,one,two,ctx,turn,request};
}
const tools=operations=>({text:'<abstractin-tools>'+JSON.stringify({operations})+'</abstractin-tools>'});

test('every chat has the same scope, without leaking other documents, workspaces, libraries or trash',async()=>{
 const {p,a,b,note,two,ctx,window}=setup();
 note('OTHER','Secret other document',[p.noteDocumentRef(b)]);
 note('WORKSPACE','Private workspace',[p.noteDocumentRef(a)],{id:'other'});
 note('LIBRARY','Other library',[p.noteDocumentRef(a)],null,2);
 note('TRASH','Deleted text').deleted=true;
 const read=await p.sharedChatScope(ctx),write=await p.sharedChatScope({paperItem:two,noteWorkspace:true,noteState:{note:two,documents:[p.noteDocumentRef(a)]}});
 assert.deepEqual([...read.notes.map(entry=>entry.note.key)],['ONE','TWO']);
 assert.deepEqual([...write.notes.map(entry=>entry.note.key)],['ONE','TWO']);
 const workspace={id:'mine'};note('W1','Workspace one',[p.noteDocumentRef(a)],workspace);note('W2','Workspace two',[p.noteDocumentRef(b)],workspace);
 const shared=await p.sharedChatScope({...ctx,readingWorkspace:workspace,workspaceDocuments:[a,b].map(item=>p.noteDocumentRef(item))});
 assert.deepEqual([...shared.notes.map(entry=>entry.note.key)],['W1','W2']);window.close();
});

for(const mode of ['reading','note']) test(mode+' chat retrieves and edits another note through the real shared backend wrapper',async()=>{
 const {p,ctx,two,a,request,window,files}=setup();
 const active=mode==='note'?{dir:'/note-chat',paperItem:two,noteWorkspace:true,noteState:{note:two,documents:[p.noteDocumentRef(a)]}}:ctx;
 let round=0;const progress=[];
 p.runCodex=async r=>{
  round++;
  if(round===1){assert.doesNotMatch(r.question,/Second note on chloroplast analysis|Only note one|Keep this paragraph/);assert.match(r.question,/searchNotes|editNote/);r.onProgress({text:'<abstractin-tools>{'});return tools([{tool:'searchNotes',queries:['chloroplast']}]);}
  const result=JSON.parse(r.question.match(/<shared-tool-results>([\s\S]*?)<\/shared-tool-results>/)[1]);
  if(round===2){assert.equal(result[0].result.matches.length,2);return tools([{tool:'readNote',noteKey:'TWO'}]);}
  if(round===3){const read=result[0].result;assert.equal(read.markdown,'Second note on chloroplast analysis.');return tools([{tool:'editNote',noteKey:'TWO',version:read.version,edits:[{oldText:'chloroplast analysis',newText:'chloroplast imaging analysis'}]}]);}
  assert.equal(result[0].result.saved,true);return {text:'Updated note TWO.'};
 };
 const result=await p.runBackend('codex',{...request(active),onProgress:event=>progress.push(event)});
 assert.equal(round,4);assert.equal(result.text,'Updated note TWO.');assert.equal(result.noteEdits.length,1);
 assert.equal(p.markdownNoteData(two).markdown,'Second note on chloroplast imaging analysis.');
 assert.ok([...files.keys()].some(path=>/edit-before-/.test(path)));
 assert.equal(progress.some(event=>event.text?.includes('<abstractin-tools>')),false);window.close();
});

test('edits require the current version and a fully read, unique, non-overlapping target',async()=>{
 const {p,ctx,one,two,turn,window}=setup(),t=turn(),op=(operation)=>p.sharedChatOperation(ctx,operation,t);
 await assert.rejects(op({tool:'editNote',noteKey:'ONE',version:'invented',edits:[{oldText:'Unique',newText:'New'}]}),/version changed|not read/);
 const read=await op({tool:'readNote',noteKey:'ONE',offset:0,length:10});
 await assert.rejects(op({tool:'editNote',noteKey:'ONE',version:read.version,edits:[{oldText:'Keep this paragraph.',newText:'Hidden edit'}]}),/entire replacement target/);
 const full=await op({tool:'readNote',noteKey:'ONE'});
 await assert.rejects(op({tool:'editNote',noteKey:'ONE',version:full.version,edits:[{oldText:'Unique chloroplast',newText:'X'},{oldText:'chloroplast finding',newText:'Y'}]}),/overlap/);
 one.html=p.markdownNoteHTML(one,'ONE','Manual edit! Unique chloroplast finding.',one.parentItem,2);
 await assert.rejects(op({tool:'editNote',noteKey:'ONE',version:full.version,edits:[{oldText:'Unique',newText:'New'}]}),/version changed/);
 assert.equal(p.markdownNoteData(two).markdown,'Second note on chloroplast analysis.');window.close();
});

test('live drafts are read on demand and repeated ranges are not included twice',async()=>{
 const {p,ctx,one,turn,window}=setup(),t=turn();let flushed=0;
 const state={note:one,win:window,title:{value:'Draft title'},input:{value:'Unsaved draft',_composerEditor:{flush(){flushed++;}}},documents:[p.noteDocumentRef(ctx.paperItem)],revision:2,savedRevision:1};
 p._markdownNoteWindows.set('1:ONE',state);
 const read=await p.sharedChatOperation(ctx,{tool:'readNote',noteKey:'ONE'},t);assert.equal(read.markdown,'Unsaved draft');assert.equal(read.draft,true);assert.ok(flushed);
 const again=await p.sharedChatOperation(ctx,{tool:'readNote',noteKey:'ONE'},t);assert.equal(again.alreadySupplied,true);assert.equal(again.markdown,undefined);
 state.input.value='New draft';const changed=await p.sharedChatOperation(ctx,{tool:'readNote',noteKey:'ONE'},t);assert.equal(changed.markdown,'New draft');assert.notEqual(changed.version,read.version);window.close();
});

test('the same retrieval protocol works through Claude, Gemini ACP and stateless API transports',async()=>{
 for(const backend of ['claude','gemini','fixture-api']){
  const {p,request,window}=setup(),registry=p.agentRegistry.bind(p);let calls=0;
  p.agentRegistry=()=>({...registry(),'fixture-api':{id:'fixture-api',api:true}});
  const transport=async r=>{
   if(++calls===1)return {...tools([{tool:'readNote',noteKey:'TWO'}]),...(backend==='claude'?{sessionId:'thread'}:{})};
   assert.match(r.question,/Second note on chloroplast analysis/);
   if(backend==='claude')assert.equal(r.session.id,'thread');
   else assert.ok(r.history.some(message=>message.text.includes('Improve the chloroplast explanation')));
   return {text:'Evidence from note TWO.'};
  };
  p.runClaude=transport;p.runACPAgent=(_,r)=>transport(r);p.runAPIProvider=(_,r)=>transport(r);
  assert.equal((await p.runBackend(backend,request())).text,'Evidence from note TWO.');assert.equal(calls,2);window.close();
 }
});

test('a failed session resume keeps already retrieved context when retrying without the session',async()=>{
 const {p,request,window}=setup();let calls=0;
 p.runCodex=async r=>{
  if(++calls===1)return {...tools([{tool:'readNote',noteKey:'ONE'}]),sessionId:'expired'};
  if(calls===2){assert.equal(r.session.id,'expired');return {resumeFailed:true};}
  assert.equal(r.session,null);assert.match(r.question,/Only note one/);assert.match(r.question,/editNote/);return {text:'Recovered answer.'};
 };
 assert.equal((await p.runBackend('codex',request())).text,'Recovered answer.');assert.equal(calls,3);window.close();
});

test('note chats search linked books and papers, retain source identities and can inspect images',async()=>{
 const {p,a,b,two,files,turn,window}=setup(),t=turn();
 const ctx={dir:'/note-chat',paperItem:two,noteWorkspace:true,noteState:{note:two,documents:[a,b].map(item=>p.noteDocumentRef(item))}};
 p.exportReadingSource=async source=>{
  files.set(source.dir+'/source-text.md','## PDF page 1; pageIndex 0\n\nIrrelevant page.\n\n## PDF page 2; pageIndex 1\n\nChloroplast analysis supports this result.');
  return {status:'ready',totalPages:700,pageMapping:true,signature:source.paperItem.key};
 };
 p.readingPageImage=async(source,page,backend)=>({status:'available',path:source.paperItem.key+'-'+page+'.png'});
 let result=await p.sharedChatOperation(ctx,{tool:'searchDocument',documentKey:a.key,queries:['Chloroplast analysis'],imagePageIndices:[1]},t);
 assert.equal(result.documentKey,a.key);assert.equal(result.attachmentKey,a.pdf.key);assert.equal(result.sections[0].pageIndex,1);assert.match(result.sections[0].text,/supports this result/);assert.equal(result.images[0].imageAttachment,1);assert.equal(result.remainingSearches,6);
 for(let i=0;i<6;i++) await p.sharedChatOperation(ctx,{tool:'searchDocument',documentKey:a.key,queries:['Chloroplast analysis']},t);
 await assert.rejects(p.sharedChatOperation(ctx,{tool:'searchDocument',documentKey:a.key,queries:['another']},t),/budget/);
 for(let i=0;i<10;i++) result=await p.sharedChatOperation(ctx,{tool:'searchDocument',documentKey:b.key,queries:['Chloroplast analysis']},t);
 assert.equal(result.remainingSearches,null);
 await assert.rejects(p.sharedChatOperation(ctx,{tool:'searchDocument',documentKey:'OUTSIDE',queries:['secret']},t),/outside/);window.close();
});

test('explicit context-only mode blocks retrieval and editing and cancellation stops before tools',async()=>{
 const {p,ctx,turn,request,window}=setup();ctx.reading.answerMode='context';
 for(const tool of ['searchNotes','readNote','editNote','searchDocument']) await assert.rejects(p.sharedChatOperation(ctx,{tool,noteKey:'ONE',queries:['word']},turn()),/disables/);
 ctx.reading.answerMode='balanced';let calls=0;
 p._pending.set(ctx.dir,{cancelled:false});p.runCodex=async()=>{calls++;p._pending.get(ctx.dir).cancelled=true;return tools([{tool:'readNote',noteKey:'ONE'}]);};
 assert.equal((await p.runBackend('codex',request())).cancelled,true);
 assert.equal(calls,1);assert.equal(p._pending.get(ctx.dir).sharedChatTurn.reads.size,0);window.close();
});
