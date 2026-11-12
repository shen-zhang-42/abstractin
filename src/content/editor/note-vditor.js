// Application bridge only. Vditor owns Markdown parsing, editing, shortcuts,
// selection gestures and source/preview boundaries.
export async function createVditorNote(config, Vditor) {
 if (!window.Lute || !window.VditorI18n) throw new Error('Local Vditor resources could not be loaded');
 const root = document.getElementById('editor');
 let source = config.text || '', rendered = '', syncing = false, destroyed = false, savedSelection = null;
 const publish = markdown => {
  if (syncing || destroyed || markdown === rendered) return;
  rendered = markdown; source = markdown; savedSelection = null;
  config.onChange(source, 0, 0, true);
 };
 let resolveReady;
 const ready = new Promise(resolve => { resolveReady = resolve; });
 const cdn = new URL('./vditor/', document.baseURI).href.replace(/\/$/, '');
 const editor = new Vditor(root, {
  mode: 'ir', value: source, height: '100%', minHeight: 0, width: '100%',
  cdn, lang: 'en_US', i18n: window.VditorI18n,
  cache: { enable: false }, resize: { enable: false }, counter: { enable: false },
  outline: { enable: false }, upload: { url: '' },
  placeholder: config.placeholder || 'Write a note…',
  toolbar: ['bold', 'italic', 'strike', 'inline-code', 'code', 'link', 'table', '|', 'headings', 'list', 'ordered-list', 'check', 'quote', '|', 'undo', 'redo'],
  toolbarConfig: { pin: false },
  hint: { emoji: {}, delay: 200 },
  preview: {
   delay: 100, actions: [], hljs: { enable: false },
   theme: { current: 'light', path: cdn + '/dist/css/content-theme' },
   math: { engine: 'KaTeX', inlineDigit: false, macros: {} },
   markdown: { autoSpace: false, fixTermTypo: false, mark: true, sanitize: true },
  },
  input: publish,
  after: resolveReady,
 });
 await ready;
 rendered = editor.getValue();
 const content = root.querySelector('.vditor-ir .vditor-reset');
 content.setAttribute('aria-label', 'Markdown note');
 let disabled = !!config.disabled;
 if (disabled) editor.disabled();
 const flush = () => { if (!destroyed && !syncing) publish(editor.getValue()); };

 // Convert a selected DOM range through Vditor's own Markdown engine. Markers
 // are inserted only into a detached clone, never into the live document.
 // This preserves an exact selection for AI proposals after focus moves away.
 const captureSelection = () => {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return;
  if (range.collapsed) { savedSelection = null; return; }
  const clone = content.cloneNode(true);
  const corresponding = node => {
   const path = [];
   for (; node !== content; node = node.parentNode) path.unshift([...node.parentNode.childNodes].indexOf(node));
   return path.reduce((node, index) => node.childNodes[index], clone);
  };
  const copy = document.createRange();
  copy.setStart(corresponding(range.startContainer), range.startOffset);
  copy.setEnd(corresponding(range.endContainer), range.endOffset);
  const token = 'ABSTRACTINSELECTION' + Math.random().toString(36).slice(2).toUpperCase();
  const start = token + 'START', end = token + 'END';
  const tail = copy.cloneRange(); tail.collapse(false); tail.insertNode(document.createTextNode(end));
  copy.collapse(true); copy.insertNode(document.createTextNode(start));
  const marked = editor.vditor.lute.VditorIRDOM2Md(clone.innerHTML).replace(/\u00a0/g, ' ');
  const from = marked.indexOf(start), stop = marked.indexOf(end);
  if (from < 0 || stop < from || marked.indexOf(start, from + start.length) >= 0 || marked.indexOf(end, stop + end.length) >= 0) { savedSelection = null; return; }
  const normalized = marked.slice(0, from) + marked.slice(from + start.length, stop) + marked.slice(stop + end.length);
  if (normalized !== editor.getValue()) { savedSelection = null; return; }
  const to = stop - start.length;
  savedSelection = { from, to, markdown: normalized.slice(from, to), sourceSelection: { baseMarkdown: source, normalizedMarkdown: normalized } };
 };
 const selectionChanged = () => { if (!syncing && !destroyed) captureSelection(); };
 document.addEventListener('selectionchange', selectionChanged);
 content.addEventListener('mouseup', selectionChanged);
 content.addEventListener('keyup', selectionChanged);
 content.addEventListener('blur', selectionChanged);
 const keydown = event => {
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') flush();
  if (!event.isComposing && config.onKey(event)) { event.preventDefault(); event.stopPropagation(); }
 };
 // Vditor's input callback shares its undo debounce. Synchronize after native
 // DOM input as well so Save and window close never miss the latest keystroke.
 const input = event => { if (!event.isComposing) queueMicrotask(flush); };
 const paste = event => { if (config.onPaste(event)) { event.preventDefault(); event.stopPropagation(); } };
 const drop = event => { if (config.onDrop(event)) { event.preventDefault(); event.stopPropagation(); } };
 root.addEventListener('keydown', keydown, true);
 root.addEventListener('paste', paste, true);
 root.addEventListener('drop', drop, true);
 root.addEventListener('input', input, true);
 root.addEventListener('compositionend', input, true);
 const setValue = markdown => {
  syncing = true;
  try { source = markdown; savedSelection = null; editor.setValue(markdown); rendered = editor.getValue(); }
  finally { syncing = false; }
 };
 const markdownShortcuts = editor.vditor.options.toolbar.filter(item => item.hotkey).map(item => ({
  key: item.hotkey.replace(/⇧/g, 'Shift-').replace(/⌥/g, 'Alt-').replace(/⌘/g, 'Mod-'), label: item.tip || item.name,
 }));
 return {
  vditor: editor, markdownShortcuts, view: { dom: content }, flush, getMarkdown() { flush(); return source; },
  getSelectionSnapshot() { flush(); captureSelection(); return savedSelection || { from: 0, to: 0, markdown: '' }; },
  replaceMarkdownRange(markdown, from, to, snapshot) {
   if (disabled || !snapshot || snapshot.baseMarkdown !== source || from < 0 || to < from || to > snapshot.normalizedMarkdown.length) return false;
   setValue(snapshot.normalizedMarkdown.slice(0, from) + markdown + snapshot.normalizedMarkdown.slice(to));
   config.onChange(source, from, from + markdown.length, true); return true;
  },
  sync(markdown, nextDisabled, placeholder) {
   if (markdown !== source) setValue(markdown);
   if (disabled !== !!nextDisabled) { disabled = !!nextDisabled; disabled ? editor.disabled() : editor.enable(); }
   content.setAttribute('placeholder', placeholder || 'Write a note…');
  },
  focus() { if (!disabled) editor.focus(); },
  select(anchor, head) {
   if (anchor !== head && Math.min(anchor, head) === 0 && Math.max(anchor, head) === source.length) {
    const range = document.createRange(); range.selectNodeContents(content);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); captureSelection();
   }
  },
  measure() {},
  destroy() {
   destroyed = true; document.removeEventListener('selectionchange', selectionChanged);
   content.removeEventListener('mouseup', selectionChanged); content.removeEventListener('keyup', selectionChanged); content.removeEventListener('blur', selectionChanged);
   root.removeEventListener('keydown', keydown, true); root.removeEventListener('paste', paste, true); root.removeEventListener('drop', drop, true);
   root.removeEventListener('input', input, true); root.removeEventListener('compositionend', input, true);
   editor.destroy();
  },
 };
}
