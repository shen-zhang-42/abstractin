import test from "node:test";
import assert from "node:assert/strict";
import { loadPlugin } from "./load-plugin.mjs";

function setup({ detached = false } = {}) {
	const env = loadPlugin({ prefs: { "extensions.abstractin.onboarded": true } });
	const { window: win, document: doc, plugin: p } = env;
	doc.body.innerHTML = detached
		? '<div id="layout"><div id="zotero-reader"><div id="reader"></div></div></div>'
		: '<div id="layout"><div id="reader-deck"></div><div id="zotero-context-splitter" state="open"></div><div id="zotero-context-pane"></div></div>';
	doc.createXULElement = name => doc.createElement(name);
	win.MozXULElement = { insertFTLIfNeeded() {} };
	let collapsed = false;
	win.ZoteroContextPane = { get collapsed() { return collapsed; }, set collapsed(value) {
		collapsed = value;
		doc.getElementById("zotero-context-pane")?.toggleAttribute("collapsed", value);
	}, update() {} };
	win.Zotero_Tabs = { selectedID: "tab-a", selectedType: "reader" };
	const a = { tabID: "tab-a", itemID: 11, type: "pdf", _window: win };
	const b = { tabID: "tab-b", itemID: 12, type: "pdf", _window: win };
	const items = new Map([[11, { id: 11 }], [12, { id: 12 }]]);
	let observer;
	win.Zotero.Notifier = { registerObserver(value) { observer = value; return 3; }, unregisterObserver(id) { assert.equal(id, 3); observer = null; } };
	win.Zotero.Items = { get: id => items.get(id) };
	win.Zotero.Reader = { getByTabID: id => id === a.tabID ? a : id === b.tabID ? b : null };
	p.checkInstalledBackends = async () => {};
	p.renderContent = async (doc, body, item) => {
		let root = body.querySelector(".zs-root");
		p._views.set(root, { doc, root, ctx: { dir: "reading-" + item.id, attachmentItem: item }, input: root.querySelector(".zs-input") });
		root.querySelector(".zs-input").disabled = false;
	};
	return { ...env, a, b, observer: () => observer };
}

test("reader toolbar uses the public append hook and toggles a panel outside item metadata", async () => {
	const { plugin: p, document: doc, window: win, a } = setup();
	const toolbar = doc.createElement("div"); doc.body.append(toolbar);
	p.renderReaderToolbar({ reader: a, doc, append: node => toolbar.append(node) });
	const button = toolbar.querySelector(".zs-reader-toggle");
	assert.equal(button.getAttribute("aria-label"), "Toggle AbstractIn panel");
	await p.openReaderPanel(a);
	const panel = doc.querySelector(".zs-reader-panel");
	assert.equal(panel.hidden, false);
	assert.equal(panel.parentElement, doc.getElementById("layout"));
	assert.equal(doc.getElementById("zotero-context-pane").contains(panel), false);
	assert.equal(win.ZoteroContextPane.collapsed, true);
	assert.equal(button.getAttribute("aria-pressed"), "true");
	button.click();
	assert.equal(panel.hidden, true);
	assert.equal(win.ZoteroContextPane.collapsed, false, "closing restores the previously open native pane");
});

test("closing and reopening retains composer draft and a running request", async () => {
	const { plugin: p, document: doc, a } = setup();
	await p.openReaderPanel(a);
	const root = doc.querySelector(".zs-reader-panel .zs-root");
	root.querySelector("textarea").value = "Unsent question";
	const pending = { cancel() { assert.fail("panel visibility must not cancel requests"); } };
	p._pending.set("reading-11", pending);
	p.closeReaderPanel(a._window);
	await p.openReaderPanel(a);
	assert.equal(doc.querySelector(".zs-reader-panel .zs-root"), root);
	assert.equal(root.querySelector("textarea").value, "Unsent question");
	assert.equal(p._pending.get("reading-11"), pending);
});

test("tab switches keep attachment views separate and library tabs hide the panel", async () => {
	const { plugin: p, document: doc, window: win, a, b, observer } = setup();
	await p.openReaderPanel(a);
	const first = doc.querySelector(".zs-reader-view"); first.querySelector("textarea").value = "For A";
	win.Zotero_Tabs.selectedID = "tab-b";
	await observer().notify("select", "tab", ["tab-b"], { "tab-b": { type: "reader" } });
	let views = [...doc.querySelectorAll(".zs-reader-view")];
	assert.equal(views.length, 2);
	assert.equal(first.hidden, true);
	assert.equal(p._views.get(views[1].querySelector(".zs-root")).ctx.attachmentItem.id, b.itemID);
	win.Zotero_Tabs.selectedID = "tab-a";
	await observer().notify("select", "tab", ["tab-a"], { "tab-a": { type: "reader" } });
	assert.equal(first.hidden, false);
	assert.equal(first.querySelector("textarea").value, "For A");
	win.Zotero_Tabs.selectedType = "library";
	win.Zotero_Tabs.selectedID = "library";
	await observer().notify("select", "tab", ["library"], { library: { type: "library" } });
	assert.equal(doc.querySelector(".zs-reader-panel").hidden, true);
});

test("opening the native context pane closes AbstractIn without undoing the native action", async () => {
	const { plugin: p, document: doc, window: win, a } = setup();
	await p.openReaderPanel(a);
	win.ZoteroContextPane.collapsed = false;
	await new Promise(resolve => win.setTimeout(resolve, 0));
	assert.equal(doc.querySelector(".zs-reader-panel").hidden, true);
	assert.equal(win.ZoteroContextPane.collapsed, false);
});

test("window cleanup removes injected controls, observers and view bindings", async () => {
	const { plugin: p, document: doc, window: win, a, observer } = setup();
	p.renderReaderToolbar({ reader: a, doc, append: node => doc.body.append(node) });
	await p.openReaderPanel(a);
	const root = doc.querySelector(".zs-reader-panel .zs-root");
	p.removeReaderPanel(win);
	assert.equal(doc.querySelector(".zs-reader-panel"), null);
	assert.equal(doc.querySelector(".zs-reader-toggle"), null);
	assert.equal(doc.querySelector(".zs-reader-splitter"), null);
	assert.equal(p._views.get(root), undefined);
	assert.equal(observer(), null);
});

test("detached PDF windows support the same independently mounted panel", async () => {
	const { plugin: p, document: doc, a } = setup({ detached: true });
	a.tabID = null;
	await p.openReaderPanel(a);
	assert.equal(doc.querySelector(".zs-reader-panel").parentElement, doc.getElementById("layout"));
	assert.equal(doc.getElementById("zotero-reader").contains(doc.querySelector(".zs-reader-panel")), false);
});

test("unsupported window layouts are reported without changing native context visibility", async () => {
	const { plugin: p, document: doc, window: win, a } = setup();
	doc.getElementById("layout").remove();
	await assert.rejects(p.openReaderPanel(a), /reader layout/);
	assert.equal(win.ZoteroContextPane.collapsed, false);
	assert.equal(doc.querySelector(".zs-reader-panel"), null);
});

test("selection actions reveal the dedicated panel with the exact attachment's draft", async () => {
	const { plugin: p, window: win, a } = setup();
	p.contextDirFor = item => "reading-" + item.id;
	let opened;
	p.openReaderPanel = async reader => { opened = reader; };
	p.askAboutSelection(a, { text: "Exact passage", pageLabel: "iv", position: { pageIndex: 3 } }, false);
	assert.equal(opened, a);
	const draft = p._drafts.get("reading-11");
	assert.equal(draft.selection.attachmentID, 11);
	assert.equal(draft.selection.position.pageIndex, 3);
	assert.equal(win.ZoteroContextPane.collapsed, false, "selection action no longer opens native metadata");
});

test("selecting an unloaded PDF hides the previous attachment until its reader loads", async () => {
	const { plugin: p, document: doc, window: win, a, b, observer } = setup();
	await p.openReaderPanel(a);
	win.Zotero_Tabs.selectedID = "tab-b";
	win.Zotero.Reader.getByTabID = () => null;
	await observer().notify("select", "tab", ["tab-b"], { "tab-b": { type: "reader" } });
	assert.equal(doc.querySelector(".zs-reader-view").hidden, true);
	assert.ok(doc.querySelector(".zs-reader-loading"));
	win.Zotero.Reader.getByTabID = () => b;
	await observer().notify("load", "tab", ["tab-b"], { "tab-b": { type: "reader" } });
	assert.equal(doc.querySelector(".zs-reader-loading"), null);
	const shown = [...doc.querySelectorAll(".zs-reader-view")].find(node => !node.hidden);
	assert.equal(p._views.get(shown.querySelector(".zs-root")).ctx.attachmentItem.id, b.itemID);
});

test("closing a PDF releases its view while a background request can finish", async () => {
	const { plugin: p, document: doc, a, observer } = setup();
	await p.openReaderPanel(a);
	const root = doc.querySelector(".zs-reader-panel .zs-root");
	const pending = { cancel() { assert.fail("closing a PDF must not discard its request"); } };
	p._pending.set("reading-11", pending);
	await observer().notify("close", "tab", [a.tabID]);
	assert.equal(p._views.get(root), undefined);
	assert.equal(root.isConnected, false);
	assert.equal(p._pending.get("reading-11"), pending);
});

test("panel open and close do not wait for streaming renderContent to finish", async () => {
	const { plugin: p, document: doc, window: win, a } = setup();
	p.renderContent = () => new Promise(() => {});
	await p.openReaderPanel(a);
	p.closeReaderPanel(win);
	assert.equal(doc.querySelector(".zs-reader-panel").hidden, true);
});

test("native splitter widths update the HTML panel without changing the native pane", async () => {
	const { plugin: p, document: doc, window: win, a } = setup();
	await p.openReaderPanel(a);
	const panel = doc.querySelector(".zs-reader-panel");
	panel.setAttribute("width", "460");
	await new Promise(resolve => win.setTimeout(resolve, 0));
	assert.equal(panel.style.width, "460px");
	assert.equal(panel.hidden, false);
	assert.equal(win.ZoteroContextPane.collapsed, true);
});

test("metadata section remains available even when reader layout supports a dedicated panel", () => {
	const { plugin: p, document: doc, window: win } = setup();
	let options;
	win.Zotero.ItemPaneManager = { registerSection(value) { options = value; return "abstractin-section"; } };
	p.registerPaneSection();
	let enabled;
	const item = { isRegularItem: () => true };
	const setEnabled = value => { enabled = value; };
	options.onItemChange({ item, doc, tabType: "reader", setEnabled });
	assert.equal(enabled, true);
	options.onItemChange({ item, doc, tabType: "library", setEnabled });
	assert.equal(enabled, true);
	doc.getElementById("layout").remove();
	options.onItemChange({ item, doc, tabType: "reader", setEnabled });
	assert.equal(enabled, true);
});

test("installing into an already loaded PDF restores one visible toolbar entry", async () => {
 const { plugin: p, document: doc, window: win, a } = setup();
 const toolbar = doc.createElement('div'); toolbar.className = 'toolbar'; toolbar.innerHTML = '<div class="end"><button id="context-pane-toggle"></button></div>'; doc.body.append(toolbar);
 a._iframeWindow = { document: doc }; win.Zotero.Reader._readers = [a];
 await p.restoreReaderToolbarEntries(); await p.restoreReaderToolbarEntries();
 const buttons = toolbar.querySelectorAll('.zs-reader-toggle'); assert.equal(buttons.length, 1);
 assert.match(buttons[0].textContent, /AbstractIn/);
 await p.openReaderPanel(a); assert.equal(doc.querySelector('.zs-reader-panel').hidden, false);
 p.removeAllReaderPanels(); assert.equal(toolbar.querySelectorAll('.zs-reader-toggle').length, 0);
});

test("reader item section supplies a panel launcher when the new toolbar entry is absent", async () => {
 const { plugin: p, document: doc, window: win, a } = setup();
 let options; win.Zotero.ItemPaneManager = { registerSection(value) { options = value; return 'abstractin-section'; } }; p.registerPaneSection();
 win.Zotero.Reader._readers = [a];
 const body = doc.createElement('div'); doc.body.append(body);
 const item = { id: 11, isRegularItem: () => false, isFileAttachment: () => true };
 let enabled; options.onItemChange({ item, doc, tabType: 'reader', setEnabled: value => { enabled = value; } }); assert.equal(enabled, true);
 p.readerFor = () => a;
 await options.onAsyncRender({ doc, body, item, tabType: 'reader' });
 const button = body.querySelector('button'); assert.match(button.textContent, /Open AbstractIn/);
 button.click(); await Promise.resolve(); assert.equal(doc.querySelector('.zs-reader-panel').hidden, false);
});

test("late toolbar rendering restores an entry and shutdown removes pending observers", async () => {
 const { plugin: p, document: doc, window: win, a } = setup();
 a._iframeWindow = { document: doc }; win.Zotero.Reader._readers = [a];
 await p.restoreReaderToolbarEntries(); assert.equal(p._readerToolbarObservers.size, 1);
 const toolbar = doc.createElement('div'); toolbar.className = 'toolbar'; toolbar.innerHTML = '<div class="end"></div>'; doc.body.append(toolbar);
 await new Promise(resolve => win.setTimeout(resolve, 0));
 assert.equal(toolbar.querySelectorAll('.zs-reader-toggle').length, 1); assert.equal(p._readerToolbarObservers.size, 0);
 p.removeAllReaderPanels(); toolbar.remove();
 await p.restoreReaderToolbarEntries(); assert.equal(p._readerToolbarObservers.size, 1);
 p.removeAllReaderPanels(); assert.equal(p._readerToolbarObservers.size, 0);
});

test("disabling the plugin while a reader initializes cannot inject an entry afterward", async () => {
 const { plugin: p, document: doc, window: win, a } = setup();
 doc.body.insertAdjacentHTML('beforeend', '<div class="toolbar"><div class="end"></div></div>');
 a._iframeWindow = { document: doc }; win.Zotero.Reader._readers = [a];
 let finish; a._initPromise = new Promise(resolve => { finish = resolve; });
 const restore = p.restoreReaderToolbarEntries(); p.removeAllReaderPanels(); finish(); await restore;
 assert.equal(doc.querySelector('.zs-reader-toggle'), null);
});

test("reader UI uses HTML controls inside Zotero's XUL document and retains header and composer actions", () => {
 const { plugin: p, document: doc } = setup();
 doc.createElement = tag => doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
 const body = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div'); doc.body.append(body);
 p.renderSkeleton(doc, body);
 const root = body.querySelector('.zs-root');
 for (const cls of ['zs-open-settings', 'zs-search', 'zs-history', 'zs-new-chat', 'zs-clarifications', 'zs-attach', 'zs-model-btn', 'zs-effort-btn', 'zs-send']) {
  const button = root.querySelector('.' + cls); assert.ok(button); assert.equal(button.namespaceURI, 'http://www.w3.org/1999/xhtml');
 }
 assert.equal(root.querySelector('.zs-input').localName, 'textarea'); assert.equal(root.querySelector('.zs-input').namespaceURI, 'http://www.w3.org/1999/xhtml');
 const answer = p.el(doc, 'div'); p.renderMarkdown(doc, answer, '| A | B |\n|---|---|\n| 1 | 2 |');
 assert.equal(answer.querySelector('table').namespaceURI, 'http://www.w3.org/1999/xhtml');
});

test("dedicated reading panel uses a plain neutral appearance even with old colorful preferences", async () => {
 const { plugin: p, prefs, document: doc, a } = setup();
 prefs['extensions.abstractin.appearance'] = JSON.stringify({ style: 'glass', accent: '#4072e5', pattern: 'math', glow: true });
 await p.openReaderPanel(a);
 const root = doc.querySelector('.zs-reader-panel .zs-root');
 assert.equal(root.dataset.style, 'flat'); assert.equal(root.dataset.pattern, 'none');
 assert.equal(root.style.getPropertyValue('--zs-glow-strength'), '0%');
 assert.equal(root.style.getPropertyValue('--zs-accent'), '#666666');
 p.refreshRoot(root); assert.equal(root.dataset.style, 'flat'); assert.equal(root.dataset.pattern, 'none');
});
