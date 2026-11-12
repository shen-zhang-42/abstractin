import { Compartment, EditorSelection, EditorState, Prec, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { livePreviewPlugin, markdownStylePlugin, editorTheme, mouseSelectingField, collapseOnSelectionFacet, setMouseSelecting, tableField, tableEditorPlugin, mathPlugin, blockMathField, codeBlockField, imageField, linkPlugin, shouldShowSource } from 'codemirror-live-markdown';
import { markdownShortcuts } from './markdown-shortcuts.js';

// The upstream library owns preview boundaries and pointer interactions. This
// adapter supplies application commands, persistence and exact source selections.
export function createLiveNote(config) {
 window.katex = katex;
 const root = document.getElementById('editor'), enabled = new Compartment(), hint = new Compartment(), tables = new Compartment();
 let syncing = false, destroyed = false, disabled = !!config.disabled, currentHint = config.placeholder || '';
 let savedSelection = null;
 const format = action => {
  if (disabled) return false;
  const { from, to } = view.state.selection.main, text = view.state.doc.toString(), selected = text.slice(from, to);
  const wrappers = { bold: '**', italic: '*', strike: '~~', code: '`' };
  let start = from, end = to, insert, anchor, head;
  if (wrappers[action]) {
   const marker = wrappers[action];
   // Formatting commands exclude edge whitespace without altering selection gestures.
   const leading = selected.match(/^\s*/)[0].length, trailing = selected.match(/\s*$/)[0].length;
   if (selected && leading === selected.length) return false;
   start += leading; end -= trailing;
   const body = text.slice(start, end);
   if (text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker) {
    start -= marker.length; end += marker.length; insert = body; anchor = start; head = start + body.length;
   } else if (body.startsWith(marker) && body.endsWith(marker) && body.length >= marker.length * 2) {
    insert = body.slice(marker.length, -marker.length); anchor = start; head = start + insert.length;
   } else { insert = marker + body + marker; anchor = start + marker.length; head = anchor + body.length; }
  } else if (['link', 'fence', 'table', 'math'].includes(action)) {
   if (action === 'link') { insert = '[' + (selected || 'text') + '](https://)'; anchor = start + 1; head = anchor + (selected || 'text').length; }
   if (action === 'fence') { insert = '\n\n```\n' + selected + '\n```\n'; anchor = start + 6; head = anchor + selected.length; }
   if (action === 'table') { insert = '\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n\n'; anchor = head = start + insert.length; }
   if (action === 'math') { insert = '$' + (selected || 'x^2') + '$'; anchor = start + 1; head = anchor + (selected || 'x^2').length; }
  } else {
   const first = view.state.doc.lineAt(from), last = view.state.doc.lineAt(to);
   start = first.from; end = last.to;
   const lines = text.slice(start, end).split('\n');
   insert = lines.map((line, index) => {
    if (action.startsWith('heading')) return '#'.repeat(Number(action.slice(7))) + (action === 'heading0' ? '' : ' ') + line.replace(/^#{1,6}\s+/, '');
    const prefix = { bullet: '- ', number: (index + 1) + '. ', task: '- [ ] ', quote: '> ' }[action];
    return prefix === undefined ? line : line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
   }).join('\n'); anchor = start; head = start + insert.length;
  }
  view.dispatch({ changes: { from: start, to: end, insert }, selection: EditorSelection.single(anchor, head), scrollIntoView: true, userEvent: 'input.format' });
  view.focus(); return true;
 };
 // Keep existing $...$ and $$...$$ notes compatible. Upstream's math modules
 // additionally support its backtick-dollar and fenced-math forms.
 class Formula extends WidgetType {
  constructor(token) { super(); this.token = token; }
  eq(other) { return this.token.source === other.token.source; }
  toDOM() { const node = document.createElement(this.token.display ? 'div' : 'span'); node.className = 'note-formula'; node.title = 'Click to edit formula'; katex.render(this.token.tex, node, { displayMode: this.token.display, throwOnError: false, trust: false }); return node; }
  ignoreEvent() { return false; }
 }
 const formulas = state => {
  const excluded = [];
  syntaxTree(state).iterate({ enter(node) { if (['FencedCode', 'CodeBlock', 'InlineCode', 'Table'].includes(node.name)) { excluded.push([node.from, node.to]); return false; } } });
  return Decoration.set(config.tokens(state.doc.toString()).filter(token => !excluded.some(([from, to]) => token.start < to && token.end > from) && !shouldShowSource(state, token.start, token.end)).map(token => Decoration.replace({ widget: new Formula(token), block: token.display }).range(token.start, token.end)), true);
 };
 const dollarMath = StateField.define({ create: formulas, update(value, tr) { return tr.docChanged || tr.selection || tr.reconfigured ? formulas(tr.state) : value; }, provide: field => EditorView.decorations.from(field) });
 const toolbar = document.createElement('div'); toolbar.className = 'note-format-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Markdown formatting');
 for (const [action, label, title] of [['bold','B','Bold'],['italic','I','Italic'],['strike','S','Strikethrough'],['heading2','H','Heading'],['link','Link','Link'],['table','Table','Insert table'],['math','∑','Formula'],['fence','Code','Code block']]) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.dataset.action = action;
  button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => format(action)); toolbar.append(button);
 }
 root.append(toolbar);
 const publish = update => {
  if (syncing || destroyed) return;
  const range = update.state.selection.main;
  if (update.docChanged) savedSelection = null;
  if (!range.empty) savedSelection = { from: range.from, to: range.to, markdown: update.state.sliceDoc(range.from, range.to), sourceSelection: { baseMarkdown: update.state.doc.toString() } };
  else if (update.selectionSet) savedSelection = null;
  if (update.docChanged) config.onChange(update.state.doc.toString(), range.anchor, range.head, true);
 };
 const extensions = [
  markdown({ extensions: [GFM] }), collapseOnSelectionFacet.of(true), mouseSelectingField,
  livePreviewPlugin, markdownStylePlugin, editorTheme, tables.of(disabled ? tableField : tableEditorPlugin()), mathPlugin, blockMathField, dollarMath,
  codeBlockField({ copyButton: true }), imageField(), linkPlugin(), history(), drawSelection(), EditorView.lineWrapping,
  enabled.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]), hint.of(placeholder(currentHint)),
  Prec.highest(keymap.of(markdownShortcuts.map(binding => ({ key: binding.key, run: () => format(binding.action) })))),
  keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]), EditorView.updateListener.of(publish),
  EditorView.domEventHandlers({ paste(event) { return !!config.onPaste(event); }, drop(event) { return !!config.onDrop(event); } }),
  EditorView.theme({ '&': { height: '100%', font: 'inherit', color: 'inherit', backgroundColor: 'transparent' }, '&.cm-focused': { outline: 'none' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.8' }, '.cm-content': { padding: '12px 8px 80px', caretColor: 'currentColor' }, '.cm-line': { padding: '0 2px' }, '.cm-cursor': { borderLeftColor: 'currentColor' } }),
 ];
 const view = new EditorView({ parent: root, state: EditorState.create({ doc: config.text || '', extensions }) });
 view.contentDOM.setAttribute('aria-label', 'Markdown note');
 const mouseDown = () => view.dispatch({ effects: setMouseSelecting.of(true) });
 let releaseFrame = 0;
 const mouseUp = () => { cancelAnimationFrame(releaseFrame); releaseFrame = requestAnimationFrame(() => { if (!destroyed) view.dispatch({ effects: setMouseSelecting.of(false) }); }); };
 view.contentDOM.addEventListener('mousedown', mouseDown); document.addEventListener('mouseup', mouseUp);
 const appKey = event => { if (!event.isComposing && config.onKey(event)) { event.preventDefault(); event.stopPropagation(); } };
 root.addEventListener('keydown', appKey, true);
 const flush = () => { document.activeElement?.closest?.('.cm-table-cell')?.blur(); };
 return {
  view, markdownShortcuts, flush, formatMarkdown: format,
  getMarkdown() { flush(); return view.state.doc.toString(); },
  getSelectionSnapshot() { flush(); return savedSelection || { from: 0, to: 0, markdown: '' }; },
  replaceMarkdownRange(markdown, from, to, snapshot) {
   if (disabled || !snapshot || snapshot.baseMarkdown !== view.state.doc.toString() || from < 0 || to < from || to > view.state.doc.length) return false;
   view.dispatch({ changes: { from, to, insert: markdown }, selection: { anchor: from + markdown.length }, userEvent: 'input.ai' }); return true;
  },
  sync(text, nextDisabled, label) {
   if (destroyed) return;
   syncing = true;
   try {
    const replaced = text !== view.state.doc.toString();
    if (replaced) { savedSelection = null; view.setState(EditorState.create({ doc: text, extensions })); }
    const effects = [];
    if (replaced || disabled !== !!nextDisabled) { disabled = !!nextDisabled; effects.push(enabled.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]), tables.reconfigure(disabled ? tableField : tableEditorPlugin())); }
    if (replaced || currentHint !== (label || '')) { currentHint = label || ''; effects.push(hint.reconfigure(placeholder(currentHint))); }
    if (effects.length) view.dispatch({ effects });
    for (const button of toolbar.children) button.disabled = disabled;
   } finally { syncing = false; }
  },
  focus() { if (!disabled) view.focus(); },
  select(anchor, head) { view.dispatch({ selection: EditorSelection.single(Math.min(anchor, view.state.doc.length), Math.min(head, view.state.doc.length)), scrollIntoView: true }); },
  measure() { view.requestMeasure(); },
  destroy() { destroyed = true; cancelAnimationFrame(releaseFrame); root.removeEventListener('keydown', appKey, true); view.contentDOM.removeEventListener('mousedown', mouseDown); document.removeEventListener('mouseup', mouseUp); view.destroy(); toolbar.remove(); },
 };
}
