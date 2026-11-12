import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlugin } from './load-plugin.mjs';
import { runInNewContext } from 'node:vm';

async function setup() {
 const env = loadPlugin(), { plugin: p, window, document } = env;
 const dir = await mkdtemp(join(tmpdir(), 'abstractin-note-editor-'));
 window.OS = { Path: { join }, File: { exists: async path => { try { await access(path); return true; } catch { return false; } } } };
 window.Zotero.File = { createDirectoryIfMissingAsync: path => mkdir(path, { recursive: true }), getContentsAsync: path => readFile(path, 'utf8'), putContentsAsync: writeFile };
 p.getDataDir = () => dir; p.checkInstalledBackends = async () => {}; p.assertAgentReadingReady = async () => {};
 const items = new Map(); let nextID = 10;
 class Item {
  constructor(type) { this.itemType = type; this.libraryID = 1; this.key = 'NOTE' + (++nextID); this.id = nextID; this.tags = []; this.html = ''; }
  isNote() { return this.itemType === 'note'; }
  isRegularItem() { return this.itemType === 'book'; }
  isEditable() { return true; }
  getTags() { return this.tags.map(tag => ({ tag })); }
  addTag(tag) { this.tags.push(tag); }
  getNote() { return this.html; }
  setNote(html) { this.html = html; }
  async saveTx() { items.set(this.id, this); return this.id; }
  getNotes() { return [...items.values()].filter(n => n.parentID === this.id).map(n => n.id); }
  getField(field) { return field === 'title' ? this.title || '' : ''; }
 }
 window.Zotero.Item = Item; window.Zotero.Items = { get: id => items.get(id), getAsync: async id => Array.isArray(id) ? id.map(value => items.get(value)) : items.get(id) };
 window.Zotero.Search = class { addCondition() {} async search() { return [...items.values()].filter(n => n.libraryID === this.libraryID && n.isNote() && n.getTags().some(t => t.tag === 'AbstractIn:Markdown')).map(n => n.id); } };
 window.Zotero.Notifier = { registerObserver: () => 1, unregisterObserver() {} };
 window.Zotero.Libraries = { userLibraryID: 1, get: () => ({ editable: true }) };
 const parent = new Item('book'); parent.title = 'Source book'; await parent.saveTx();
 const note = new Item('note'); note.parentID = parent.id; note.addTag('AbstractIn'); note.addTag('AbstractIn:Markdown');
 note.setNote(p.markdownNoteHTML(note, 'Original note', '# Heading\n\n$x^2$\n\n**Important**', parent, 1)); await note.saveTx();
 const workspace = join(dir, 'notes', '1-' + note.key); await mkdir(workspace, { recursive: true });
 const state = { key: '1:' + note.key, note, parent, dir: workspace, baseHTML: note.getNote(), revision: 0, savedRevision: 0, saveQueue: Promise.resolve() };
 const host = document.createElement('main'); host.id = 'abstractin-note-root'; document.body.append(host);
 p._markdownNoteWindows.set(state.key, state);
 return { ...env, p, dir, parent, note, state, items };
}

test('font menu uses separate rows and choosing a font changes display without editing Markdown', async () => {
 const {p,window,document,state}=await setup();await p.mountMarkdownNote(window,state);
 const menu=document.querySelector('.abstractin-note-font-menu'),options=[...menu.querySelectorAll('[role=option]')];
 assert.equal(options.length,7);assert.equal(state.fontSelect.hidden,true);
 const source=state.input.value,revision=state.revision;menu.open=true;
 options.find(option=>option.dataset.font==='georgia').click();
 assert.equal(menu.open,false);assert.equal(menu.querySelector('summary').textContent,'Georgia');
 assert.equal(state.fontSelect.value,'georgia');assert.match(state.input.style.fontFamily,/Georgia/);
 assert.equal(state.input.value,source);assert.equal(state.revision,revision);assert.equal(menu.querySelectorAll('[aria-selected=true]').length,1);
 state.dispose();window.close();
});

test('Markdown source round-trips exactly and rendered native notes contain KaTeX without executing HTML', async () => {
 const { p, note, parent } = await setup();
 const source = '# My note\n\n$$x^2+1$$\n\n```r\nx <- 1\n```\n<script>alert(1)</script>';
 note.setNote(p.markdownNoteHTML(note, '<Title>', source, parent, 2));
 const data = p.markdownNoteData(note); assert.equal(data.markdown, source); assert.equal(data.title, '<Title>');
 assert.match(note.getNote(), /<math/); assert.doesNotMatch(note.getNote(), /<script>/); assert.match(note.getNote(), /&lt;Title&gt;/);
 assert.equal(p.noteInMetadata(note, parent), 'out-note');
});

test('note window is independent of the document discussion and reopening focuses the same editor', async () => {
 const { p, window, note, state } = await setup(); p._markdownNoteWindows.clear();
 let focused = 0, opened = 0; const native = { closed: false, focus() { focused++; } };
 const discussion = { unchanged: true }; p._readerPanelWindows.set(window, discussion);
 window.openDialog = (url, name, features, args) => {
  opened++; assert.match(url, /note-window.xhtml$/); assert.equal(args.noteKey, state.key);
  assert.match(features, /resizable=yes/); return native;
 };
 assert.equal(await p.openMarkdownNote({ win: window, note }), native);
 assert.equal(await p.openMarkdownNote({ win: window, note }), native);
 assert.equal(opened, 1); assert.equal(focused, 2); assert.equal(p._readerPanelWindows.get(window), discussion);
 assert.equal(state.note, note);
});

test('encoded paragraph indentation displays as whitespace while real code remains literal', async () => {
 const { p, note, parent, document, window } = await setup();
 const source = '&#9;**Indented bold**\n\n&#32;&#32;&#32;&#32;Normal paragraph\n\n```text\n&#9;literal code\n```';
 note.setNote(p.markdownNoteHTML(note, 'Indentation', source, parent, 2));
 assert.equal(p.markdownNoteData(note).markdown, source);
 const display = document.createElement('div'); display.innerHTML = note.getNote();
 assert.equal(display.querySelector('strong').textContent, 'Indented bold');
 assert.match(display.querySelector('code').textContent, /&#9;literal code/);
 const prose = [...display.querySelectorAll('p')].map(node => node.textContent).join('\n');
 assert.doesNotMatch(prose, /&#(?:9|32);/); window.close();
});

test('the visual note editor has a fixed header, one editing surface, and saves Markdown source', async () => {
 const { p, window, document, note, state } = await setup();
 let options; const install = p.installMathComposer; p.installMathComposer = function(input, config) { if (config?.note) options = config; return install.call(this, input, config); };
 await p.mountMarkdownNote(window, state); assert.equal(options.note, true);
 state.input.value = '# Updated\n\n$$a=b$$'; state.title.value = 'Updated title'; state.revision++;
 await p.saveMarkdownNote(state);
 assert.equal(p.markdownNoteData(note).markdown, state.input.value); assert.equal(p.markdownNoteData(note).title, 'Updated title');
 assert.equal([...state.editor.querySelectorAll('button')].some(b => ['Preview', 'Edit'].includes(b.textContent)), false);
 const header = state.editor.querySelector('.abstractin-note-editor-head'); assert.ok(header.contains(state.title)); assert.ok(header.querySelector('.abstractin-note-documents'));
 assert.equal(state.editor.querySelector('.abstractin-note-edit-host').contains(state.title), false);
 const revision = state.revision; state.fontSelect.value = 'georgia'; state.fontSelect.onchange(); assert.equal(p.getPref('noteFont'), 'georgia'); assert.match(state.input.style.fontFamily, /Georgia/); assert.equal(state.revision, revision);
 assert.equal(state.input.value, '# Updated\n\n$$a=b$$');
 state.disposeEditor(); window.close();
});

test('external note changes are not overwritten and the unsaved Markdown draft is retained', async () => {
 const { p, window, note, state } = await setup(); await p.mountMarkdownNote(window, state);
 state.input.value = 'My unsaved changes'; state.revision++;
 const external = '<p>Native external edit</p>'; note.setNote(external);
 await assert.rejects(p.saveMarkdownNote(state), /changed outside/); assert.equal(note.getNote(), external);
 const draft = JSON.parse(await readFile(join(state.dir, 'draft.json'), 'utf8')); assert.equal(draft.markdown, 'My unsaved changes');
 state.disposeEditor(); window.close();
});

test('serialized saves keep the latest text and recover after a failed Zotero save', async () => {
 const { p, window, note, state } = await setup(); await p.mountMarkdownNote(window, state);
 let fail = true; note.saveTx = async () => { if (fail) { fail = false; throw new Error('Database busy'); } };
 state.input.value = 'First'; state.revision++; const first = p.saveMarkdownNote(state);
 state.input.value = 'Second'; state.revision++; const second = p.saveMarkdownNote(state);
 await assert.rejects(first, /Database busy/); await second;
 assert.equal(p.markdownNoteData(note).markdown, 'Second'); assert.equal(state.savedRevision, state.revision);
 state.disposeEditor(); window.close();
});

test('note discussion sends an immutable note snapshot through the existing model transport', async () => {
 const { p, window, note, state } = await setup(); await p.mountMarkdownNote(window, state);
 const dir = join(state.dir, 'discussion'); await mkdir(dir, { recursive: true });
 const ctx = p.registerChatContext({ dir, paperItem: note, attachmentItem: null, noteWorkspace: true, noteState: state });
 state.input.value = 'Version at send'; state.contextScope = { value: 'full' };
 let release; p.assertAgentReadingReady = () => new Promise(resolve => { release = resolve; });
 const progress = []; const pending = { backend: 'codex', model: 'fixture', effort: 'low', progress: e => progress.push(e), cancelled: false };
 p.runBackend = async (backend, request) => {
  assert.equal(backend, 'codex'); assert.equal(request.summaryOnly, true); assert.equal(request.files && Object.keys(request.files).length, 0);
  assert.match(request.question, /Version at send/); assert.doesNotMatch(request.question, /Version after send/);
  request.onProgress({ text: 'Streaming reply' }); return { text: 'Final reply', sessionId: 'note-session' };
 };
 const task = p.ask(ctx, 'Explain the note', pending); state.input.value = 'Version after send'; release();
 const result = await task; assert.equal(result.text, 'Final reply'); assert.equal(progress[0].text, 'Streaming reply');
 const history = await p.loadHistory(dir); assert.equal(history[0].noteSnapshot.markdown, 'Version at send'); assert.equal(history[1].text, 'Final reply');
 assert.equal(p.markdownNoteData(note).markdown, '# Heading\n\n$x^2$\n\n**Important**');
 state.disposeEditor(); window.close();
});

test('selection-only context excludes the rest of the note and reports empty selections', async () => {
 const { p, window, note, state } = await setup(); await p.mountMarkdownNote(window, state);
 state.input.value = 'PRIVATE selected OTHER'; state.input.setSelectionRange(8, 16); state.contextScope = { value: 'selection' };
 const dir = join(state.dir, 'discussion'); await mkdir(dir, { recursive: true });
 const ctx = p.registerChatContext({ dir, paperItem: note, noteWorkspace: true, noteState: state });
 p.runBackend = async (_, request) => { assert.match(request.question, /selected/); assert.doesNotMatch(request.question, /PRIVATE|OTHER/); return { text: 'A reply' }; };
 const pending = { backend: 'codex', model: 'fixture', progress() {}, cancelled: false };
 assert.equal((await p.ask(ctx, 'Q', pending)).text, 'A reply');
 state.input.setSelectionRange(0, 0); assert.match((await p.ask(ctx, 'Q', pending)).error, /Select text/);
 state.disposeEditor(); window.close();
});

test('ordinary native notes are not silently converted and a document can own multiple editable notes', async () => {
 const { p, window, parent, items } = await setup(); p._markdownNoteWindows.clear();
 window.openDialog = () => ({ closed: false, focus() {} });
 await p.openMarkdownNote({ win: window, parent }); await p.openMarkdownNote({ win: window, parent });
 const notes = [...items.values()].filter(n => n.parentID === parent.id); assert.equal(notes.length, 3);
 const native = new window.Zotero.Item('note'); native.setNote('<p>Keep original</p>');
 await assert.rejects(p.openMarkdownNote({ win: window, note: native }), /not an AbstractIn/); assert.equal(native.getNote(), '<p>Keep original</p>');
});

test('the note chat uses the existing send pipeline without a PDF setup and can run alongside a reading request', async () => {
 const { p, window, note, state } = await setup(); await p.mountMarkdownNote(window, state);
 await p.mountMarkdownNoteChat(state, state.chatHost);
 const view = state.chatView;
 assert.equal(view.root.querySelector('.abstractin-composer').hidden, false);
 assert.equal(view.input.disabled, false); assert.equal(view.root.dataset.readingReady, 'true');
 assert.equal(view.root.querySelector('.abstractin-start-reading'), null);
 p._pending.set('other-document', { status: 'reading' });
 let openedSetup = false; p.openReadingSetup = async () => { openedSetup = true; };
 let pending; p.showPending = (_view, current) => { pending = current; };
 p.runBackend = async () => ({ text: 'Independent note answer' }); p.getBackend = () => 'codex';
 view.input.value = 'Explain'; await p.startRequest(view, view.input.value);
 assert.ok(pending); await pending.promise;
 assert.equal(openedSetup, false); assert.equal(p._pending.get('other-document').status, 'reading');
 assert.equal((await p.loadHistory(view.ctx.dir))[1].text, 'Independent note answer');
 assert.equal(p.markdownNoteData(note).markdown, '# Heading\n\n$x^2$\n\n**Important**');
 view.root.disposeUI(); state.disposeEditor(); window.close();
});

test('NoteOut is a separate nonmodal entry that does not open or replace Reading', async () => {
 const { p, window } = await setup(); let opened = 0, focused = 0;
 const reading = { active: true }; p._readerPanelWindows.set(window, reading);
 window.openDialog = (url, name, features, args) => {
  opened++; assert.match(features, /dialog=no/); assert.equal(args.homeKey, '1'); assert.match(url, /note-window.xhtml$/);
  return { closed: false, focus() { focused++; } };
 };
 const first = await p.openNoteOutHome(window), second = await p.openNoteOutHome(window);
 assert.equal(first, second); assert.equal(opened, 1); assert.equal(focused, 2);
 assert.equal(p._readerPanelWindows.get(window), reading);
});

test('NoteOut home keeps the list and switches editors inside one window without discarding drafts', async () => {
 const { p, window, document, note } = await setup(); p._markdownNoteWindows.clear();
 const home = { key: '1', libraryID: 1, states: new Map() }; p._noteOutHomes.set('1', home);
 window.openDialog = () => { throw new Error('Editor should stay in the NoteOut window'); };
 await p.mountNoteOutHome(window, home);
 const create = [...document.querySelectorAll('.abstractin-note-list > button')].find(b => b.textContent === 'New note');
 await create.onclick(); const first = home.active;
 assert.ok(first); assert.equal(first.note.parentID, undefined);
 first.input.value = 'Unsaved source'; first.title.value = 'Named note'; first.input.dispatchEvent(new window.Event('input', { bubbles: true }));
 await p.openMarkdownNote({ win: window, note, home });
 assert.equal(first.host.hidden, true); assert.equal(home.active.note, note); assert.equal(first.input.value, 'Unsaved source');
 home.select(first); assert.equal(first.host.hidden, false); assert.equal(home.active, first);
 await first.flush(); assert.equal(p.markdownNoteData(first.note).title, 'Named note');
 await home.refresh(); assert.match(document.querySelector('.abstractin-note-list-items').textContent, /Named note/);
 for (const state of home.states.values()) state.disposeEditor(); window.close();
});

test('the reading header has no extra NoteOut or workspace entry beside AbstractIn', async () => {
 const { p, document, window } = await setup(); p.renderSkeleton(document, document.body);
 const root = document.querySelector('.abstractin-root'), title = root.querySelector('.abstractin-header-title');
 assert.equal(title.nextElementSibling, null); assert.equal(root.querySelector('.abstractin-write-note'), null);
 root.disposeUI(); window.close();
});

test('new independent notes use the library selected for the NoteOut home', async () => {
 const { p, window } = await setup(); p._markdownNoteWindows.clear();
 const home = { key: '2', libraryID: 2, states: new Map() }; p._noteOutHomes.set('2', home);
 await p.mountNoteOutHome(window, home); await p.openMarkdownNote({ win: window, home });
 assert.equal(home.active.note.libraryID, 2); assert.equal(home.active.note.parentID, undefined);
 home.active.disposeEditor(); window.close();
});

test('the native window resolves primitive workspace IDs through Zotero and shows startup errors visibly', async () => {
 const source = await readFile(new URL('../src/note-window.js', import.meta.url), 'utf8');
 for (const valid of [true, false]) {
  const { document } = loadPlugin(); const host = document.createElement('main'); host.id = 'abstractin-note-root'; document.body.append(host);
  let handler, mounted = false;
  const home = {}, plugin = { _noteOutHomes: new Map(valid ? [['1', home]] : []), mountNoteOutHome: async (_win, received) => { assert.equal(received, home); mounted = true; } };
  const win = { arguments: [{ homeKey: '1' }], document, addEventListener: (_type, fn) => { handler = fn; } };
  runInNewContext(source, { window: win, Zotero: { AbstractIn: plugin } }); await handler();
  if (valid) assert.equal(mounted, true); else assert.match(host.textContent, /workspace is unavailable/);
 }
});

test('shared notes keep one top-level source and every linked document has a persistent native link', async () => {
 const { p, window, parent, items } = await setup(); p._markdownNoteWindows.clear();
 const second = new window.Zotero.Item('book'); second.title = 'Second paper'; await second.saveTx();
 window.openDialog = () => ({ closed: false, focus() {} });
 const documents = [parent, second].map(item => p.noteDocumentRef(item));
 await p.openMarkdownNote({ win: window, documents });
 const state = [...p._markdownNoteWindows.values()][0], data = p.markdownNoteData(state.note);
 assert.equal(!!state.note.parentID, false); assert.deepEqual(Array.from(data.documents, r => r.key), documents.map(r => r.key));
 for (const item of [parent, second]) {
  const anchor = [...items.values()].find(n => n.parentID === item.id && p.noteInMetadata(n, item) === 'out-anchor');
  assert.ok(anchor); assert.match(anchor.getNote(), new RegExp('zotero://select/library/items/' + state.note.key));
 }
 assert.equal([...items.values()].filter(n => p.markdownNoteData(n)?.documents?.length === 2).length, 1);
});

test('changing one-document notes to shared notes and back moves the source and updates links without deleting notes', async () => {
 const { p, window, note, state, parent, items } = await setup();
 const second = new window.Zotero.Item('book'); second.title = 'Another document'; await second.saveTx();
 await p.mountMarkdownNote(window, state);
 assert.equal(state.chatHost.hidden, false); assert.ok(state.chatView); assert.equal(state.assistantMode.value, 'answer');
 state.documents = [parent, second].map(item => p.noteDocumentRef(item)); state.revision++; await state.flush();
 assert.equal(!!note.parentID, false); assert.equal(p.markdownNoteData(note).documents.length, 2);
 const count = items.size;
 state.documents = [p.noteDocumentRef(second)]; state.revision++; await state.flush();
 assert.equal(note.parentID, second.id); assert.equal(p.markdownNoteData(note).itemKey, second.key); assert.equal(items.size, count);
 for (const item of [parent, second]) {
  const anchor = [...items.values()].find(n => n.parentID === item.id && p.noteInMetadata(n, item) === 'out-anchor');
  assert.doesNotMatch(anchor.getNote(), new RegExp('zotero://select/library/items/' + note.key));
 }
 state.disposeEditor(); window.close();
});

test('opening NoteOut from either linked document finds the same shared note', async () => {
 const { p, window, document, note, parent } = await setup(); p._markdownNoteWindows.clear();
 const second = new window.Zotero.Item('book'); second.title = 'Another paper'; await second.saveTx();
 note.parentID = false; note.setNote(p.markdownNoteHTML(note, 'Shared analysis', 'One source', null, 2, [parent, second].map(item => p.noteDocumentRef(item))));
 const home = { key: '1', libraryID: 1, parent, documents: [p.noteDocumentRef(parent)], states: new Map() };
 await p.mountNoteOutHome(window, home);
 assert.match(document.querySelector('.abstractin-note-list-items').textContent, /Shared analysis/);
 home.documents = [p.noteDocumentRef(second)]; home.updateAssociation(); await home.refresh();
 assert.match(document.querySelector('.abstractin-note-list-items').textContent, /Shared analysis/);
 const button = document.querySelector('.abstractin-note-list-item'); await button.onclick();
 assert.equal(home.active.note.key, note.key); assert.equal(home.active.input.value, 'One source');
 home.active.disposeEditor(); window.close();
});

test('edit mode previews a scoped change and applies it only to the unchanged source snapshot', async () => {
 const { p, window, state } = await setup(); await p.mountMarkdownNote(window, state);
 state.input.value = 'Before selected after'; state.input.setSelectionRange(7, 15); state.contextScope.value = 'selection'; state.assistantMode.value = 'edit';
 p.runBackend = async (_, request) => { assert.match(request.question, /complete replacement Markdown/); assert.match(request.question, /selected/); assert.doesNotMatch(request.question, /Before selected after/); return { text: JSON.stringify({ explanation: 'Improved wording', markdown: '**replacement**' }) }; };
 const pending = { backend: 'codex', model: 'fixture', progress() {}, cancelled: false };
 const answer = await p.ask(state.chatView.ctx, 'Improve this selection', pending); assert.ok(!answer.error);
 assert.equal(state.input.value, 'Before selected after'); assert.match(state.proposalHost.textContent, /Improved wording/);
 await state.proposalHost.querySelector('button').onclick();
 assert.equal(state.input.value, 'Before **replacement** after'); assert.equal(p.markdownNoteData(state.note).markdown, state.input.value);
 state.disposeEditor(); window.close();
});

test('stale and malformed model edits cannot overwrite a newer note', async () => {
 const { p, window, state } = await setup(); await p.mountMarkdownNote(window, state); state.assistantMode.value = 'edit';
 const pending = { backend: 'codex', model: 'fixture', progress() {}, cancelled: false };
 p.runBackend = async () => ({ text: '{"explanation":"Rewrite","markdown":"Replacement"}' });
 await p.ask(state.chatView.ctx, 'Rewrite', pending); state.input.value = 'Newer manual version';
 await state.proposalHost.querySelector('button').onclick(); assert.equal(state.input.value, 'Newer manual version'); assert.match(state.proposalHost.textContent, /note has changed/);
 p.runBackend = async () => ({ text: 'Invalid edit' });
 assert.match((await p.ask(state.chatView.ctx, 'Retry', pending)).error, /invalid edit proposal/); assert.equal(state.input.value, 'Newer manual version');
 state.disposeEditor(); window.close();
});

test('linked document selection resolves child attachments and rejects other libraries', async () => {
 const { p, window, parent } = await setup();
 window.ZoteroPane = { itemsView: { getSelectedItems: () => [parent, { parentID: parent.id }] } };
 assert.equal((await p.selectedNoteDocuments(1)).length, 1);
 await assert.rejects(p.selectedNoteDocuments(2), /same library/);
});

test('the divider supports pointer dragging, bounded widths, keyboard adjustment and persisted sizing', async () => {
 const { p, window, document, state } = await setup(); await p.mountMarkdownNote(window, state);
 const host = state.editor.parentElement; host.getBoundingClientRect = () => ({ left: 0, width: 1008 });
 const pointer = (target, type, clientX) => {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
  Object.defineProperty(event, 'pointerId', { value: 7 }); target.dispatchEvent(event);
 };
 pointer(state.splitter, 'pointerdown', 580); pointer(document, 'pointermove', 650);
 assert.equal(state.splitter.getAttribute('aria-valuenow'), '65'); assert.ok(document.querySelector('.abstractin-note-resize-shield'));
 pointer(document, 'pointerup', 650); assert.equal(p.getPref('noteEditorRatio'), 65); assert.equal(document.querySelector('.abstractin-note-resize-shield'), null);
 state.splitter.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); assert.equal(p.getPref('noteEditorRatio'), 63);
 pointer(state.splitter, 'pointerdown', 630); pointer(document, 'pointermove', 9999); pointer(document, 'pointercancel', 9999);
 assert.equal(state.splitter.getAttribute('aria-valuenow'), '70');
 state.splitter.dispatchEvent(new window.MouseEvent('dblclick')); assert.equal(p.getPref('noteEditorRatio'), 58);
 const toggle = [...document.querySelectorAll('button')].find(button => button.textContent === 'Hide discussion'); await toggle.onclick();
 assert.equal(state.splitter.hidden, true); assert.ok(host.classList.contains('abstractin-note-chat-hidden'));
 state.dispose(); window.close();
});

test('trash requires a named confirmation, preserves source and local drafts, and returns an empty home to the compact start screen', async () => {
 const { p, window, document, note, parent, items } = await setup(); p._markdownNoteWindows.clear();
 const other = new window.Zotero.Item('note'); other.parentID = parent.id; other.setNote('<p>Unrelated note</p>'); await other.saveTx();
 const home = { key: '1', libraryID: 1, states: new Map() }; await p.mountNoteOutHome(window, home);
 await p.openMarkdownNote({ win: window, note, home }); const state = home.active;
 p.confirmTrashMarkdownNote(state); assert.match(state.trashPrompt.textContent, /Original note/); assert.equal(!!note.deleted, false);
 state.trashPrompt.querySelectorAll('button')[1].click(); assert.equal(state.trashPrompt.isConnected, false); assert.equal(!!note.deleted, false);
 state.input.value = 'Preserve this unsaved source'; state.revision++;
 const count = items.size; p.confirmTrashMarkdownNote(state); await state.trashPrompt.querySelector('button').onclick();
 assert.equal(note.deleted, true); assert.equal(items.size, count); assert.equal(other.getNote(), '<p>Unrelated note</p>'); assert.equal(!!other.deleted, false);
 assert.equal(p._markdownNoteWindows.has(state.key), false); assert.equal(home.states.size, 0); assert.equal(home.active, null);
 assert.equal(document.querySelector('.abstractin-note-home-empty').hidden, false); assert.equal(document.querySelector('.abstractin-note-home-empty button').textContent, '+ New note');
 const draft = JSON.parse(await readFile(join(state.dir, 'draft.json'), 'utf8')); assert.equal(draft.markdown, 'Preserve this unsaved source');
 assert.match(note.getNote(), /Preserve this unsaved source/); window.close();
});

test('failed and read-only trash operations leave the editor and native note available', async () => {
 const { p, window, note, state } = await setup(); await p.mountMarkdownNote(window, state);
 const save = note.saveTx.bind(note); note.saveTx = async () => { if (note.deleted) throw new Error('Trash save failed'); return save(); };
 await assert.rejects(p.trashMarkdownNote(state), /Trash save failed/);
 assert.equal(note.deleted, false); assert.equal(state.input.disabled, false); assert.equal(state.editor.inert, false); assert.equal(state.disposed, undefined);
 assert.equal(p._markdownNoteWindows.get(state.key), state);
 note.isEditable = () => false; await assert.rejects(p.trashMarkdownNote(state), /read-only/); assert.equal(note.deleted, false);
 state.dispose(); window.close();
});

test('trashing a shared note removes source links and reopening after native restoration rebuilds them', async () => {
 const { p, window, parent, note, items } = await setup(); p._markdownNoteWindows.clear();
 const second = new window.Zotero.Item('book'); second.title = 'Second source'; await second.saveTx();
 const documents = [parent, second].map(item => p.noteDocumentRef(item));
 note.parentID = false; note.setNote(p.markdownNoteHTML(note, 'Shared note', 'Shared source text', null, 2, documents));
 const home = { key: '1', libraryID: 1, states: new Map() }; await p.mountNoteOutHome(window, home); await p.openMarkdownNote({ win: window, note, home });
 const anchors = [parent, second].map(item => [...items.values()].find(n => n.parentID === item.id && p.noteInMetadata(n, item) === 'out-anchor'));
 assert.ok(anchors.every(anchor => anchor.getNote().includes('/items/' + note.key)));
 await p.trashMarkdownNote(home.active); assert.ok(anchors.every(anchor => !anchor.getNote().includes('/items/' + note.key)));
 note.deleted = false; await note.saveTx(); await p.openMarkdownNote({ win: window, note, home });
 assert.ok(anchors.every(anchor => anchor.getNote().includes('/items/' + note.key))); assert.equal(home.active.input.value, 'Shared source text');
 home.active.dispose(); window.close();
});

test('the persistent three-column workspace keeps its list visible and remembers both divider widths independently', async () => {
 const { p, window, document, note } = await setup(); p._markdownNoteWindows.clear();
 const home = { key: '1', libraryID: 1, states: new Map() }; await p.mountNoteOutHome(window, home);
 assert.equal(home.active.note, note); assert.equal(home.sidebar.hidden, false);
 const visible = [...document.querySelectorAll('.abstractin-note-splitter')].filter(node => !node.closest('[hidden]')); assert.equal(visible.length, 2);
 const host = document.getElementById('abstractin-note-root'); host.getBoundingClientRect = () => ({ left: 0, width: 1408 });
 home.active.host.getBoundingClientRect = () => ({ left: 288, width: 1120 });
 const drag = (splitter, clientX) => {
  for (const [target, type] of [[splitter, 'pointerdown'], [document, 'pointermove'], [document, 'pointerup']]) {
   const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }); Object.defineProperty(event, 'pointerId', { value: 8 }); target.dispatchEvent(event);
  }
 };
 drag(home.sidebarSplitState.splitter, 280); assert.equal(p.getPref('noteSidebarRatio'), 20);
 drag(home.active.splitter, 955.2); assert.equal(p.getPref('noteEditorRatio'), 60); assert.equal(p.getPref('noteSidebarRatio'), 20);
 home.active.input.value = 'Draft remains while browsing';
 await p.openMarkdownNote({ win: window, home });
 assert.equal(home.sidebar.hidden, false); assert.equal(home.active.splitter.getAttribute('aria-valuenow'), '60');
 const original = [...home.states.values()].find(state => state.note.key === note.key); assert.equal(original.input.value, 'Draft remains while browsing');
 assert.equal(document.querySelectorAll('.abstractin-note-toolbar button').length > 0, true);
 for (const state of home.states.values()) state.dispose(); window.close();
});

test('a list delete button confirms and trashes an unopened note without changing the active editor', async () => {
 const { p, window, document, note, parent } = await setup(); p._markdownNoteWindows.clear();
 const home = { key: '1', libraryID: 1, states: new Map() }; await p.mountNoteOutHome(window, home); const active = home.active;
 const other = new window.Zotero.Item('note'); other.parentID = parent.id; other.addTag('AbstractIn:Markdown');
 other.setNote(p.markdownNoteHTML(other, 'Unopened note', 'Keep source recoverable', parent, 3)); await other.saveTx(); await home.refresh();
 p.openMarkdownNote = async () => { throw new Error('Deleting an unopened note must not open it'); };
 const row = [...document.querySelectorAll('.abstractin-note-list-row')].find(row => row.querySelector('.abstractin-note-list-item').dataset.noteKey === other.key);
 row.querySelector('.abstractin-note-list-trash').click(); assert.equal(home.active, active); assert.equal(!!other.deleted, false); assert.match(row.textContent, /Unopened note/);
 row.querySelector('.abstractin-note-trash-confirm button:last-child').click(); assert.equal(row.querySelector('.abstractin-note-trash-confirm'), null);
 row.querySelector('.abstractin-note-list-trash').click(); await row.querySelector('.abstractin-note-trash-confirm button').onclick();
 assert.equal(other.deleted, true); assert.equal(!!note.deleted, false); assert.equal(home.active, active); assert.equal(active.disposed, undefined);
 assert.match(other.getNote(), /Keep source recoverable/); assert.equal(p._markdownNoteWindows.has('1:' + other.key), false);
 assert.equal([...document.querySelectorAll('.abstractin-note-list-item')].some(button => button.dataset.noteKey === other.key), false);
 active.dispose(); window.close();
});

test('native selected-note and new-note shortcuts route into the same three-column home', async () => {
 const { p, window, note, parent } = await setup(); p._markdownNoteWindows.clear();
 window.ZoteroPane = { itemsView: { getSelectedItems: () => [note] } };
 let args; window.openDialog = (_url, _name, _features, value) => { args = value; return { closed: false, focus() {} }; };
 await p.openSelectedMarkdownNote(window); assert.equal(args.homeKey, '1'); assert.equal(args.noteKey, undefined);
 const home = p._noteOutHomes.get('1'); assert.equal(home.initialNote, note);
 await p.mountNoteOutHome(window, home); assert.equal(home.active.note, note); assert.equal(home.sidebar.hidden, false);
 await p.openNoteOutHome(window, { documents: [p.noteDocumentRef(parent)], create: true });
 assert.notEqual(home.active.note.key, note.key); assert.equal(home.active.note.parentID, parent.id); assert.equal(home.states.size, 2);
 assert.equal(home.sidebar.hidden, false); for (const state of home.states.values()) state.dispose(); window.close();
});

test('the editor exposes an in-place shortcut reference from the actual binding catalog', async () => {
 const { markdownShortcuts } = await import('../src/content/editor/markdown-shortcuts.js');
 const { p, window, document, state } = await setup(); await p.mountMarkdownNote(window, state);
 state.input._composerEditor = { markdownShortcuts };
 const help = document.querySelector('.abstractin-note-shortcuts'); assert.equal(help.querySelector('summary').textContent, 'Shortcuts');
 help.open = true; help.dispatchEvent(new window.Event('toggle'));
 assert.match(help.textContent, /Ctrl\+B/); assert.match(help.textContent, /Ctrl\+Alt\+1/); assert.match(help.textContent, /Fixed shortcuts/);
 assert.equal(help.querySelectorAll('tbody tr').length, markdownShortcuts.length + 3);
 assert.equal(state.input.value, p.markdownNoteData(state.note).markdown); state.dispose(); window.close();
});
