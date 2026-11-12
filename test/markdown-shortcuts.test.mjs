import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Use the real bundled Lute Markdown engine with a small Vditor UI stub. Native
// keyboard/rendering behavior is checked separately in the browser integration.
async function setup(text = 'Original **note**', disabled = false) {
 const dom = new JSDOM('<!doctype html><div id="editor"></div><button id="outside">Outside</button>', { url: 'https://example.test/editor/note.html', runScripts: 'outside-only', pretendToBeVisual: true });
 const { window } = dom;
 window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
 window.eval(await readFile(new URL('../src/content/editor/vditor/dist/js/lute/lute.min.js', import.meta.url), 'utf8'));
 window.VditorI18n = {};
 const hotkeys = { bold: '⌘B', italic: '⌘I', strike: '⌘D', code: '⌘U', 'inline-code': '⌘G' };
 class Vditor {
  constructor(root, options) {
   this.root = root; this.options = options; this.lute = window.Lute.New(); this.lute.SetInlineMath(true); this.lute.SetMark(true);
   root.innerHTML = '<div class="vditor-wysiwyg"><pre class="vditor-reset" contenteditable="true"></pre></div>';
   this.content = root.querySelector('pre');
   this.vditor = { lute: this.lute, options: { toolbar: options.toolbar.map(name => ({ name, hotkey: hotkeys[name], tip: name })) } };
   this.setValue(options.value); queueMicrotask(options.after);
  }
  setValue(value) { this.content.innerHTML = this.lute.Md2VditorDOM(value); }
  getValue() { return this.lute.VditorDOM2Md(this.content.innerHTML).replace(/\u00a0/g, ' '); }
  disabled() { this.content.contentEditable = 'false'; }
  enable() { this.content.contentEditable = 'true'; }
  focus() { this.content.focus(); }
  destroy() { this.root.replaceChildren(); }
 }
 window.eval((await readFile(new URL('../src/content/editor/note-vditor.js', import.meta.url), 'utf8')).replace('export async function', 'async function') + '\nwindow.createNote = createVditorNote;');
 const changes = [], keys = [];
 const instance = await window.createNote({ text, disabled, placeholder: '', onChange: (...args) => changes.push(args), onKey: event => { keys.push(event.key); return event.ctrlKey && event.key === 's'; }, onPaste: () => false, onDrop: () => false }, Vditor);
 const select = (text, last = false) => {
  const doc = window.document, walker = doc.createTreeWalker(instance.view.dom, 4); let node;
  while ((node = walker.nextNode())) if (node.textContent.includes(text)) {
   const start = last ? node.textContent.lastIndexOf(text) : node.textContent.indexOf(text), range = doc.createRange();
   range.setStart(node, start); range.setEnd(node, start + text.length);
   window.getSelection().removeAllRanges(); window.getSelection().addRange(range); return;
  }
  throw new Error('Selection text not found: ' + text);
 };
 return { window, instance, changes, keys, select, close() { instance.destroy(); window.close(); } };
}

test('Vditor runs native WYSIWYG with local resources and preserves original Markdown on open', async () => {
 const original = '# Title\n\n| A | B |\n| --- | --- |\n| x | **y** |\n\n$x^2$\n\n```r\nx <- 1\n```\n';
 const env = await setup(original), { instance, changes } = env;
 assert.equal(instance.vditor.options.mode, 'wysiwyg'); assert.equal(instance.vditor.options.cache.enable, false);
 assert.equal(instance.vditor.options.cdn, 'https://example.test/editor/vditor');
 assert.ok(instance.view.dom.querySelector('table')); assert.ok(instance.view.dom.querySelector('strong'));
 assert.equal(instance.getMarkdown(), original); assert.equal(changes.length, 0);
 assert.equal(instance.finishSourceEditing, undefined); assert.equal(instance.editor, undefined); env.close();
});

test('native input updates Markdown while focus-only callbacks and synchronization do not dirty notes', async () => {
 const env = await setup(), { instance, changes } = env;
 instance.vditor.options.input(instance.vditor.getValue()); assert.equal(changes.length, 0);
 instance.vditor.setValue('Changed **text**'); instance.vditor.options.input(instance.vditor.getValue());
 assert.equal(changes.length, 1); assert.match(instance.getMarkdown(), /Changed \*\*text\*\*/);
 instance.sync('External update', true, 'Read only'); assert.equal(instance.view.dom.contentEditable, 'false');
 assert.equal(instance.getMarkdown(), 'External update'); assert.equal(changes.length, 1);
 instance.sync('External update', false, 'Write'); assert.equal(instance.view.dom.contentEditable, 'true'); env.close();
});

test('selection bridge targets the correct repeated occurrence after focus leaves the note', async () => {
 const env = await setup('First selected then second selected.'), { instance, select, window } = env;
 select('selected', true); const snapshot = instance.getSelectionSnapshot();
 assert.equal(snapshot.markdown, 'selected'); assert.ok(snapshot.from > 20);
 window.document.getElementById('outside').focus();
 assert.equal(instance.getSelectionSnapshot().markdown, 'selected');
 assert.equal(instance.replaceMarkdownRange('**replacement**', snapshot.from, snapshot.to, snapshot.sourceSelection), true);
 assert.match(instance.getMarkdown(), /First selected then second \*\*replacement\*\*\./);
 assert.equal(instance.replaceMarkdownRange('stale', snapshot.from, snapshot.to, snapshot.sourceSelection), false); env.close();
});

test('selection inside formatted text preserves surrounding Markdown through accepted AI edits', async () => {
 const env = await setup('Before **selected** after.'), { instance, select } = env;
 select('selected'); const snapshot = instance.getSelectionSnapshot(); assert.equal(snapshot.markdown, 'selected');
 assert.equal(instance.replaceMarkdownRange('revised', snapshot.from, snapshot.to, snapshot.sourceSelection), true);
 assert.match(instance.getMarkdown(), /Before \*\*revised\*\* after\./); env.close();
});

test('read-only notes reject AI replacement and stale source snapshots are rejected', async () => {
 const env = await setup('First selected.', true), { instance, select } = env;
 select('selected'); const snapshot = instance.getSelectionSnapshot();
 assert.equal(instance.replaceMarkdownRange('new', snapshot.from, snapshot.to, snapshot.sourceSelection), false);
 instance.sync('Another selected.', false, '');
 assert.equal(instance.replaceMarkdownRange('new', snapshot.from, snapshot.to, snapshot.sourceSelection), false); env.close();
});

test('formatting gestures are native while application Save is forwarded', async () => {
 const env = await setup(), { instance, window } = env;
 for (const name of ['b', 'i', 'ArrowLeft', 'ArrowRight']) {
  const event = new window.KeyboardEvent('keydown', { key: name, ctrlKey: name.length === 1, bubbles: true, cancelable: true });
  instance.view.dom.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
 }
 const save = new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
 instance.view.dom.dispatchEvent(save); assert.equal(save.defaultPrevented, true);
 assert.equal(instance.markdownShortcuts.find(binding => binding.label === 'bold').key, 'Mod-B'); env.close();
});

test('native input and explicit flush synchronize before Vditor undo debounce',async()=>{
 const env=await setup(),{instance,window,changes}=env;
 instance.vditor.setValue('Latest keystroke');
 instance.view.dom.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText'}));
 await Promise.resolve();assert.equal(changes.length,1);assert.match(changes[0][0],/Latest keystroke/);
 instance.vditor.setValue('Immediately saved');instance.flush();assert.match(changes.at(-1)[0],/Immediately saved/);
 instance.vditor.options.input(instance.vditor.getValue());assert.equal(changes.length,2,'debounced callback does not duplicate input');env.close();
});

test('double-click excludes trailing spaces without changing intentional selections or source', async () => {
 const env = await setup('Streaming was disruptive.'), { instance, window, select, changes } = env;
 select('Streaming ');
 instance.view.dom.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
 assert.equal(window.getSelection().toString(), 'Streaming ', 'ordinary selection retains spaces');
 instance.view.dom.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
 assert.equal(window.getSelection().toString(), 'Streaming');
 assert.equal(instance.getSelectionSnapshot().markdown, 'Streaming');
 assert.equal(instance.getMarkdown(), 'Streaming was disruptive.');
 assert.equal(changes.length, 0);
 // Range endpoints may be element boundaries and spaces may cross text nodes.
 instance.view.dom.innerHTML = '<p><span>Streaming</span><span> </span>was disruptive.</p>';
 const range = window.document.createRange(), paragraph = instance.view.dom.firstChild;
 range.setStart(paragraph, 0); range.setEnd(paragraph, 2);
 window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
 instance.view.dom.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
 assert.equal(window.getSelection().toString(), 'Streaming');
 env.close();
});
