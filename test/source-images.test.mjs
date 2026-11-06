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
