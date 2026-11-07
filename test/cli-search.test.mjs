import test from 'node:test';
import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { loadPlugin } from './load-plugin.mjs';

function fixture(tree, env = {}) {
 const e = loadPlugin(), p = e.plugin; e.window.Zotero.isWin = true; p.agentRegistry();
 const read = [], closed = [];
 const entry = path => ({ path, name: win32.basename(path), ...tree[path] });
 e.window.Subprocess.getEnvironment = () => env;
 e.window.OS = { Path: { join: win32.join, normalize: win32.normalize }, File: {
  stat: async path => { const info = tree[path]; if (!info || info.denied) throw new Error('not readable'); return info; },
  DirectoryIterator: class {
   constructor(path) { this.path = path; read.push(path); }
   async forEach(callback) { for (const path of Object.keys(tree)) if (path !== this.path && win32.dirname(path) === this.path) callback(entry(path)); }
   close() { closed.push(this.path); }
  },
 } };
 return { ...e, p, read, closed };
}

test('CLI search stays inside the supplied directory, recurses and skips links and unreadable folders', async () => {
 const { p, read, closed } = fixture({
  'D:\\tools': { isDir: true }, 'D:\\tools\\locked': { isDir: true, denied: true },
  'D:\\tools\\link': { isDir: true, isSymLink: true }, 'D:\\tools\\link\\gemini.exe': {},
  'D:\\tools\\nested': { isDir: true }, 'D:\\tools\\nested\\gemini.cmd': {},
  'C:\\outside': { isDir: true }, 'C:\\outside\\gemini.exe': {},
 }, { PATH: 'C:\\outside', USERPROFILE: 'C:\\Users\\test' });
 assert.equal(await p.findBinary('gemini', { directory: 'D:\\tools' }), 'D:\\tools\\nested\\gemini.cmd');
 assert.ok(read.every(path => path.startsWith('D:\\tools'))); assert.ok(!read.includes('D:\\tools\\link'));
 assert.deepEqual(closed, read);
});

test('empty Windows search directory starts at C drive and probes common installation paths first', async () => {
 const npm = 'C:\\Users\\test\\AppData\\Roaming\\npm';
 const { p, read } = fixture({ 'C:\\': { isDir: true }, [npm]: { isDir: true }, [npm + '\\gemini.cmd']: {} }, { USERPROFILE: 'C:\\Users\\test', PATH: 'D:\\outside' });
 assert.equal(p.defaultCLISearchDirectory(), 'C:\\');
 assert.equal(await p.findBinary('gemini', { directory: '' }), npm + '\\gemini.cmd'); assert.deepEqual(read, []);
});

test('directory lookup ignores an older executable while normal launches retain it', async () => {
 const { p } = fixture({ 'D:\\tools': { isDir: true }, 'D:\\tools\\gemini.exe': {} });
 p.setPref('geminiPath', 'C:\\existing\\gemini.exe');
 assert.equal(await p.findBinary('gemini'), 'C:\\existing\\gemini.exe');
 assert.equal(await p.findBinary('gemini', { directory: 'D:\\tools' }), 'D:\\tools\\gemini.exe');
 assert.equal(p.getPref('geminiPath'), 'C:\\existing\\gemini.exe');
});

test('search reports cancellation, incomplete timeout and missing matches distinctly', async () => {
 const { p } = fixture({ 'D:\\tools': { isDir: true } });
 await assert.rejects(p.findBinary('gemini', { directory: 'D:\\tools', isCancelled: () => true }), /cancelled/);
 await assert.rejects(p.findBinary('gemini', { directory: 'D:\\tools', timeout: -1 }), /timed out before covering/);
 await assert.rejects(p.findBinary('gemini', { directory: 'D:\\tools' }), /readable subdirectories/);
 await assert.rejects(p.findBinary('gemini', { directory: 'relative' }), /absolute search directory/);
});
