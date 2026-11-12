import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { livePreviewPlugin, createLinkClickHandler, commitActiveTableCell } from '../../../vendor/tshoot/src/webview-editor/livePreviewPlugin';
import { blockDecorationsField } from '../../../vendor/tshoot/src/webview-editor/blockDecorations';
import { GFM as tableGFM } from '../../../vendor/tshoot/src/webview-editor/gfmTableFix';
import { headingSpaceInputHandler } from '../../../vendor/tshoot/src/webview-editor/headingSpacePlugin';
import { backtickInputHandler } from '../../../vendor/tshoot/src/webview-editor/backtickPairPlugin';
import { headingFoldExtension } from '../../../vendor/tshoot/src/webview-editor/headingFold';
import { backspaceBelowTable } from '../../../vendor/tshoot/src/webview-editor/tableBoundary';
import { codeScrollExtension } from '../../../vendor/tshoot/src/webview-editor/codeScroll';
import { tableHistoryRequest } from '../../../vendor/tshoot/src/webview-editor/tableCellEditor';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { noteFormulas } from './note-formulas.js';
import { noteDiagrams } from './note-diagrams.js';
import { noteQuoteBoundaries } from './note-quote-boundaries.js';
import '../../../vendor/tshoot/media/webview-editor-theme.css';
import '../../../vendor/tshoot/media/webview-ui.css';
import { markdownShortcuts } from './markdown-shortcuts.js';
import { noteToolbarControls } from './note-toolbar.js';

// The upstream library owns preview boundaries and pointer interactions. This
// adapter supplies application commands, persistence and exact source selections.
export function createTshootNote(config) {
 const root = document.getElementById('editor'), enabled = new Compartment(), hint = new Compartment();
 let syncing = false, destroyed = false, disabled = !!config.disabled, currentHint = config.placeholder || '';
 let savedSelection = null;
 const format = action => {
  if (disabled) return false;
  const activeCell = root.querySelector('.mlp-table-cell-editing .cm-editor');
  const target = activeCell ? EditorView.findFromDOM(activeCell) : view;
  const { from, to } = target.state.selection.main, text = target.state.doc.toString(), selected = text.slice(from, to);
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
   const first = target.state.doc.lineAt(from), last = target.state.doc.lineAt(to);
   start = first.from; end = last.to;
   const lines = text.slice(start, end).split('\n');
   insert = lines.map((line, index) => {
    if (action.startsWith('heading')) return '#'.repeat(Number(action.slice(7))) + (action === 'heading0' ? '' : ' ') + line.replace(/^#{1,6}\s+/, '');
    const prefix = { bullet: '- ', number: (index + 1) + '. ', task: '- [ ] ', quote: '> ' }[action];
    return prefix === undefined ? line : line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
   }).join('\n'); anchor = start; head = start + insert.length;
  }
  target.dispatch({ changes: { from: start, to: end, insert }, selection: EditorSelection.single(anchor, head), scrollIntoView: true, userEvent: 'input.format' });
  target.focus(); return true;
 };
 const toolbar = document.createElement('div'); toolbar.className = 'note-format-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Markdown formatting');
 for (const [action, label, title] of [['bold','B','Bold'],['italic','I','Italic'],['strike','S','Strikethrough'],['heading2','H','Heading'],['link','Link','Link'],['table','Table','Insert table'],['math','∑','Formula'],['fence','Code','Code block']]) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.dataset.action = action;
  button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => format(action)); toolbar.append(button);
 }
 const controls = noteToolbarControls(toolbar, { ...config, onFontChange: value => { view.requestMeasure(); config.onFontChange?.(value); } });
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
  markdown({ extensions: tableGFM }), closeBrackets(), noteQuoteBoundaries,
  livePreviewPlugin, blockDecorationsField, headingSpaceInputHandler, backtickInputHandler, headingFoldExtension, codeScrollExtension,
  tableHistoryRequest.of(type => { flush(); (type === 'undo' ? undo : redo)(view); }),
  createLinkClickHandler(href => { if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener'); }),
  noteFormulas(config.tokens), noteDiagrams, history(), drawSelection(), EditorView.lineWrapping, search({ top: true }),
  enabled.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]), hint.of(placeholder(currentHint)),
  Prec.highest(keymap.of(markdownShortcuts.map(binding => ({ key: binding.key, run: () => format(binding.action) })))),
  keymap.of([{ key: 'Backspace', run: backspaceBelowTable }, ...closeBracketsKeymap, ...searchKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]), EditorView.updateListener.of(publish),
  EditorView.domEventHandlers({ paste(event) { return !!config.onPaste(event); }, drop(event) { return !!config.onDrop(event); } }),
  EditorView.theme({ '&': { height: '100%', font: 'inherit', color: 'inherit', backgroundColor: 'transparent' }, '&.cm-focused': { outline: 'none' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.8' }, '.cm-content': { padding: '12px 8px 80px', caretColor: 'currentColor' }, '.cm-line': { padding: '0 2px' }, '.cm-cursor': { borderLeftColor: 'currentColor' } }),
 ];
 const view = new EditorView({ parent: root, state: EditorState.create({ doc: config.text || '', extensions }) });
 view.contentDOM.setAttribute('aria-label', 'Markdown note');
 const preventReadOnly = event => { if (disabled && event.target.closest('.mlp-table')) { event.preventDefault(); event.stopImmediatePropagation(); } };
 root.addEventListener('mousedown', preventReadOnly, true);
 const appKey = event => {
  if (!event.isComposing && (event.ctrlKey || event.metaKey)) {
   const key = /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key.toLowerCase();
   const binding = markdownShortcuts.find(({ key: shortcut }) => {
    const parts = shortcut.toLowerCase().split('-');
    return parts.at(-1) === key && parts.includes('alt') === event.altKey && parts.includes('shift') === event.shiftKey;
   });
   if (binding && format(binding.action)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  }
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') flush();
  if (!event.isComposing && config.onKey(event)) { event.preventDefault(); event.stopPropagation(); }
 };
 root.addEventListener('keydown', appKey, true);
 const flush = () => { if (!destroyed) commitActiveTableCell(view); };
 return {
  view, markdownShortcuts, flush, formatMarkdown: format,
  setFont(value) { if (controls.setFont(value)) view.requestMeasure(); },
  getMarkdown() { flush(); return view.state.doc.toString(); },
  getSelectionSnapshot() { flush(); return savedSelection || { from: 0, to: 0, markdown: '' }; },
  replaceMarkdownRange(markdown, from, to, snapshot) {
   if (disabled || !snapshot || snapshot.baseMarkdown !== view.state.doc.toString() || from < 0 || to < from || to > view.state.doc.length) return false;
   view.dispatch({ changes: { from, to, insert: markdown }, selection: { anchor: from + markdown.length }, userEvent: 'input.ai' }); return true;
  },
  sync(text, nextDisabled, label) {
   if (destroyed) return;
   if (nextDisabled && !disabled) {
    const previous = view.state.doc.toString();
    flush();
    if (text === previous) text = view.state.doc.toString();
   }
   syncing = true;
   try {
    const replaced = text !== view.state.doc.toString();
    if (replaced) { savedSelection = null; view.setState(EditorState.create({ doc: text, extensions })); }
    const effects = [];
    if (replaced || disabled !== !!nextDisabled) { disabled = !!nextDisabled; effects.push(enabled.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)])); }
    if (replaced || currentHint !== (label || '')) { currentHint = label || ''; effects.push(hint.reconfigure(placeholder(currentHint))); }
    if (effects.length) view.dispatch({ effects });
    for (const button of toolbar.querySelectorAll('[data-action]')) button.disabled = disabled;
   } finally { syncing = false; }
  },
  focus() { if (!disabled) view.focus(); },
  select(anchor, head) { view.dispatch({ selection: EditorSelection.single(Math.min(anchor, view.state.doc.length), Math.min(head, view.state.doc.length)), scrollIntoView: true }); },
  measure() { view.requestMeasure(); },
  destroy() { destroyed = true; controls.destroy(); root.removeEventListener('mousedown', preventReadOnly, true); root.removeEventListener('keydown', appKey, true); view.destroy(); toolbar.remove(); },
 };
}
