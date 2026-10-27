import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlugin} from './load-plugin.mjs';

function fixture(respond) {
	const {plugin:p,window}=loadPlugin();
	p.findBinary=async()=>'/bin/codex'; p.buildChildEnvironment=()=>({});
	const sent=[],progress=[]; let waiter,closed=false,killed=0,options;
	const chunks=[];
	const push=message=>{
		const line=JSON.stringify(message)+'\n';
		for(const chunk of [line.slice(0,7),line.slice(7)]) {
			if(waiter){const resolve=waiter;waiter=null;resolve(chunk);}else chunks.push(chunk);
		}
	};
	const proc={
		stdin:{write:async bytes=>{const msg=JSON.parse(new TextDecoder().decode(bytes));sent.push(msg);await respond(msg,push,progress);},close:async()=>{}},
		stdout:{readString:async()=>chunks.length?chunks.shift():closed?'':new Promise(resolve=>waiter=resolve)},
		stderr:{readString:async()=>''},
		kill(){killed++;closed=true;if(waiter){waiter('');waiter=null;}},wait:async()=>({exitCode:0}),
	};
	window.Subprocess.call=async value=>{options=value;return proc;};
	const request={ctx:{dir:'/tmp/book',reading:{vocabularyTutor:true}},question:'attractive',history:[],
		model:'gpt-6.1-sol',effort:'medium',onProgress:event=>progress.push(event)};
	return {p,window,request,sent,progress,proc,options:()=>options,killed:()=>killed};
}

const handshake=(msg,push)=>{
	if(msg.method==='initialize')push({id:0,result:{}});
	if(['thread/start','thread/resume'].includes(msg.method))push({id:1,result:{thread:{id:msg.params.threadId||'thread-1'}}});
};

test('Codex streams growing text before completion, replaces final snapshots, and ignores reasoning',async()=>{
	const f=fixture(async(msg,push,progress)=>{
		handshake(msg,push);
		if(msg.method==='turn/start'){
			push({id:2,result:{turn:{id:'turn-1'}}});
			push({method:'item/reasoning/textDelta',params:{threadId:'thread-1',delta:'private reasoning'}});
			push({method:'item/agentMessage/delta',params:{threadId:'other',itemId:'x',delta:'other thread'}});
			push({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'a',delta:'Hello '}});
			push({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'a',delta:'词卡'}});
			// Gate completion on observable delivery of both partial updates.
			setImmediate(()=>{
				assert.deepEqual(progress.filter(e=>e.text!==undefined).map(e=>e.text),['Hello','Hello 词卡']);
				push({method:'item/completed',params:{threadId:'thread-1',item:{id:'a',type:'agentMessage',text:'Hello 词卡!'}}});
				push({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
			});
		}
	});
	const result=await f.p.runCodex(f.request);
	assert.equal(result.error,undefined);assert.equal(result.text,'Hello 词卡!');assert.equal(result.sessionId,'thread-1');
	assert.equal(f.sent[0].method,'initialize');assert.equal(f.sent[1].method,'initialized');
	assert.ok(f.options().arguments.includes('features.shell_tool=false'));
	assert.equal(f.killed(),1);
});

test('Codex resumes the existing native thread with selected model, effort, images and unchanged prompt',async()=>{
	const f=fixture((msg,push)=>{
		handshake(msg,push);
		if(msg.method==='turn/start'){
			push({id:2,result:{turn:{id:'t'}}});
			push({method:'item/completed',params:{threadId:'old',item:{id:'a',type:'agentMessage',text:'Answer'}}});
			push({method:'turn/completed',params:{threadId:'old',turn:{id:'t',status:'completed'}}});
		}
	});
	f.request.session={id:'old',seen:0};f.request.images=['/tmp/image.png'];
	const result=await f.p.runCodex(f.request);
	assert.equal(result.sessionId,'old');assert.equal(result.text,'Answer');
	const thread=f.sent.find(e=>e.method==='thread/resume').params;
	assert.equal(thread.threadId,'old');assert.equal(thread.sandbox,'read-only');assert.equal(thread.approvalPolicy,'never');
	assert.equal(thread.config['features.shell_tool'],false);assert.equal(thread.config['features.apps'],false);
	assert.equal(thread.config.web_search,'disabled');
	const turn=f.sent.find(e=>e.method==='turn/start').params;
	assert.equal(turn.model,'gpt-6.1-sol');assert.equal(turn.effort,'medium');
	assert.equal(turn.input[0].text,f.p.codexPrompt(f.request));assert.equal(turn.input[1].path,'/tmp/image.png');
	assert.ok(!f.sent.some(e=>e.method==='thread/start'));
});

test('Codex surfaces lost sessions without starting an invisible replacement',async()=>{
	const f=fixture((msg,push)=>{
		if(msg.method==='initialize')push({id:0,result:{}});
		if(msg.method==='thread/resume')push({id:1,error:{message:'Thread not found'}});
	});f.request.session={id:'missing'};
	const result=await f.p.runCodex(f.request);
	assert.equal(result.error,'Thread not found');assert.equal(result.resumeFailed,true);
	assert.ok(!f.sent.some(e=>e.method==='turn/start'||e.method==='thread/start'));
});

test('Codex keeps partial output on cancellation and reports turn errors',async()=>{
	for(const cancel of [true,false]){
		let f;f=fixture((msg,push)=>{
			handshake(msg,push);
			if(msg.method==='turn/start'){
				push({id:2,result:{turn:{id:'t'}}});
				push({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'a',delta:'Partial'}});
				if(cancel)setImmediate(()=>f.proc.kill());
				else push({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'t',status:'failed',error:{message:'Rate limit'}}}});
			}
		});
		const result=await f.p.runCodex(f.request);
		assert.equal(result.text,'Partial');assert.match(result.error,cancel?/closed/:/Rate limit/);
		assert.ok(!result.resumeFailed);
	}
});

test('Codex startup timeout cleans up its process',async()=>{
	const f=fixture(()=>{});f.window.setTimeout=fn=>{setImmediate(fn);return 1;};
	const result=await f.p.runCodex(f.request);
	assert.match(result.error,/startup timed out/);
	assert.equal(f.killed(),1);
});
