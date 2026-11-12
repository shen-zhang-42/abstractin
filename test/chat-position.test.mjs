import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin } from './load-plugin.mjs';

function setup(prefs = {}) {
 const env = loadPlugin({ prefs }), { plugin: p, document } = env;
 const host = document.createElement('div'); document.body.append(host); p.renderSkeleton(document, host);
 const root = host.querySelector('.abstractin-root'), logEl = root.querySelector('.abstractin-log');
 let top = 0;
 Object.defineProperties(logEl, {
  clientHeight: { configurable: true, get: () => 200 },
  scrollHeight: { get: () => 1200 },
  scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(1000, value)); } },
 });
 const view = { root, logEl, doc: document, ctx: { dir: '/book/chat-a' } }; p._views.set(root, view);
 // Exercise the real replay/position wrapper with predictable layout metrics.
 p.renderChatMessages = current => {
  current.logEl.replaceChildren();
  for (let i = 0; i < 6; i++) {
   const node = document.createElement('div'); node.className = 'abstractin-turn'; current.logEl.append(node);
   node.getBoundingClientRect = () => ({ top: i * 200 - top, bottom: (i + 1) * 200 - top });
   p.scrollToEnd(current.logEl);
  }
 };
 return { ...env, p, view };
}

test('each chat restores its own reading position across switches and plugin reloads', () => {
 const env = setup(), { p, view, prefs } = env;
 p.renderMessages(view, []); assert.equal(view.logEl.scrollTop, 1000);
 view.logEl.scrollTop = 350;
 view.ctx = { dir: '/book/chat-b' }; p.renderMessages(view, []);
 assert.equal(view.logEl.scrollTop, 1000); view.logEl.scrollTop = 620;
 view.ctx = { dir: '/book/chat-a' }; p.renderMessages(view, []); assert.equal(view.logEl.scrollTop, 350);
 view.ctx = { dir: '/book/chat-b' }; p.renderMessages(view, []); assert.equal(view.logEl.scrollTop, 620);
 const reopened = setup(prefs); reopened.p.renderMessages(reopened.view, []);
 assert.equal(reopened.view.logEl.scrollTop, 350);
 reopened.window.close(); env.window.close();
});

test('replaying history preserves position while continuing discussion goes to the latest message', () => {
 const { p, view, window } = setup(); p.renderMessages(view, []);
 view.logEl.scrollTop = 280; p.renderMessages(view, []); assert.equal(view.logEl.scrollTop, 280);
 p.scrollToEnd(view.logEl); assert.equal(view.logEl.scrollTop, 1000);
 p.renderMessages(view, []); assert.equal(view.logEl.scrollTop, 1000); window.close();
});

test('history browser scrolling never replaces the chat bookmark', () => {
 const { p, view, window } = setup(); p.renderMessages(view, []); view.logEl.scrollTop = 430;
 p.rememberChatPosition(view);
 view.historyBrowser = { scrollTop: 430 }; view.logEl.scrollTop = 50; p.rememberChatPosition(view);
 delete view.historyBrowser;
 view.logEl.innerHTML = '<section class="abstractin-history-browser"></section>';
 p.renderMessages(view, []); assert.equal(view.logEl.scrollTop, 430); window.close();
});

test('closing the UI flushes the position without waiting for the scroll debounce', () => {
 const { p, view, prefs, window } = setup(); p.renderMessages(view, []);
 view.logEl.scrollTop = 271; view.logEl.dispatchEvent(new window.Event('scroll'));
 view.root.disposeUI();
 const reopened = setup(prefs); reopened.p.renderMessages(reopened.view, []);
 assert.equal(reopened.view.logEl.scrollTop, 271); reopened.window.close(); window.close();
});

test('hidden views do not overwrite a saved chat position with a collapsed layout', () => {
 const { p, view, window } = setup(); p.renderMessages(view, []); view.logEl.scrollTop = 420; p.rememberChatPosition(view);
 Object.defineProperty(view.logEl, 'clientHeight', { value: 0 }); view.logEl.scrollTop = 0; p.rememberChatPosition(view);
 p.restoreChatPosition(view); assert.equal(view.logEl.scrollTop, 420); window.close();
});
