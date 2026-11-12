import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { markdownShortcuts } from './markdown-shortcuts.js';
import { noteSource } from './note-source.js';
import { NoteParagraph } from './note-paragraph.js';

// The rich document is transient. Only Markdown is sent to the parent/saved.
export function createRichNote(config) {
 let editor, source = config.text || '', syncing = false, dialog = null;
 const reveal = noteSource(config);
 const root = document.getElementById('editor'); document.documentElement.classList.add('note-rich-root'); document.body.classList.add('note-rich-document');
 const selectionSnapshot = () => {
  const active = reveal.selection(); if (active) return active;
  const { from, to, empty } = editor.state.selection;
  if (empty) return { from, to, markdown: '' };
  const slice = editor.state.doc.slice(from, to);
  const nodes = slice.content.toJSON() || [];
  const content = nodes.some(node => node.type === 'text' || editor.schema.nodes[node.type]?.isInline)
   ? [{ type: 'paragraph', content: nodes }] : nodes;
  return { from, to, markdown: editor.markdown.serialize({ type: 'doc', content }) };
 };
 const notify = changed => {
  if (syncing) return;
  if (changed) source = reveal.markdown() ?? editor.getMarkdown();
  const { from, to } = editor.state.selection;
  config.onChange(source, Math.min(from, source.length), Math.min(to, source.length), changed);
 };
 const popup = (title, fields, commit) => {
  dialog?.remove(); const box = document.createElement('div'); box.className = 'note-rich-dialog'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
  const heading = document.createElement('strong'); heading.textContent = title; box.append(heading);
  const inputs = fields.map(field => {
   const label = document.createElement('label'); label.textContent = field.label;
   const input = document.createElement(field.multiline ? 'textarea' : 'input'); input.value = field.value; input.setAttribute('aria-label', field.label); label.append(input); box.append(label); return input;
  });
  const actions = document.createElement('div'), apply = document.createElement('button'), cancel = document.createElement('button');
  apply.textContent = 'Apply'; cancel.textContent = 'Cancel'; actions.append(apply, cancel); box.append(actions); document.body.append(box); dialog = box;
  const close = () => { box.remove(); if (dialog === box) dialog = null; editor.commands.focus(); };
  cancel.onclick = close; apply.onclick = () => { if (commit(inputs.map(input => input.value)) !== false) close(); };
  box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  inputs[0].focus(); inputs[0].select();
 };
 const editMath = (node, pos) => {
  if (!editor.isEditable) return;
  reveal.open(pos);
 };
 const format = action => {
  if (reveal.isActive()) return reveal.format(action);
  if (!editor?.isEditable || editor.view.composing) return false;
  editor.view.dispatch(closeHistory(editor.state.tr));
  const commands = {
   bold: () => editor.commands.toggleBold(), italic: () => editor.commands.toggleItalic(), strike: () => editor.commands.toggleStrike(),
   code: () => editor.commands.toggleCode(), fence: () => editor.commands.toggleCodeBlock(),
   bullet: () => editor.commands.toggleBulletList(), number: () => editor.commands.toggleOrderedList(), task: () => editor.commands.toggleTaskList(), quote: () => editor.commands.toggleBlockquote(),
  };
  if (commands[action]) return commands[action]();
  if (/^heading[0-6]$/.test(action)) return action === 'heading0' ? editor.commands.setParagraph() : editor.commands.toggleHeading({ level: Number(action.slice(-1)) });
  if (action === 'link') {
   const { from, to } = editor.state.selection, text = editor.state.doc.textBetween(from, to, '\n');
   popup('Link', [{ label: 'Text', value: text || 'link text' }, { label: 'URL', value: editor.getAttributes('link').href || 'https://' }], ([label, href]) => {
    if (/^(?:javascript|data|vbscript):/i.test(href.trim())) return false;
    if (text && text === label) editor.chain().setTextSelection({ from, to }).setLink({ href }).run();
    else editor.commands.insertContentAt({ from, to }, { type: 'text', text: label || href, marks: [{ type: 'link', attrs: { href } }] });
   }); return true;
  }
  return false;
 };
 const shortcuts = Extension.create({ name: 'noteShortcuts', priority: 10000,
  addKeyboardShortcuts() { return Object.fromEntries(markdownShortcuts.map(item => [item.key, () => format(item.action)])); },
 });
 editor = new Editor({
  element: root, editable: !config.disabled, injectCSS: false,
  extensions: [StarterKit.configure({ link: { openOnClick: false, protocols: ['zotero'] }, underline: false, trailingNode: false, paragraph: false }), NoteParagraph, Markdown.configure({ markedOptions: { gfm: true } }),
   TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({ nested: true }), Image.configure({ inline: true, allowBase64: true }),
   Mathematics.configure({ katexOptions: { output: 'mathml', throwOnError: false, trust: false }, inlineOptions: { onClick: editMath }, blockOptions: { onClick: editMath } }), shortcuts, reveal.extension],
  content: source, contentType: 'markdown',
  editorProps: {
   attributes: { 'aria-label': 'Markdown note', 'aria-multiline': 'true', spellcheck: 'false', 'data-placeholder': config.placeholder || 'Write a note…' },
   handleKeyDown: (_view, event) => { if (event.isComposing) return false; const handled = config.onKey(event); if (handled) event.preventDefault(); return handled; },
   handlePaste: (_view, event) => config.onPaste(event), handleDrop: (_view, event) => config.onDrop(event),
  },
  onUpdate: () => notify(true), onSelectionUpdate: () => notify(false),
 });
 // Keep the originally loaded Markdown byte-for-byte until an actual edit.
 return {
  markdownShortcuts, formatMarkdown: format, getMarkdown: () => source, getSelectionSnapshot: selectionSnapshot,
  finishSourceEditing: () => reveal.finish(),
  replaceMarkdownRange(markdown, from, to, sourceSelection) {
   if (!editor.isEditable || from < 0 || to > editor.state.doc.content.size) return false;
   reveal.clear();
   if (sourceSelection) {
    markdown = sourceSelection.markdown.slice(0,sourceSelection.from) + markdown + sourceSelection.markdown.slice(sourceSelection.to);
    const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(markdown));
    const replacement=sourceSelection.inline && parsed.childCount===1 && parsed.firstChild.type.name==='paragraph' ? parsed.firstChild.content : parsed.content;
    editor.view.dispatch(closeHistory(editor.state.tr).replaceWith(from,to,replacement)); return true;
   }
   const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(markdown));
   const content = parsed.childCount === 1 && parsed.firstChild.type.name === 'paragraph' ? parsed.firstChild.content : parsed.content;
   const slice = parsed.childCount === 1 && parsed.firstChild.type.name === 'paragraph' ? new Slice(content, 0, 0) : Slice.maxOpen(content);
   editor.view.dispatch(closeHistory(editor.state.tr).replaceRange(from, to, slice).scrollIntoView()); return true;
  },
  sync(markdown, disabled, placeholder) {
   syncing = true;
   try {
    if (editor.isEditable === !!disabled) { reveal.clear(); editor.setEditable(!disabled, false); }
    if (markdown !== source) { reveal.clear(); source = markdown; editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false }); }
    const hint = placeholder || 'Write a note…';
    if (editor.view.dom.getAttribute('data-placeholder') !== hint) editor.view.dom.setAttribute('data-placeholder', hint);
   } finally { syncing = false; }
  },
  focus() { editor.commands.focus(); },
  select(anchor, head) {
   const max = Math.max(1, editor.state.doc.content.size - 1);
   editor.commands.setTextSelection({ from: Math.max(1, Math.min(max, anchor)), to: Math.max(1, Math.min(max, head)) });
  },
  measure() { reveal.measure(); }, destroy() { dialog?.remove(); editor.destroy(); }, view: editor.view, editor,
 };
}
