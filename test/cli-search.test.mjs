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
 await assert.rejects(p.findBinary('gemini', { directory: 'relative' }), /absolute path/);
});

test("search works with Zotero's OS.File, which reports every path as a link", async () => {
 const home = 'C:\\Users\\test', ext = home + '\\.positron\\extensions';
 const binary = version => ext + '\\anthropic.claude-code-' + version + '-win32-x64\\resources\\native-binary';
 const tree = { 'C:\\': { isDir: true }, [home]: { isDir: true }, [home + '\\.positron']: { isDir: true }, [ext]: { isDir: true } };
 for (const version of ['2.1.319', '2.1.322']) {
  const folder = ext + '\\anthropic.claude-code-' + version + '-win32-x64';
  Object.assign(tree, { [folder]: { isDir: true }, [folder + '\\resources']: { isDir: true }, [binary(version)]: { isDir: true }, [binary(version) + '\\claude.exe']: {} });
 }
 const e = fixture(tree, { USERPROFILE: home, PATH: '' });
 // Mirror chrome/content/zotero/osfile.mjs: stat() always says isSymLink, entries carry only isDir.
 const { stat, DirectoryIterator } = e.window.OS.File;
 e.window.OS.File.stat = async path => ({ ...(await stat(path)), isSymLink: true });
 e.window.OS.File.DirectoryIterator = class extends DirectoryIterator {
  async forEach(callback) { await super.forEach(entry => callback({ name: entry.name, path: entry.path, isDir: !!entry.isDir })); }
 };
 assert.equal(await e.p.findBinary('claude', { directory: binary('2.1.322') }), binary('2.1.322') + '\\claude.exe');
 assert.equal(await e.p.findBinary('claude', { directory: '' }), binary('2.1.322') + '\\claude.exe', 'blank search finds the newest editor extension');
});

test('a chosen executable is used directly instead of being rejected as not a directory', async () => {
 const { p, read } = fixture({ 'D:\\my tools\\claude.exe': {}, 'D:\\my tools\\claude.cmd': {}, 'D:\\bin\\gemini.cmd': {}, 'D:\\bin\\notes.txt': {} });
 assert.equal(await p.findBinary('claude', { directory: '"D:\\my tools\\claude.exe"' }), 'D:\\my tools\\claude.exe');
 assert.equal(await p.findBinary('gemini', { directory: 'D:\\bin\\gemini.cmd' }), 'D:\\bin\\gemini.cmd');
 await assert.rejects(p.findBinary('claude', { directory: 'D:\\my tools\\claude.cmd' }), /native claude\.exe/);
 await assert.rejects(p.findBinary('gemini', { directory: 'D:\\bin\\notes.txt' }), /Choose an executable/);
 await assert.rejects(p.findBinary('gemini', { directory: 'D:\\missing.exe' }), /Cannot read/);
 assert.deepEqual(read, []);
});

test('drive-wide search checks editor extensions before the drive and skips the Windows folder', async () => {
 const home = 'C:\\Users\\test', ext = home + '\\.vscode\\extensions';
 const { p, read } = fixture({
  'C:\\': { isDir: true }, 'C:\\Windows': { isDir: true }, 'C:\\Windows\\gemini.exe': {}, [home]: { isDir: true },
  'C:\\Users': { isDir: true }, [home + '\\.vscode']: { isDir: true }, [ext]: { isDir: true },
  [ext + '\\google.gemini-1.0']: { isDir: true }, [ext + '\\google.gemini-1.0\\bin']: { isDir: true }, [ext + '\\google.gemini-1.0\\bin\\gemini.exe']: {},
 }, { USERPROFILE: home, PATH: '' });
 assert.equal(await p.findBinary('gemini', { directory: '' }), ext + '\\google.gemini-1.0\\bin\\gemini.exe');
 assert.ok(!read.includes('C:\\'), 'the drive root is searched only after likely folders');
 const drive = fixture({ 'C:\\': { isDir: true }, 'C:\\Windows': { isDir: true }, 'C:\\Windows\\gemini.exe': {} }, { PATH: '' });
 await assert.rejects(drive.p.findBinary('gemini', { directory: 'C:\\' }), /Could not find/);
 assert.ok(!drive.read.includes('C:\\Windows'));
});
