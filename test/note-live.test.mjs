import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

async function setup(text) {
 const dom = new JSDOM('<!doctype html><div id="editor"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
 const { window } = dom;
 window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
 window.HTMLCanvasElement.prototype.getContext = () => null;
 window.Range.prototype.getClientRects = () => [];
 window.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
 const changes = [];
 window.eval(await readFile(new URL('../src/content/editor/note.bundle.js', import.meta.url), 'utf8'));
 const api = window.AbstractInComposer.create({ text, tokens: () => [], onChange: (...args) => changes.push(args), onKey: () => false, onPaste: () => false, onDrop: () => false });
 return { api, window, changes, close() { api.destroy(); window.close(); } };
}

test('Live Markdown preserves source on open, selection changes and external sync', async () => {
 const original = '# Heading\n\nBefore **bold** after.\n\n| A | B |\n| --- | --- |\n| x | y |\n';
 const env = await setup(original), { api, changes, window } = env;
 assert.equal(api.getMarkdown(), original); assert.ok(window.document.querySelector('.mlp-table'));
 api.select(3, 6); assert.equal(changes.length, 0);
 api.sync('External **text**', false, 'Write'); assert.equal(api.getMarkdown(), 'External **text**'); assert.equal(changes.length, 0);
 env.close();
});

test('Live Markdown formats selected words with edge spaces outside the markers and supports undo', async () => {
 const env = await setup('Streaming was disruptive.'), { api, changes } = env;
 api.select(0, 10); assert.equal(api.getSelectionSnapshot().markdown, 'Streaming ');
 api.formatMarkdown('bold'); assert.equal(api.getMarkdown(), '**Streaming** was disruptive.'); assert.equal(changes.length, 1);
 assert.equal(api.getSelectionSnapshot().markdown, 'Streaming');
 api.formatMarkdown('bold'); assert.equal(api.getMarkdown(), 'Streaming was disruptive.');
 env.close();
});

test('Live Markdown AI edits target exact source occurrences and reject stale proposals', async () => {
 const env = await setup('First selected then second selected.'), { api } = env;
 api.select(27, 35); const snapshot = api.getSelectionSnapshot(); assert.equal(snapshot.markdown, 'selected');
 assert.equal(api.replaceMarkdownRange('**replacement**', snapshot.from, snapshot.to, snapshot.sourceSelection), true);
 assert.equal(api.getMarkdown(), 'First selected then second **replacement**.');
 assert.equal(api.replaceMarkdownRange('stale', snapshot.from, snapshot.to, snapshot.sourceSelection), false);
 env.close();
});

test('Live Markdown flush commits table cells and read-only state disables cell editing and commands', async () => {
 const env = await setup('| A | B |\n| --- | --- |\n| x | y |'), { api, window } = env;
 const cell = window.document.querySelector('.mlp-table td');
 for (const type of ['mousedown', 'mouseup']) cell.dispatchEvent(new window.MouseEvent(type, { bubbles: true, button: 0 }));
 const cellView = api.view.constructor.findFromDOM(window.document.querySelector('.mlp-cell-editor'));
 assert.ok(cellView, 'table opens its native cell editor');
 cellView.dispatch({ changes: { from: 0, to: cellView.state.doc.length, insert: 'Changed' } }); api.flush();
 assert.match(api.getMarkdown(), /Changed/);
 api.sync(api.getMarkdown(), true, '');
 assert.equal(window.document.querySelectorAll('[contenteditable="true"]').length, 0);
 api.sync('External while read-only', true, '');
 assert.equal(api.view.state.readOnly, true);
 assert.equal(api.formatMarkdown('bold'), false);
 env.close();
});

test('note formatting inside a table targets its cell and keeps edge spaces outside bold markers', async () => {
 const env = await setup('| A | B |\n| --- | --- |\n| Word here | y |'), { api, window } = env;
 const cell = window.document.querySelector('.mlp-table td');
 for (const type of ['mousedown', 'mouseup']) cell.dispatchEvent(new window.MouseEvent(type, { bubbles: true, button: 0, clientX: -1, clientY: -1 }));
 const cellView = api.view.constructor.findFromDOM(window.document.querySelector('.mlp-cell-editor'));
 cellView.dispatch({ selection: { anchor: 0, head: 5 } });
 cellView.contentDOM.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
 assert.equal(cellView.state.doc.toString(), '**Word** here');
 api.flush(); assert.match(api.getMarkdown(), /\| \*\*Word\*\* here \|/);
 env.close();
});

test('backward deletion keeps an ordinary paragraph outside a preceding quotation', async () => {
 const source = '> Quoted text\n\nOrdinary paragraph';
 const env = await setup(source), { api } = env;
 const from = source.indexOf('Ordinary');
 api.view.dispatch({ changes: { from: from - 1, to: from, insert: '' }, selection: { anchor: from - 1 }, userEvent: 'delete.backward' });
 assert.equal(api.getMarkdown(), source);
 assert.equal(api.view.state.selection.main.head, from - 1, 'caret moves to the separator instead of getting stuck');
 api.view.dispatch({ changes: { from: from - 2, to: from - 1, insert: '' }, selection: { anchor: from - 2 }, userEvent: 'delete.backward' });
 assert.equal(api.getMarkdown(), source);
 assert.equal(api.view.state.selection.main.head, from - 2, 'a further backward deletion reaches the end of the quotation');
 env.close();
});

test('typing or pasting unmarked prose after a quotation saves an explicit paragraph boundary', async () => {
 const env = await setup('> Quote\n'), { api } = env;
 api.view.dispatch({ changes: { from: api.view.state.doc.length, insert: 'Ordinary **paragraph**' }, userEvent: 'input.paste' });
 assert.equal(api.getMarkdown(), '> Quote\n\nOrdinary **paragraph**');
 env.close();
});

test('quote boundaries preserve explicit quoted lines and literal fenced code', async () => {
 const env = await setup('> First\n'), { api } = env;
 api.view.dispatch({ changes: { from: api.view.state.doc.length, insert: '> Second' }, userEvent: 'input' });
 assert.equal(api.getMarkdown(), '> First\n> Second');
 api.sync('```text\n> Literal\n\nOrdinary\n```', false, '');
 const from = api.getMarkdown().indexOf('Ordinary');
 api.view.dispatch({ changes: { from: from - 1, to: from, insert: '' }, userEvent: 'delete.backward' });
 assert.equal(api.getMarkdown(), '```text\n> Literal\nOrdinary\n```');
 env.close();
});

test('loading, AI replacements and external sync do not rewrite pre-existing lazy quotation source', async () => {
 const source = '> Quote\nUnmarked continuation';
 const env = await setup(source), { api } = env;
 assert.equal(api.getMarkdown(), source);
 api.sync('Original', false, ''); api.select(0, 8);
 const snapshot = api.getSelectionSnapshot();
 assert.equal(api.replaceMarkdownRange(source, 0, 8, snapshot.sourceSelection), true);
 assert.equal(api.getMarkdown(), source);
 env.close();
});

test('font selection and shortcut help live in the formatting toolbar and do not change Markdown', async () => {
 const env = await setup('Before **bold** after.'), { api, window, changes } = env;
 const toolbar = window.document.querySelector('.note-format-toolbar'), font = toolbar.querySelector('select');
 assert.equal(toolbar.firstElementChild, font); assert.equal(font.options.length, 7);
 font.value = 'georgia'; font.dispatchEvent(new window.Event('change', { bubbles: true }));
 assert.match(window.document.documentElement.style.getPropertyValue('--note-display-font'), /Georgia/);
 const help = toolbar.querySelector('.note-shortcuts-button'), panel = toolbar.querySelector('.note-shortcuts-panel');
 assert.equal(panel.hidden, true); help.click(); assert.equal(panel.hidden, false);
 assert.match(panel.textContent, /Ctrl\+B/); assert.match(panel.textContent, /Ctrl\+Alt\+1/);
 api.setFont('mono'); assert.equal(font.value, 'mono');
 assert.equal(api.getMarkdown(), 'Before **bold** after.'); assert.equal(changes.length, 0);
 env.close();
});
