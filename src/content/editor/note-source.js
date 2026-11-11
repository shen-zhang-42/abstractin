import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdownShortcuts } from './markdown-shortcuts.js';

// Only the active block gets a source editor. Its Markdown is parsed back into
// the document on each edit; focus/selection alone never changes saved source.
export function noteSource(config) {
 const key = new PluginKey('noteSource');
 let editor, active = null, serial = 0, queued = false, destroyed = false, paused = false, lastSelection = null;
 const selection = () => {
  if(!active)return lastSelection;
  const {from,to}=active.view.state.selection.main;
  return {from:active.from,to:active.to,markdown:active.view.state.doc.sliceString(from,to),sourceSelection:{markdown:active.view.state.doc.toString(),from,to}};
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
  const index = resolved.index(0); if (index >= doc.childCount) return false;
  const node = doc.child(index), from = resolved.depth ? resolved.before(1) : pos;
  if (active && from >= active.from && from < active.to) return true;
  clear();
  lastSelection=null;
  // Ordinary, unformatted paragraphs already expose their complete source.
  if (node.type.name === 'paragraph' && node.content.content.every(child => child.isText && !child.marks.length)) return false;
  const markdown = editor.markdown.serialize({type:'doc',content:[node.toJSON()]});
  const dom = document.createElement('div'); dom.className = 'note-block-source'; dom.contentEditable = 'false';
  const session = active = {from,to:from+node.nodeSize,dom,id:++serial,view:null};
  session.view = new EditorView({parent:dom,state:EditorState.create({doc:markdown,extensions:[
   history(), EditorView.lineWrapping,
   keymap.of([...markdownShortcuts.map(binding=>({key:binding.key,run:()=>format(binding.action)})),...historyKeymap,...defaultKeymap]),
   EditorView.contentAttributes.of({'aria-label':'Markdown block source',spellcheck:'false'}),
   EditorView.domEventHandlers({
    keydown(event) {
     if (event.isComposing) return false;
     if (event.key === 'Escape') { event.preventDefault(); paused=true; const at=session.from; clear(); editor.commands.setTextSelection(Math.min(at+1,editor.state.doc.content.size)); editor.view.focus(); return true; }
     const range=session.view.state.selection.main;
     const direction=range.empty && range.head===0 && ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : range.empty && range.head===session.view.state.doc.length && ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : 0;
     if(direction){
      event.preventDefault(); const at=Math.max(0,Math.min(editor.state.doc.content.size,direction<0?session.from-1:session.to+1));
      clear(); editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at),direction))); editor.view.focus(); schedule(); return true;
     }
     return config.onKey(event);
    },
    focusout() { queueMicrotask(()=>{if(active===session && !session.dom.contains(document.activeElement)) clear(true);}); return false; },
   }),
   EditorView.updateListener.of(update=>{
    if (!update.docChanged || active!==session) return;
    const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(update.state.doc.toString()));
    const replacement = parsed.content.size ? parsed.content : editor.schema.nodes.paragraph.create();
    const tr = editor.state.tr.replaceWith(session.from,session.to,replacement);
    session.to = session.from + tr.doc.content.size - editor.state.doc.content.size + (session.to-session.from);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(session.from+1,tr.doc.content.size))));
    editor.view.dispatch(tr.setMeta(key,true));
   }),
  ]})});
  editor.view.dispatch(editor.state.tr.setMeta(key,true));
  const offset = Math.min(markdown.length,Math.max(0,markdown.indexOf(node.textContent))+Math.max(0,pos-from-1));
  session.view.dispatch({selection:{anchor:offset}}); session.view.focus(); return true;
 };
 const schedule = () => {
  if (queued || destroyed) return;
  queued=true; queueMicrotask(()=>{
   queued=false; if(destroyed || paused || active?.dom.contains(document.activeElement) || !editor.view.hasFocus()) return;
   if(editor.state.selection.empty) open(editor.state.selection.from); else clear();
  });
 };
 const extension = Extension.create({name:'noteSource',
  onCreate(){editor=this.editor;},
  addProseMirrorPlugins(){editor=this.editor;return [new Plugin({key,
   props:{
    decorations(state){
     if(!active) return DecorationSet.empty;
     const decorations=[Decoration.widget(active.from,()=>active.dom,{key:'source-'+active.id,side:-1,stopEvent:()=>true,ignoreSelection:true})];
     state.doc.nodesBetween(active.from,active.to,(node,pos)=>{if(pos>=active.from && pos+node.nodeSize<=active.to){decorations.push(Decoration.node(pos,pos+node.nodeSize,{class:'note-source-hidden'}));return false;}});
     return DecorationSet.create(state.doc,decorations);
    },
    handleDOMEvents:{focus:schedule,mouseup(){paused=false;schedule();},keyup(_view,event){if(event.key!=='Escape')paused=false;schedule();}},
   },
   view(){return {update(view,previous){
    if(!active && previous.doc!==view.state.doc)lastSelection=null;
    if(active && !active.dom.contains(document.activeElement) && previous.doc!==view.state.doc) queueMicrotask(()=>{if(!destroyed)clear();});
    if(!previous.selection.eq(view.state.selection)){lastSelection=null;schedule();}
   },destroy(){destroyed=true;active?.view.destroy();active=null;}};},
  })];},
 });
 return {extension,open,clear,format,selection,isActive:()=>!!active,
  markdown(){
   if(!active)return undefined;
   const before=editor.markdown.serialize(editor.state.doc.cut(0,active.from).toJSON());
   const after=editor.markdown.serialize(editor.state.doc.cut(active.to).toJSON());
   return [before,active.view.state.doc.toString(),after].filter(part=>part!=='').join('\n\n');
  },
 };
}
