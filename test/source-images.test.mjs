import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

test('source image rendering bounds resolution and reuses a rendered page', async () => {
 const { plugin: p, window, document } = loadPlugin();
 window.OS = { Path: { join: (...parts) => parts.join('/') } };
 let renders = 0, writes = 0;
 const canvas = { getContext: () => ({}), toBlob: callback => callback('png-data') };
 document.createElementNS = () => canvas;
 window.Zotero.File = { createDirectoryIfMissingAsync: async () => {}, putContentsAsync: async (_, data) => { assert.equal(data, 'png-data'); writes++; } };
 p.attachmentPath = () => '/chat/attachments/page.png';
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 20, getPage: async number => {
  assert.equal(number, 13);
  return { getViewport: ({ scale }) => ({ width: 2000 * scale, height: 4000 * scale }), render: () => { renders++; return { promise: Promise.resolve() }; } };
 } } });
 const ctx = { dir: '/chat', attachmentItem: { key: 'PDF' }, reading: { pdfSource: { signature: 'one' } } };
 const image = await p.readingPageImage(ctx, 12, 'codex');
 assert.equal(image.status, 'available'); assert.equal(canvas.height, 2000); assert.equal(canvas.width, 1000);
 assert.equal((await p.readingPageImage(ctx, 12, 'codex')).path, image.path);
 assert.equal(renders, 1); assert.equal(writes, 1);
 assert.match((await p.readingPageImage(ctx, 20, 'codex')).status, /outside/);
});

test('source image retrieval reports a closed PDF without claiming visual evidence', async () => {
 const { plugin: p } = loadPlugin(); p.readingPDFApplication = () => null;
 const image = await p.readingPageImage({ dir: '/chat', reading: {} }, 2, 'codex');
 assert.match(image.status, /unavailable.*open/); assert.equal(image.path, undefined);
});

test('PDF.js receives viewport and render options in its own reader compartment', async () => {
 const { plugin: p, window, document } = loadPlugin();
 window.OS = { Path: { join: (...parts) => parts.join('/') } };
 const readerObjects = new WeakSet();
 let rendered = false;
 const canvasContext = {}, canvas = { getContext: () => canvasContext, toBlob: callback => callback('reader-png') };
 const readerGlobal = { document: { createElementNS: () => canvas } };
 canvasContext.canvas = canvas;
 document.createElementNS = () => { throw new Error('The chrome document must not create the PDF canvas'); };
 window.Components = { utils: {
  waiveXrays: value => value,
  getGlobalForObject: () => readerGlobal,
  createObjectIn: scope => { assert.equal(scope, readerGlobal); const value = {}; readerObjects.add(value); return value; },
 } };
 p.readingPDFApplication = () => ({ pdfDocument: { numPages: 3, getPage: async () => ({
  getViewport: options => {
   assert.ok(readerObjects.has(options), 'Privileged viewport options would hide scale from PDF.js');
   return { width: 600 * options.scale, height: 800 * options.scale };
  },
  render: options => {
   if (!readerObjects.has(options)) throw new Error('canvasContext is undefined');
   assert.equal(options.canvasContext, canvasContext); assert.equal(options.canvas, canvas);
   assert.equal(options.viewport.width, 900); rendered = true;
   return { promise: Promise.resolve() };
  },
 }) } });
 window.Zotero.File = { createDirectoryIfMissingAsync: async () => {}, putContentsAsync: async (_, data) => assert.equal(data, 'reader-png') };
 p.attachmentPath = () => '/chat/attachments/native.png';
 const image = await p.readingPageImage({ dir: '/chat', reading: {} }, 1, 'codex');
 assert.equal(image.status, 'available'); assert.equal(rendered, true);
});
