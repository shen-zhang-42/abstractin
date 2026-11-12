import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdownShortcuts } from './markdown-shortcuts.js';

// Reveal one Markdown construct at the caret, keeping neighbouring text rendered.
// The source editor is transient; only actual edits change saved Markdown.
export function noteSource(config) {
 const key = new PluginKey('noteSource');
 let editor, active = null, serial = 0, queued = false, destroyed = false, paused = false, lastSelection = null, pendingClick = null, sourceClick = null;
 const selection = () => {
  if(!active)return lastSelection;
  const {from,to}=active.view.state.selection.main;
  return {from:active.from,to:active.to,markdown:active.view.state.doc.sliceString(from,to),sourceSelection:{markdown:active.view.state.doc.toString(),from,to,inline:active.inline}};
 };
 const clear = (preserveSelection = false) => {
  if (!active) return;
  const snapshot=selection(); lastSelection=preserveSelection && snapshot.markdown ? snapshot : null;
  const previous = active; active = null;
  editor.view.dispatch(editor.state.tr.setMeta(key, true));
  previous.view.destroy();
 };
 const format = action => {
  if (!active) return false;
  const view = active.view, {from, to} = view.state.selection.main;
  const text = view.state.doc.toString(), selected = text.slice(from, to);
  const wrappers = {bold:'**',italic:'*',strike:'~~',code:'`',fence:'```\n'};
  let insert, anchor, head;
  if (wrappers[action]) {
   const left = wrappers[action], right = action === 'fence' ? '\n```' : left;
   insert = left + selected + right; anchor = from + left.length; head = anchor + selected.length;
  } else if (action === 'link') {
   insert = '[' + (selected || 'link text') + '](https://)'; anchor = from + insert.indexOf('https://'); head = anchor + 8;
  } else {
   const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to);
   const prefix = /^heading[0-6]$/.test(action) ? '#'.repeat(Number(action.at(-1))) : {bullet:'-',number:'1.',task:'- [ ]',quote:'>'}[action];
   if (prefix === undefined) return false;
   insert = text.slice(first.from,last.to).split('\n').map(line => {
    const content = line.replace(/^\s*(?:#{1,6}\s+|>\s*|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)/,'');
    return (prefix ? prefix + ' ' : '') + content;
   }).join('\n');
   view.dispatch({changes:{from:first.from,to:last.to,insert},selection:{anchor:first.from+insert.length}}); return true;
  }
  view.dispatch({changes:{from,to,insert},selection:{anchor,head}}); return true;
 };
 const open = position => {
  if (destroyed || !editor.isEditable) return false;
  const doc = editor.state.doc, pos = Math.max(0,Math.min(position,doc.content.size)), resolved = doc.resolve(pos);
  if (active && pos >= active.from && pos < active.to) return true;
  clear();
  lastSelection=null;
  let from, to, inline=false;
  if(resolved.parent.type.name==='codeBlock'){
   from=resolved.before();to=from+resolved.parent.nodeSize;
  }else if(resolved.parent.inlineContent){
   const parent=resolved.parent, start=resolved.start();let at=0, children=[];
   parent.forEach(node=>{children.push({node,from:start+at,to:start+at+node.nodeSize});at+=node.nodeSize;});
   const index=children.findIndex(child=>pos>=child.from&&pos<child.to), child=children[index];
   if(!child)return false;
   if(child.node.isAtom&&!child.node.isText){from=child.from;to=child.to;}
   else if(child.node.marks.length){
    // Expand the enclosing mark run, rather than unrelated marks in this paragraph.
    let widest;
    for(const mark of child.node.marks){
     let left=index,right=index;
     while(left>0&&mark.isInSet(children[left-1].node.marks))left--;
     while(right+1<children.length&&mark.isInSet(children[right+1].node.marks))right++;
     const range={from:children[left].from,to:children[right].to};
     if(!widest||range.to-range.from>widest.to-widest.from)widest=range;
    }
    ({from,to}=widest);
   }else return false;
   inline=true;
  }else{
   const node=doc.nodeAt(pos);
   if(!node||!['blockMath','codeBlock'].includes(node.type.name))return false;
   from=pos;to=pos+node.nodeSize;
  }
  const slice=doc.slice(from,to), content=slice.content.toJSON()||[];
  const markdown = editor.markdown.serialize({type:'doc',content:inline?[{type:'paragraph',content}]:content});
  const dom = document.createElement(inline?'span':'div'); dom.className = inline?'note-inline-source':'note-block-source'; dom.contentEditable = 'false';
  const session = active = {from,to,inline,dom,id:++serial,view:null};
  session.view = new EditorView({parent:dom,state:EditorState.create({doc:markdown,extensions:[
   history(), EditorView.lineWrapping,
   keymap.of([...markdownShortcuts.map(binding=>({key:binding.key,run:()=>format(binding.action)})),...historyKeymap,...defaultKeymap]),
   EditorView.contentAttributes.of({'aria-label':'Markdown source',spellcheck:'false'}),
   Prec.highest(EditorView.domEventHandlers({
    keydown(event) {
     if (event.isComposing) return false;
     if (event.key === 'Escape') { event.preventDefault(); paused=true; const at=session.from; clear(); editor.commands.setTextSelection(Math.min(at+1,editor.state.doc.content.size)); editor.view.focus(); return true; }
     const range=session.view.state.selection.main;
     const direction=range.empty && range.head===0 && ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : range.empty && range.head===session.view.state.doc.length && ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : 0;
     if(direction){
      event.preventDefault(); const at=Math.max(0,Math.min(editor.state.doc.content.size,direction<0?session.from-1:session.to));
      clear(); editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at),direction))); editor.view.focus(); schedule(); return true;
     }
     if(session.inline && event.key==='Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey){
      event.preventDefault(); const at=session.to; clear();editor.commands.setTextSelection(at);editor.commands.splitBlock();editor.view.focus();return true;
     }
     return config.onKey(event);
    },
    focusout() { queueMicrotask(()=>{if(active===session && !session.dom.contains(document.activeElement)) clear(true);}); return false; },
   })),
   EditorView.updateListener.of(update=>{
    if (!update.docChanged || active!==session) return;
    const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(update.state.doc.toString()));
    const replacement = session.inline && parsed.childCount===1 && parsed.firstChild.type.name==='paragraph' ? parsed.firstChild.content : parsed.content.size ? parsed.content : editor.schema.nodes.paragraph.create();
    const tr = editor.state.tr.replaceWith(session.from,session.to,replacement);
    session.to = session.from + tr.doc.content.size - editor.state.doc.content.size + (session.to-session.from);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(session.from+1,tr.doc.content.size))));
    editor.view.dispatch(tr.setMeta(key,true));
   }),
  ]})});
  editor.view.dispatch(editor.state.tr.setMeta(key,true));
  const text=doc.textBetween(from,to,'\n');
  const offset = Math.min(markdown.length,Math.max(0,markdown.indexOf(text))+Math.max(0,pos-from));
  session.view.dispatch({selection:{anchor:offset}}); session.view.focus(); return true;
 };
 const schedule = () => {
  if (queued || destroyed) return;
  queued=true; queueMicrotask(()=>{
   queued=false; if(destroyed || paused || active?.dom.contains(document.activeElement) || !editor.view.hasFocus()) return;
   if(editor.state.selection.empty) open(editor.state.selection.from); else clear();
  });
 };
 const finish = () => { paused=true; pendingClick=null; sourceClick=null; clear(true); };
 const pointerDown = event => {
  pendingClick=null;sourceClick=null;
  if(!active || event.button!==0)return;
  if(active.dom.contains(event.target)){
   sourceClick={session:active,x:event.clientX,y:event.clientY,anchor:active.view.state.selection.main.anchor};
   return;
  }
  const inside=editor.view.dom.contains(event.target);
  const control=event.target.closest?.('button,input,textarea,select,summary');
  const hit=inside&&!control ? editor.view.posAtCoords({left:event.clientX,top:event.clientY}) : null;
  // Capture the logical target before collapsing source changes line geometry.
  // Pause the focus/selection callbacks until the native click has completed.
  paused=true;
  if(hit)pendingClick={pos:hit.pos,x:event.clientX,y:event.clientY};
  clear(!inside);
 };
 const pointerClick = event => {
  const source=sourceClick;sourceClick=null;
  if(source && active===source.session && active.dom.contains(event.target)){
   // Explicitly place the nested editor's caret. The outer contenteditable=false
   // widget can otherwise interfere with native selection in the host browser.
   // Leave drags and multi-click word/line selection to CodeMirror.
   if(event.button!==0 || event.detail>1 || Math.hypot(event.clientX-source.x,event.clientY-source.y)>4)return;
   const view=active.view, pos=view.posAtCoords({x:event.clientX,y:event.clientY},false);
   if(pos===null)return;
   event.preventDefault();event.stopPropagation();
   view.dispatch({selection:{anchor:event.shiftKey?source.anchor:pos,head:pos}});view.focus();
   return;
  }
  const target=pendingClick;pendingClick=null;
  if(!target)return;
  paused=false;
  if(event.shiftKey||Math.hypot(event.clientX-target.x,event.clientY-target.y)>4)return;
  event.preventDefault();event.stopPropagation();
  const pos=Math.max(0,Math.min(target.pos,editor.state.doc.content.size));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))));
  editor.view.focus();open(pos);
 };
 const extension = Extension.create({name:'noteSource',
  onCreate(){editor=this.editor;},
  addProseMirrorPlugins(){editor=this.editor;return [new Plugin({key,
   props:{
    decorations(state){
     if(!active) return DecorationSet.empty;
     const decorations=[Decoration.widget(active.from,()=>active.dom,{key:'source-'+active.id,side:-1,stopEvent:()=>true,ignoreSelection:true})];
     if(active.inline)decorations.push(Decoration.inline(active.from,active.to,{class:'note-source-hidden'}));
     state.doc.nodesBetween(active.from,active.to,(node,pos)=>{if(pos>=active.from && pos+node.nodeSize<=active.to && (!active.inline||node.isAtom&&!node.isText)){decorations.push(Decoration.node(pos,pos+node.nodeSize,{class:'note-source-hidden'}));return false;}});
     return DecorationSet.create(state.doc,decorations);
    },
    handleDOMEvents:{focus:schedule,mouseup(){if(!pendingClick){paused=false;schedule();}},keyup(_view,event){if(event.key!=='Escape')paused=false;schedule();}},
   },
   view(){
    document.addEventListener('mousedown',pointerDown,true);document.addEventListener('click',pointerClick,true);window.addEventListener('blur',finish);
    return {update(view,previous){
    if(!active && previous.doc!==view.state.doc)lastSelection=null;
    if(active && !active.dom.contains(document.activeElement) && previous.doc!==view.state.doc) queueMicrotask(()=>{if(!destroyed)clear();});
    if(!previous.selection.eq(view.state.selection)){lastSelection=null;schedule();}
   },destroy(){destroyed=true;document.removeEventListener('mousedown',pointerDown,true);document.removeEventListener('click',pointerClick,true);window.removeEventListener('blur',finish);active?.view.destroy();active=null;}};},
  })];},
 });
 return {extension,open,clear,finish,format,selection,measure:()=>active?.view.requestMeasure(),isActive:()=>!!active,
  markdown(){
   if(!active)return undefined;
   const marker='ABSTRACTINRAWSOURCE'+active.id+'PLACEHOLDER';
   const placeholder=editor.state.tr.replaceWith(active.from,active.to,editor.schema.text(marker)).doc;
   return editor.markdown.serialize(placeholder.toJSON()).replace(marker,()=>active.view.state.doc.toString());
  },
 };
}
