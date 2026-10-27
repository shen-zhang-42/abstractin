import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPlugin } from './load-plugin.mjs';

async function fixture(mode='balanced') {
 const env=loadPlugin({prefs:{'extensions.abstractin.onboarded':true,'extensions.abstractin.readingAgent':'codex','extensions.abstractin.readingEvidenceMode':mode}});
 const p=env.plugin;p.version='test-skill-v1';
 const ctx={dir:'/reading/chat-a',paperItem:{id:1,key:'BOOK',libraryID:1,getField:()=> 'Book'},attachmentItem:{id:7,key:'PDF'},reading:{type:'book'}};
 const store={history:[],sessions:{},requests:[]};
 p.loadHistory=async()=>JSON.parse(JSON.stringify(store.history));p.appendHistory=async(_,messages)=>{store.history.push(...messages);};
 p.loadSessions=async()=>JSON.parse(JSON.stringify(store.sessions));p.saveSessions=async(_,sessions)=>{store.sessions=JSON.parse(JSON.stringify(sessions));};
 p.loadVocabularyTutorSkill=async()=>await readFile(new URL('../skills/english-vocabulary-tutor/SKILL.md',import.meta.url),'utf8');
 p.prepareReadingSkills=async ctx=>ctx.reading;p.rememberReadingPosition=async()=>{};p.currentReadingLocation=()=>null;
 p.exportContext=async()=>({metadata:'DOCUMENT METADATA',annotations:'DOCUMENT NOTES'});
 p.knowledgeReadingSource=async()=>({status:'context-only',signature:'source-A'});
 p.exportReadingSource=async()=>({status:'ready',signature:'source-A'});p.recoverReadingPageMapping=async(_,source)=>source;
 p.prepareCurrentReadingPage=async()=>{};p.reuseCurrentReadingPage=async()=>{};
 p.exportReadingRecords=async()=> 'SAVED READING RECORDS';p.exportReadingWorkspace=async()=> 'DOCUMENT WORKSPACE';
 p.agentReadingContext=async()=> 'OTHER READING SKILL';p.saveReadingRecord=async()=>null;p.appendClarification=async()=>{};
 let threads=0;
 p.runBackend=async(_,request)=>{store.requests.push(request);return {text:'A useful answer.\n<abstractin-record>{"title":"Answer","summary":"Useful meaning","openQuestions":[]}</abstractin-record>',sessionId:request.session?.id || 'thread-'+(++threads)};};
 const ask=(text,options={})=>p.ask(ctx,text,{backend:'codex',model:'chosen-model',progress(){},...options});
 return {...env,p,ctx,store,ask};
}

test('vocabulary uses only the current question and selected sentence in every document reading mode',async()=>{
 for(const mode of ['balanced','source','context']) {
  const f=await fixture(mode);f.store.history=[{role:'user',text:'UNRELATED EARLIER QUESTION'},{role:'assistant',text:'UNRELATED EARLIER ANSWER'}];
  for(const name of ['exportContext','exportReadingRecords','exportReadingWorkspace','knowledgeReadingSource','exportReadingSource','prepareReadingSkills','prepareCurrentReadingPage','reuseCurrentReadingPage','rememberReadingPosition','agentReadingContext']) f.p[name]=()=>{assert.fail('Vocabulary must not retrieve '+name);};
  const result=await f.ask('What does enhance mean?',{selection:{attachmentID:7,text:'Exercise can enhance your mood.',position:{pageIndex:88},pageLabel:'89'}});
  assert.equal(result.error,undefined);
  const request=f.store.requests[0],prompt=f.p.codexPrompt(request);
  assert.equal(request.history.length,0);assert.deepEqual(Object.keys(request.files),['metadata','annotations']);assert.equal(request.files.metadata,'');
  assert.match(prompt,/Exercise can enhance your mood/);assert.doesNotMatch(prompt,/UNRELATED EARLIER|pageIndex|SAVED READING|DOCUMENT WORKSPACE|OTHER READING/);
  assert.equal(request.ctx.reading.evidenceMode,'knowledge');assert.equal(f.store.history.length,4);
  assert.ok(f.p.codexArgs(request).includes('features.shell_tool=false'));
 }
});

test('a word and a submitted English sentence share a Codex session and transmit the skill only once',async()=>{
 const f=await fixture();await f.ask('enhance');const id=f.store.sessions.codex.id;
 const first=f.p.codexPrompt(f.store.requests[0]);assert.match(first,/<english-vocabulary-tutor>/);
 await f.ask('Adding another memory card really enhanced the computing power of our server.');
 const request=f.store.requests[1],followUp=f.p.codexPrompt(request);
 assert.equal(request.session.id,id);assert.equal(request.ctx.reading.vocabularyTutor,true);
 assert.equal(request.history.length,0);assert.doesNotMatch(followUp,/<english-vocabulary-tutor>|Earlier conversation|DOCUMENT/);
 assert.ok(followUp.length<1800);assert.equal(f.store.sessions.codex.id,id);assert.equal(f.store.history.length,4);
});

test('reading, source verification, model changes and vocabulary all preserve the canonical Codex session',async()=>{
 const f=await fixture();await f.ask('enhance');const id=f.store.sessions.codex.id;
 f.p.setPref('readingEvidenceMode','source');await f.ask('Explain the theorem');
 assert.equal(f.store.requests[1].session.id,id);assert.equal(f.store.requests[1].ctx.reading.vocabularyTutor,false);
 f.p.setPref('readingEvidenceMode','context');await f.ask('How do I use despite?',{model:'another-model'});
 assert.equal(f.store.requests[2].session.id,id);assert.equal(f.store.requests[2].model,'another-model');
 assert.doesNotMatch(f.store.requests[2].question,/<english-vocabulary-tutor>/);
 f.p.setPref('readingEvidenceMode','balanced');await f.ask('Explain the proof');
 assert.equal(f.store.requests[3].session.id,id);assert.equal(f.store.sessions.codex.id,id);
 assert.deepEqual(Object.keys(f.store.sessions),['codex']);
});

test('a missing Codex session reloads the vocabulary skill and saves a visible restart notice',async()=>{
 const f=await fixture();await f.ask('enhance');const old=f.store.sessions.codex.id;
 let calls=0;f.p.runBackend=async(_,request)=>{
  calls++;f.store.requests.push(request);
  if(calls===1){assert.equal(request.session.id,old);assert.doesNotMatch(request.question,/<english-vocabulary-tutor>/);return {resumeFailed:true,error:'Session not found'};}
  assert.equal(request.session,null);assert.match(request.question,/<english-vocabulary-tutor>/);assert.equal(request.history.length,0);
  return {text:'The revised sentence is natural.',sessionId:'replacement-thread'};
 };
 const result=await f.ask('This exercise enhanced my understanding.');
 assert.equal(result.error,undefined);assert.equal(calls,2);assert.match(result.sessionNotice,/could not restore/);
 assert.equal(f.store.sessions.codex.id,'replacement-thread');assert.equal(f.store.history.at(-1).sessionNotice,result.sessionNotice);
 f.p.checkInstalledBackends=async()=>{};const body=f.document.createElement('div');f.document.body.append(body);f.p.renderSkeleton(f.document,body);
 const root=body.querySelector('.abstractin-root'),view={root,doc:f.document,ctx:f.ctx,logEl:root.querySelector('.abstractin-log'),input:root.querySelector('.abstractin-input')};
 f.p._views.set(root,view);f.p.renderMessages(view,f.store.history);assert.match(view.logEl.textContent,/could not restore/);
});

test('rate limiting never silently forks an existing Codex session',async()=>{
 const f=await fixture();await f.ask('enhance');const saved=JSON.stringify(f.store.sessions);let calls=0;
 f.p.runBackend=async()=>{calls++;return {resumeFailed:true,error:'Rate limit exceeded'};};
 const result=await f.ask('despite');assert.match(result.error,/Rate limit/);assert.equal(calls,1);
 assert.equal(JSON.stringify(f.store.sessions),saved);assert.equal(f.store.history.length,2);
});

test('an unsupported model retries its existing Codex session using local model defaults',async()=>{
 const f=await fixture();await f.ask('enhance');const id=f.store.sessions.codex.id;let calls=0;
 f.p.runBackend=async(_,request)=>{calls++;assert.equal(request.session.id,id);
  if(calls===1)return {resumeFailed:true,error:'The selected model is not supported'};
  assert.equal(request.model,'');assert.equal(request.effort,'');return {text:'A clear explanation.',sessionId:id};
 };
 const result=await f.ask('despite');assert.equal(result.error,undefined);assert.equal(result.modelFallback,true);assert.equal(f.store.sessions.codex.id,id);
});

test('a skill update is delivered once to the existing session without changing its identity',async()=>{
 const f=await fixture();await f.ask('enhance');const id=f.store.sessions.codex.id;f.p.version='test-skill-v2';
 await f.ask('despite');assert.equal(f.store.requests[1].session.id,id);assert.match(f.store.requests[1].question,/<english-vocabulary-tutor>/);
 await f.ask('nonetheless');assert.doesNotMatch(f.store.requests[2].question,/<english-vocabulary-tutor>/);assert.equal(f.store.sessions.codex.id,id);
});

test('an actual mathematics question leaves vocabulary mode without discarding the session',async()=>{
 const f=await fixture();await f.ask('enhance');const id=f.store.sessions.codex.id;
 await f.ask('What is the difference between Hilbert spaces and Banach spaces?');
 assert.equal(f.store.requests[1].ctx.reading.vocabularyTutor,false);assert.equal(f.store.requests[1].session.id,id);
});

test('automatic source verification continues the initial Codex session before any visible answer is saved',async()=>{
 const f=await fixture();let calls=0;
 f.p.runBackend=async(_,request)=>{calls++;
  if(calls===1){assert.equal(request.session,null);return {text:'<abstractin-source-needed>The theorem statement is missing</abstractin-source-needed>',sessionId:'verification-thread'};}
  assert.equal(request.session.id,'verification-thread');assert.equal(request.ctx.reading.evidenceMode,'source');
  return {text:'Verified explanation.',sessionId:'verification-thread'};
 };
 const result=await f.ask('Explain the theorem');assert.equal(result.error,undefined);assert.equal(calls,2);
 assert.equal(f.store.sessions.codex.id,'verification-thread');assert.equal(f.store.history.length,2);
 assert.doesNotMatch(f.store.history.at(-1).text,/source-needed/);
});

test('retrying a replaced turn resets Codex context explicitly and carries a restart explanation',async()=>{
 const f=await fixture();await f.ask('enhance');const id=f.store.sessions.codex.id;
 f.store.sessions['codex:balanced:knowledge']={id,seen:2};
 f.p.saveHistory=async(_,history)=>{f.store.history=history;};f.p.archiveHistory=async()=>{};f.p.writeChatSyncState=async()=>{};f.p.renderMessages=()=>{};
 let options;f.p.startRequest=(view,text,images,modes,value)=>{options=value;};
 const root={},view={root,ctx:f.ctx};f.p._views.set(root,view);
 await f.p.retry(view,1);
 assert.equal(f.store.sessions.codex,null);assert.equal(f.store.sessions['codex:balanced:knowledge'],null);
 assert.equal(options.vocabularyTutor,true);assert.match(options.sessionNotice,/replacing earlier messages/);
});
