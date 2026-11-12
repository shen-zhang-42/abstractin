import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

async function setup(text) {
 const dom = new JSDOM('<!doctype html><div id="editor"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
 const { window } = dom;
 window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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
 assert.equal(api.getMarkdown(), original); assert.ok(window.document.querySelector('table'));
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
 const cell = window.document.querySelector('td'); cell.tabIndex = 0; cell.focus(); cell.textContent = 'Changed'; api.flush();
 assert.match(api.getMarkdown(), /Changed/);
 api.sync(api.getMarkdown(), true, '');
 assert.equal(window.document.querySelectorAll('[contenteditable="true"]').length, 0);
 api.sync('External while read-only', true, '');
 assert.equal(api.view.state.readOnly, true);
 assert.equal(api.formatMarkdown('bold'), false);
 env.close();
});
