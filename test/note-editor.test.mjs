import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlugin } from './load-plugin.mjs';

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
 window.Zotero.Item = Item; window.Zotero.Items = { get: id => items.get(id), getAsync: async id => items.get(id) };
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
  opened++; assert.match(url, /note-window.xhtml$/); assert.equal(args.plugin, p); assert.equal(args.state.note, note);
  assert.match(features, /resizable=yes/); return native;
 };
 assert.equal(await p.openMarkdownNote({ win: window, note }), native);
 assert.equal(await p.openMarkdownNote({ win: window, note }), native);
 assert.equal(opened, 1); assert.equal(focused, 1); assert.equal(p._readerPanelWindows.get(window), discussion);
 assert.equal(state.note, note);
});

test('note editor reuses the composer, previews Markdown/math, and saves source/title changes', async () => {
 const { p, window, document, note, state } = await setup();
 let options; const install = p.installMathComposer; p.installMathComposer = function(input, config) { options = config; return install.call(this, input, config); };
 await p.mountMarkdownNote(window, state); assert.equal(options.note, true);
 state.input.value = '# Updated\n\n$$a=b$$'; state.title.value = 'Updated title'; state.revision++;
 await p.saveMarkdownNote(state);
 assert.equal(p.markdownNoteData(note).markdown, state.input.value); assert.equal(p.markdownNoteData(note).title, 'Updated title');
 [...document.querySelectorAll('button')].find(b => b.textContent === 'Preview').click();
 assert.match(state.preview.textContent, /Updated/); assert.ok(state.preview.querySelector('math'));
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
 const dir = join(state.dir, 'discussion'); await mkdir(dir);
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
 const dir = join(state.dir, 'discussion'); await mkdir(dir);
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
