import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {markdownShortcuts} from '../src/content/editor/markdown-shortcuts.js';

async function editor({note=true,disabled=false,text='word'}={}) {
 const dom=new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 const {window}=dom;window.ResizeObserver=class{observe(){}disconnect(){}};
 window.Range.prototype.getClientRects=()=>[]; window.Range.prototype.getBoundingClientRect=()=>({top:0,left:0,right:0,bottom:0,width:0,height:0});
 await window.eval(await readFile(new URL('../src/content/editor/composer.bundle.js',import.meta.url),'utf8'));
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
 const dialog=env.window.document.querySelector('.note-rich-dialog');assert.ok(dialog);dialog.querySelector('textarea').value='y^3';dialog.querySelector('button').click();
 assert.match(env.text(),/\$y\^3\$/);assert.doesNotMatch(env.text(),/<math|<span|latex/);assert.ok(env.instance.view.dom.querySelector('math'));env.close();
});

test('external source updates refresh the rendered document without emitting edits',async()=>{
 const env=await editor();env.instance.sync('## Revised\n\n**new**',false,'');assert.equal(env.instance.view.dom.querySelector('h2').textContent,'Revised');
 assert.equal(env.instance.view.dom.querySelector('strong').textContent,'new');assert.equal(env.text(),'## Revised\n\n**new**');assert.equal(env.changes(),0);env.close();
});
