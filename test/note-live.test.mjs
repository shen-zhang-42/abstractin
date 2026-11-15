import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { loadPlugin } from './load-plugin.mjs';

async function setup(text, config = {}) {
 const dom = new JSDOM('<!doctype html><div id="editor"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
 const { window } = dom;
 window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
 window.HTMLCanvasElement.prototype.getContext = () => null;
 window.Range.prototype.getClientRects = () => [];
 window.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
 const changes = [];
 window.eval(await readFile(new URL('../src/content/editor/note.bundle.js', import.meta.url), 'utf8'));
 const api = window.AbstractInComposer.create({ text, tokens: () => [], onChange: (...args) => changes.push(args), onKey: () => false, onPaste: () => false, onDrop: () => false, ...config });
 return { api, window, changes, close() { api.destroy(); window.close(); } };
}

test('cancellation maps around manual boundary typing, survives reopen and uses one incremental transaction',async()=>{
 const {plugin:p,window:pw}=loadPlugin(),original='First\nOld target\nLast';
 const edits=[{from:6,to:9,text:'New'}],ranges=p.noteReplacementReviewRanges(edits,[],original);
 const env=await setup(original),{api}=env;
 api.applyReplacements(original,JSON.stringify(edits),JSON.stringify(ranges));
 api.view.dispatch({changes:[{from:6,insert:'User before '},{from:9,insert:' user after'}]});
 const saved=api.getMarkdown(),metadata=api.getReviewRanges();env.close();
 const reopened=await setup(saved,{reviewRanges:metadata});
 const inverse=p.noteReviewCancellation(saved,JSON.parse(reopened.api.getReviewRanges()));
 reopened.api.view.setState=()=>{throw new Error('Must not reset the editor');};
 assert.equal(reopened.api.applyReplacements(saved,JSON.stringify(inverse),'[]'),true);
 assert.equal(reopened.api.getMarkdown(),'First\nUser before Old user after target\nLast');
 assert.equal(reopened.api.getReviewRanges(),'[]');reopened.close();pw.close();
});

test('multiline deletion keeps old numbers and minus signs in the same gutters as additions',async()=>{
 const original='First\nOld one\nOld two\nLast',env=await setup(original),{api,window}=env;
 api.applyReplacements(original,JSON.stringify([{from:6,to:21,text:'New'}]),JSON.stringify([{from:6,to:9,removed:'Old one\nOld two',oldLine:2}]));
 assert.deepEqual([...window.document.querySelectorAll('.cm-content .note-ai-deletion')].map(row=>row.textContent),['Old one','Old two']);
 assert.equal(window.document.querySelector('.cm-content .note-ai-deleted-number'),null);
 assert.deepEqual([...window.document.querySelectorAll('.cm-lineNumbers .note-ai-deleted-number')].map(row=>row.textContent),['2','3']);
 assert.equal(window.document.querySelectorAll('.note-change-gutter .note-ai-minus').length,2);
 assert.equal(window.document.querySelectorAll('.note-change-gutter .note-ai-plus').length,1);env.close();
});

test('Live Markdown preserves source on open, selection changes and external sync', async () => {
 const original = '# Heading\n\nBefore **bold** after.\n\n| A | B |\n| --- | --- |\n| x | y |\n';
 const env = await setup(original), { api, changes, window } = env;
 assert.equal(api.getMarkdown(), original); assert.ok(window.document.querySelector('.mlp-table'));
 api.select(3, 6); assert.equal(changes.length, 0);
 api.sync('External **text**', false, 'Write'); assert.equal(api.getMarkdown(), 'External **text**'); assert.equal(changes.length, 0);
 env.close();
});

test('compact formatting opens from the panel command and dismisses without changing Markdown', async () => {
 const visible=[],env=await setup('Keep **this**.',{compactToolbar:true,onToolbarChange:value=>visible.push(value)});
 const {api,window}=env,toolbar=window.document.querySelector('.note-format-toolbar');
 assert.equal(toolbar.hidden,true);
 api.toggleToolbar();assert.equal(toolbar.hidden,false);assert.equal(visible.at(-1),true);
 window.document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(toolbar.hidden,true);
 api.toggleToolbar();window.document.getElementById('editor').dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true}));
 assert.equal(toolbar.hidden,true);assert.equal(api.getMarkdown(),'Keep **this**.');env.close();
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

test('targeted AI replacements preserve editor state, map the cursor and mark only changed lines until confirmation', async () => {
 const source = 'Keep first.\nOld second.\nKeep third.\nOld fourth.', reviews = [];
 const env = await setup(source, { onReviewChange: value => reviews.push(JSON.parse(value)) }), { api, window } = env;
 api.select(3, 3);
 let resets = 0;
 api.view.setState = () => { resets++; throw new Error('Full editor reset'); };
 const first = source.indexOf('Old'), last = source.lastIndexOf('Old');
 const edits = [{ from: first, to: first + 3, text: 'New' }, { from: last, to: last + 3, text: 'Updated' }];
 assert.equal(api.applyReplacements(source, JSON.stringify(edits), JSON.stringify([{from:first,to:first+3},{from:last,to:last+7}])), true);
 assert.equal(api.getMarkdown(), 'Keep first.\nNew second.\nKeep third.\nUpdated fourth.');
 assert.equal(resets, 0); assert.equal(api.view.state.selection.main.head, 3);
 assert.equal(window.document.querySelectorAll('.cm-line.note-ai-changed').length, 2);
 assert.equal(api.applyReplacements(source, JSON.stringify(edits), '[]'), false);
 const changed = api.getMarkdown(); api.setReviewRanges('[]');
 assert.equal(window.document.querySelectorAll('.cm-line.note-ai-changed').length, 0);
 assert.equal(api.getMarkdown(), changed); assert.deepEqual(reviews.at(-1), []);
 api.view.contentDOM.dispatchEvent(new window.KeyboardEvent('keydown', {key:'z',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}));
 assert.equal(api.getMarkdown(), source, 'one undo restores all targeted replacements');
 env.close();
});

test('review highlights survive source edits, reopen, deletion and rendered table rows', async () => {
 const source = '| A | B |\n| --- | --- |\n| old | y |\n\nKeep.';
 const from = source.indexOf('old'), env = await setup(source), { api, window } = env;
 const ranges = JSON.stringify([{ from, to: from + 3 }]);
 assert.equal(api.applyReplacements(source, JSON.stringify([{from,to:from+3,text:'new'}]), ranges), true);
 await new Promise(resolve => window.setTimeout(resolve, 50));
 assert.equal(window.document.querySelectorAll('tr.note-ai-changed').length, 1);
 api.view.dispatch({ changes: { from:0, insert:'Intro\n\n' } });
 assert.equal(JSON.parse(api.getReviewRanges())[0].from, from + 7);
 const saved = api.getMarkdown(), marks = api.getReviewRanges(); env.close();
 const reopened = await setup(saved, { reviewRanges: marks });
 assert.equal(reopened.api.getReviewRanges(), marks); reopened.api.setReviewRanges('[]'); reopened.close();
 const deletion = await setup('First\nDelete\nLast');
 assert.equal(deletion.api.applyReplacements('First\nDelete\nLast', JSON.stringify([{from:6,to:13,text:''}]), '[{"from":6,"to":6,"removed":"Delete","oldLine":2}]'), true);
 assert.equal(deletion.window.document.querySelectorAll('.cm-line.note-ai-changed').length, 0);
 assert.equal(deletion.window.document.querySelector('.note-ai-deletion').textContent,'Delete');
 assert.equal(deletion.window.document.querySelector('.cm-lineNumbers .note-ai-deleted-number').textContent,'2');
 assert.equal(deletion.window.document.querySelector('.note-change-gutter .note-ai-minus').textContent,'−');
 assert.equal(deletion.api.getMarkdown(),'First\nLast');deletion.close();
});

test('GitHub-style note review shows old text without changing source, with line numbers and plus/minus gutters',async()=>{
 const env=await setup('First\nOld line\nLast'),{api,window}=env;
 const ranges=JSON.stringify([{from:6,to:14,removed:'Old line',oldLine:2}]);
 assert.equal(api.applyReplacements('First\nOld line\nLast',JSON.stringify([{from:6,to:14,text:'New line'}]),ranges),true);
 assert.equal(api.getMarkdown(),'First\nNew line\nLast');assert.ok(window.document.querySelector('.cm-lineNumbers'));
 assert.equal(window.document.querySelector('.note-change-gutter .note-ai-plus').textContent,'+');
 assert.equal(window.document.querySelector('.note-ai-deletion').textContent,'Old line');
 assert.equal(window.document.querySelector('.cm-lineNumbers .note-ai-deleted-number').textContent,'2');
 assert.equal(window.document.querySelector('.note-change-gutter .note-ai-minus').textContent,'−');
 assert.match(window.document.querySelector('.cm-line.note-ai-added').textContent,/New line/);
 api.view.dispatch({changes:{from:0,insert:'Intro\n'}});
 assert.equal(JSON.parse(api.getReviewRanges())[0].removed,'Old line');
 api.setReviewRanges('[]');assert.equal(window.document.querySelector('.note-ai-deletion'),null);
 assert.equal(window.document.querySelector('.note-ai-plus'),null);assert.match(api.getMarkdown(),/New line/);env.close();
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

test('backward deletion uses default Markdown quotation continuation without restoring separators', async () => {
 const source = '> Quoted text\n\nOrdinary paragraph';
 const env = await setup(source), { api } = env;
 const from = source.indexOf('Ordinary');
 api.view.dispatch({ changes: { from: from - 1, to: from, insert: '' }, selection: { anchor: from - 1 }, userEvent: 'delete.backward' });
 assert.equal(api.getMarkdown(), '> Quoted text\nOrdinary paragraph');
 assert.equal(api.view.state.selection.main.head, from - 1);
 env.close();
});

test('pasting after a quotation keeps the default Markdown source unchanged', async () => {
 const env = await setup('> Quote\n'), { api } = env;
 api.view.dispatch({ changes: { from: api.view.state.doc.length, insert: 'Ordinary **paragraph**' }, userEvent: 'input.paste' });
 assert.equal(api.getMarkdown(), '> Quote\nOrdinary **paragraph**');
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
 const toolbar = window.document.querySelector('.note-format-toolbar'), font = toolbar.querySelector('.note-font-button');
 assert.equal(toolbar.firstElementChild, font.parentElement); assert.equal(toolbar.querySelector('select'), null);
 font.click(); const fontMenu = toolbar.querySelector('.note-font-menu'); assert.equal(fontMenu.hidden, false);
 assert.equal(fontMenu.children.length, 7); fontMenu.querySelector('[data-font=georgia]').click();
 assert.equal(fontMenu.hidden, true); assert.equal(font.textContent, 'Georgia');
 assert.match(window.document.documentElement.style.getPropertyValue('--note-display-font'), /Georgia/);
 const help = toolbar.querySelector('.note-shortcuts-button'), panel = toolbar.querySelector('.note-shortcuts-panel');
 assert.equal(panel.hidden, true); help.click(); assert.equal(panel.hidden, false);
 assert.match(panel.textContent, /Ctrl\+B/); assert.match(panel.textContent, /Ctrl\+Alt\+1/);
 api.setFont('mono'); assert.equal(font.dataset.font, 'mono');
 assert.equal(api.getMarkdown(), 'Before **bold** after.'); assert.equal(changes.length, 0);
 env.close();
});
