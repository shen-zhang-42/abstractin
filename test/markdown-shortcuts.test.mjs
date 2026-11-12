import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {markdownShortcuts} from '../src/content/editor/markdown-shortcuts.js';
import {EditorView} from '@codemirror/view';

async function editor({note=true,disabled=false,text='word'}={}) {
 const dom=new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 const {window}=dom;window.ResizeObserver=class{observe(){}disconnect(){}};
 window.Range.prototype.getClientRects=()=>[]; window.Range.prototype.getBoundingClientRect=()=>({top:0,left:0,right:0,bottom:0,width:0,height:0});
 await window.eval(await readFile(new URL('../src/content/editor/'+(note?'note':'composer')+'.bundle.js',import.meta.url),'utf8'));
 let changes=0;const updates=[];
 const instance=window.AbstractInComposer.create({note,disabled,text,tokens:()=>[],renderMath(){},onKey:()=>false,onPaste:()=>false,onDrop:()=>false,
  onChange:(text,_from,_to,changed)=>{if(changed){changes++;updates.push(text);}},onHeight(){},onError:error=>{throw error;}});
 if(note)instance.editor.commands.selectAll();else instance.select(0,text.length);
 const key=(key,options={})=>(instance.view.contentDOM||instance.view.dom).dispatchEvent(new window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...options}));
 return {instance,key,window,changes:()=>changes,updates,text:()=>instance.getMarkdown?instance.getMarkdown():instance.view.state.doc.toString(),close:()=>{instance.destroy();window.close();}};
}

test('notes render Markdown directly and retain the original source until an actual edit',async()=>{
 const source='# Heading\n\n**Bold** and *italic*.\n\n- [x] done\n- [ ] next\n\n| A | B |\n| --- | --- |\n| x | y |\n\n$x^2$\n\n$$\na=b\n$$\n';
 const env=await editor({text:source}),dom=env.instance.view.dom;
 assert.equal(dom.querySelector('h1').textContent,'Heading');assert.equal(dom.querySelector('strong').textContent,'Bold');assert.ok(dom.querySelector('em'));
 assert.ok(dom.querySelector('table'));assert.equal(dom.querySelectorAll('input[type=checkbox]').length,2);assert.equal(dom.querySelectorAll('math').length,2);
 assert.equal(env.text(),source);assert.equal(env.changes(),0);env.instance.sync(source,false,'');assert.equal(env.text(),source);env.close();
});

test('ordinary indented paragraphs retain their formatting after saving and reopening',async()=>{
 for(const indent of ['\t','    ',' \t']){
  const env=await editor();
  env.instance.editor.commands.setContent({type:'doc',content:[
   {type:'paragraph',content:[{type:'text',text:indent},{type:'text',text:'important',marks:[{type:'bold'}]},{type:'text',text:' explanation'}]},
   {type:'paragraph',content:[{type:'text',text:'Following paragraph'}]},
  ]});
  const saved=env.text();assert.doesNotMatch(saved,/```/);
  const reopened=await editor({text:saved});assert.equal(reopened.instance.view.dom.querySelector('pre'),null,'normal indentation must not become code');
  assert.equal(reopened.instance.view.dom.querySelector('strong')?.textContent,'important');
  assert.equal(reopened.instance.editor.state.doc.firstChild.textContent,indent+'important explanation');
  reopened.close();env.close();
 }
});

test('repeated saves preserve intentional code and nested lists alongside ordinary indented prose',async()=>{
 let env=await editor();env.instance.editor.commands.setContent({type:'doc',content:[
  {type:'paragraph',content:[{type:'text',text:'\t'},{type:'text',text:'Important',marks:[{type:'bold'}]}]},
  {type:'codeBlock',attrs:{language:'r'},content:[{type:'text',text:'    x <- 1\n\ty <- 2'}]},
  {type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Parent'}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Child'}]}]}]}]}]},
  {type:'paragraph',content:[{type:'text',text:'End'}]},
 ]});
 for(let i=0;i<3;i++){
  const saved=env.text();env.close();env=await editor({text:saved});
  assert.equal(env.instance.view.dom.querySelectorAll('pre').length,1);assert.equal(env.instance.view.dom.querySelector('pre').textContent,'    x <- 1\n\ty <- 2');
  assert.equal(env.instance.view.dom.querySelector('strong').textContent,'Important');assert.ok(env.instance.view.dom.querySelector('li li'));
  env.instance.editor.commands.setTextSelection(env.instance.editor.state.doc.content.size-1);env.instance.editor.commands.insertContent('!');
 }
 assert.equal((env.text().match(/```/g)||[]).length,2);env.close();
});

test('blockquote emphasis keeps bold text and mathematics rendered without code fences',async()=>{
 const env=await editor({text:'> **Important** and *explanation*.\n>\n> $x^2$'});
 assert.ok(env.instance.view.dom.querySelector('blockquote strong'));assert.ok(env.instance.view.dom.querySelector('blockquote em'));assert.ok(env.instance.view.dom.querySelector('blockquote math'));
 assert.equal(env.instance.view.dom.querySelector('pre'),null);env.close();
});

test('Ctrl+B and Ctrl+I produce visible marks, Markdown output and separate undo steps',async()=>{
 const env=await editor();env.key('b');assert.equal(env.text(),'**word**');assert.equal(env.instance.view.dom.querySelector('strong').textContent,'word');
 env.key('i');assert.match(env.text(),/\*{3}word\*{3}/);assert.ok(env.instance.view.dom.querySelector('strong em,em strong'));
 env.key('z');assert.equal(env.text(),'**word**');env.key('z');assert.equal(env.text(),'word');env.key('y');assert.equal(env.text(),'**word**');
 assert.equal(env.changes(),5);assert.equal(env.instance.markdownShortcuts.length,markdownShortcuts.length);env.close();
});

test('fixed block and inline keys work through the visual editor keyboard handlers',async()=>{
 const env=await editor();const expected={bold:'**word**',italic:'*word*',strike:'~~word~~',code:'`word`',link:'[word](https://example.org)',fence:'```\nword\n```',
 heading0:'word',heading1:'# word',heading2:'## word',heading3:'### word',heading4:'#### word',heading5:'##### word',heading6:'###### word',bullet:'- word',number:'1. word',task:'- [ ] word',quote:'> word'};
 for(const binding of markdownShortcuts){
  env.instance.sync(binding.action==='heading0'?'## word':'word',false,'');env.instance.editor.commands.selectAll();
  const parts=binding.key.split('-'),shiftKey=parts.includes('Shift'),name=parts.at(-1),actual=shiftKey?({7:'&',8:'*',9:'('}[name]||name.toUpperCase()):name;
  env.key(actual,{shiftKey,altKey:parts.includes('Alt'),keyCode:name.toUpperCase().charCodeAt(0),code:/\d/.test(name)?'Digit'+name:'Key'+name.toUpperCase()});
  if(binding.action==='link'){const dialog=env.window.document.querySelector('.note-rich-dialog');assert.ok(dialog);dialog.querySelector('input[aria-label=URL]').value='https://example.org';dialog.querySelector('button').click();}
  assert.equal(env.text(),expected[binding.action],binding.key);
 }
 env.close();
});

test('formatting never changes discussion inputs or read-only notes',async()=>{
 for(const options of [{note:false},{disabled:true}]){const env=await editor(options);env.key('b');assert.equal(env.text(),'word');assert.equal(env.instance.formatMarkdown('bold'),false);assert.equal(env.changes(),0);env.close();}
});

test('visual selections supply only the selected Markdown and support targeted replacement',async()=>{
 const env=await editor({text:'Before **selected** after'});let from;
 env.instance.editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='selected')from=pos;});
 env.instance.editor.commands.setTextSelection({from,to:from+8});const snapshot=env.instance.getSelectionSnapshot();
 assert.match(snapshot.markdown,/selected/);assert.doesNotMatch(snapshot.markdown,/Before|after/);
 assert.equal(env.instance.replaceMarkdownRange('*replacement*',snapshot.from,snapshot.to),true);
 assert.match(env.text(),/Before .*replacement.* after/);assert.doesNotMatch(env.text(),/selected/);assert.equal(env.changes(),1);env.close();
});

test('formula editing renders MathML and persists LaTeX Markdown rather than editor HTML',async()=>{
 const env=await editor({text:'Equation $x^2$.'}),math=env.instance.view.dom.querySelector('[data-type=inline-math]');
 assert.ok(math.querySelector('math'));math.dispatchEvent(new env.window.MouseEvent('click',{bubbles:true,cancelable:true}));
 const block=env.instance.view.dom.querySelector('.note-inline-source');assert.ok(block);
 const source=EditorView.findFromDOM(block.querySelector('.cm-editor'));assert.equal(source.state.doc.toString(),'$x^2$');
 source.dispatch({changes:{from:0,to:source.state.doc.length,insert:'$y^3$'}});
 source.dispatch({selection:{anchor:source.state.doc.length}});
 source.contentDOM.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await Promise.resolve();
 assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null);
 assert.match(env.text(),/\$y\^3\$/);assert.doesNotMatch(env.text(),/<math|<span|latex/);assert.ok(env.instance.view.dom.querySelector('math'));env.close();
});

test('plain text does not expand neighbouring marks and each inline construct restores automatically',async()=>{
 const original='Start **bold** then [link](https://example.org) and *italic* and `code`.';
 const env=await editor({text:original});env.instance.view.focus();env.instance.editor.commands.setTextSelection(3);await Promise.resolve();
 assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null);assert.ok(env.instance.view.dom.querySelector('strong'));
 for(const [text,expected] of [['bold','**bold**'],['link','[link](https://example.org)'],['italic','*italic*'],['code','`code`']]){
  let position;env.instance.editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text===text)position=pos+1;});
  env.instance.view.focus();env.instance.editor.commands.setTextSelection(position);await Promise.resolve();
  const dom=env.instance.view.dom.querySelector('.note-inline-source');assert.ok(dom,text);
  const source=EditorView.findFromDOM(dom.querySelector('.cm-editor'));assert.equal(source.state.doc.toString(),expected);
  assert.equal(env.instance.view.dom.querySelectorAll('.note-inline-source').length,1);assert.equal(env.text(),original);assert.equal(env.changes(),0);
  source.dispatch({selection:{anchor:source.state.doc.length}});source.contentDOM.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await Promise.resolve();
  assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null,text+' collapses by normal caret movement');
 }
 assert.ok(env.instance.view.dom.querySelector('strong'));assert.ok(env.instance.view.dom.querySelector('a'));assert.ok(env.instance.view.dom.querySelector('em'));assert.ok(env.instance.view.dom.querySelector('code'));env.close();
});

test('cursor entry reveals only the active inline construct and restores rendering on focus leave',async()=>{
 const original='# First\n\nA **bold** paragraph.\n\n## Last';
 const env=await editor({text:original});env.instance.view.focus();env.instance.editor.commands.setTextSelection(12);await Promise.resolve();
 const block=env.instance.view.dom.querySelector('.note-inline-source');assert.ok(block);assert.equal(env.changes(),0);assert.equal(env.text(),original);
 assert.equal(env.instance.view.dom.querySelectorAll('.note-source-hidden').length,1);
 const source=EditorView.findFromDOM(block.querySelector('.cm-editor'));assert.equal(source.state.doc.toString(),'**bold**');
 assert.equal(env.instance.view.dom.querySelector('p').textContent.includes('A '),true);
 assert.equal(env.instance.view.dom.querySelectorAll('.note-block-source').length,0);
 source.dispatch({changes:{from:0,to:source.state.doc.length,insert:'Unfinished **'}});assert.match(env.text(),/Unfinished \*\*/, 'unfinished source is saved literally while editing');
 source.dispatch({changes:{from:0,to:source.state.doc.length,insert:'**changed**'}});
 assert.match(env.text(),/\*\*changed\*\*/);assert.match(env.text(),/A \*\*.*?\*\* paragraph\./);assert.match(env.text(),/## Last/);assert.equal(env.changes(),2);
 assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),block,'typing keeps the same focused source editor');
 const start=source.state.doc.toString().indexOf('changed');source.dispatch({selection:{anchor:start,head:start+7}});
 const snapshot=env.instance.getSelectionSnapshot();assert.equal(snapshot.markdown,'changed');
 const button=env.window.document.createElement('button');env.window.document.body.append(button);button.focus();await Promise.resolve();
 assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null);assert.equal(env.instance.getSelectionSnapshot().markdown,'changed','selection survives focus moving into the discussion');
 assert.equal(env.instance.replaceMarkdownRange('revised',snapshot.from,snapshot.to,snapshot.sourceSelection),true);
 assert.match(env.text(),/\*\*revised\*\*/);assert.match(env.text(),/A \*\*.*?\*\* paragraph\./);env.close();
});

test('external source updates refresh the rendered document without emitting edits',async()=>{
 const env=await editor();env.instance.sync('## Revised\n\n**new**',false,'');assert.equal(env.instance.view.dom.querySelector('h2').textContent,'Revised');
 assert.equal(env.instance.view.dom.querySelector('strong').textContent,'new');assert.equal(env.text(),'## Revised\n\n**new**');assert.equal(env.changes(),0);env.close();
});

test('unchanged discussion refreshes do not dispatch editor transactions',async()=>{
 const env=await editor({note:false});const state=env.instance.view.state;
 for(let i=0;i<100;i++)env.instance.sync('word',false,'');
 assert.equal(env.instance.view.state,state,'a no-op refresh must preserve the actual editor state');
 env.instance.sync('word',true,'Read only');assert.equal(env.instance.view.contentDOM.getAttribute('contenteditable'),'false');
 env.instance.sync('New draft',true,'Read only');assert.equal(env.text(),'New draft');assert.equal(env.instance.view.contentDOM.getAttribute('contenteditable'),'false');
 env.instance.sync('New draft',false,'Write');assert.equal(env.instance.view.contentDOM.getAttribute('contenteditable'),'true');env.close();
});

test('outside mouse clicks render the old source and switch directly to the clicked construct',async()=>{
 const env=await editor({text:'Before **bold** then *italic* after.'});let bold,italic;
 env.instance.editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='bold')bold=pos+1;if(node.isText&&node.text==='italic')italic=pos+1;});
 env.instance.view.focus();env.instance.editor.commands.setTextSelection(bold);await Promise.resolve();
 let source=env.instance.view.dom.querySelector('.note-inline-source');assert.ok(source);
 const cm=EditorView.findFromDOM(source.querySelector('.cm-editor'));cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'**edited**'}});
 env.instance.editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='italic')italic=pos+1;});
 env.instance.view.posAtCoords=()=>({pos:italic,inside:0});
 const target=env.instance.view.dom.querySelector('em');
 for(const type of ['mousedown','mouseup','click'])target.dispatchEvent(new env.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:100,clientY:20}));
 await Promise.resolve();source=env.instance.view.dom.querySelector('.note-inline-source');assert.ok(source);
 assert.equal(EditorView.findFromDOM(source.querySelector('.cm-editor')).state.doc.toString(),'*italic*');assert.equal(env.instance.view.dom.querySelector('strong').textContent,'edited');
 assert.match(env.text(),/\*\*edited\*\*/);
 env.instance.view.posAtCoords=()=>({pos:3,inside:0});
 const plain=env.instance.view.dom.querySelector('p');for(const type of ['mousedown','mouseup','click'])plain.dispatchEvent(new env.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:10,clientY:20}));
 await Promise.resolve();assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null);assert.equal(env.instance.view.dom.querySelector('em').textContent,'italic');env.close();
});

test('clicking inside expanded source moves its caret and supports Shift selection without changing Markdown',async()=>{
 const env=await editor({text:'Before **bold** after.'});
 env.instance.view.focus();env.instance.editor.commands.setTextSelection(10);await Promise.resolve();
 const block=env.instance.view.dom.querySelector('.note-inline-source'),source=EditorView.findFromDOM(block.querySelector('.cm-editor'));
 const click=(position,options={})=>{
  source.posAtCoords=()=>position;
  for(const type of ['mousedown','mouseup','click'])source.contentDOM.dispatchEvent(new env.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:40,clientY:10,detail:1,...options}));
 };
 click(2);assert.equal(source.state.selection.main.head,2);
 click(5);assert.equal(source.state.selection.main.head,5);
 click(3,{shiftKey:true});assert.equal(source.state.selection.main.anchor,5);assert.equal(source.state.selection.main.head,3);
 assert.equal(env.text(),'Before **bold** after.');assert.equal(env.changes(),0);
 click(3);source.dispatch({changes:{from:source.state.selection.main.head,insert:'X'}});
 assert.match(env.text(),/\*\*bXold\*\*/);assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),block);env.close();
});

test('source caret placement preserves native drag and multi-click selections',async()=>{
 const env=await editor({text:'**bold words**'});env.instance.view.focus();env.instance.editor.commands.setTextSelection(2);await Promise.resolve();
 const block=env.instance.view.dom.querySelector('.note-inline-source'),source=EditorView.findFromDOM(block.querySelector('.cm-editor'));
 source.posAtCoords=()=>1;
 const mouse=(type,x,detail=1)=>source.contentDOM.dispatchEvent(new env.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:10,detail}));
 mouse('mousedown',10);source.dispatch({selection:{anchor:2,head:8}});mouse('mouseup',80);mouse('click',80);
 assert.equal(source.state.selection.main.from,2);assert.equal(source.state.selection.main.to,8);
 mouse('mousedown',10,2);source.dispatch({selection:{anchor:2,head:6}});mouse('mouseup',10,2);mouse('click',10,2);
 assert.equal(source.state.selection.main.from,2);assert.equal(source.state.selection.main.to,6);assert.equal(env.changes(),0);env.close();
});

test('caret immediately after bold text reveals source before its closing stars',async()=>{
 for(const text of ['Before **bold** after.','Before **bold**']){
  const env=await editor({text});let end;
  env.instance.editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='bold')end=pos+node.nodeSize;});
  env.instance.view.focus();env.instance.editor.commands.setTextSelection(end);await Promise.resolve();
  const block=env.instance.view.dom.querySelector('.note-inline-source');assert.ok(block,text);
  const source=EditorView.findFromDOM(block.querySelector('.cm-editor'));
  assert.equal(source.state.doc.toString(),'**bold**');assert.equal(source.state.selection.main.head,6);
  assert.equal(env.changes(),0);env.close();
 }
});

test('moving to either outer star boundary renders immediately and does not reopen on keyup',async()=>{
 for(const side of ['left','right']){
  const env=await editor({text:'Before **bold** after.'});env.instance.view.focus();env.instance.editor.commands.setTextSelection(12);await Promise.resolve();
  const block=env.instance.view.dom.querySelector('.note-inline-source'),source=EditorView.findFromDOM(block.querySelector('.cm-editor'));
  source.dispatch({selection:{anchor:side==='left'?1:7}});await Promise.resolve();
  assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),block,'caret between the stars keeps editing');
  source.dispatch({selection:{anchor:side==='left'?0:8}});await Promise.resolve();await Promise.resolve();
  assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null,'outer boundary renders without another key');
  env.instance.view.dom.dispatchEvent(new env.window.KeyboardEvent('keyup',{key:side==='left'?'ArrowLeft':'ArrowRight',bubbles:true}));await Promise.resolve();
  assert.equal(env.instance.view.dom.querySelector('.note-inline-source'),null,'the exit position stays rendered');
  assert.equal(env.text(),'Before **bold** after.');assert.equal(env.changes(),0);env.close();
 }
});
