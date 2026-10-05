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

test("metadata section remains in the library and acts as a fallback for unknown reader layouts", () => {
	const { plugin: p, document: doc, window: win } = setup();
	let options;
	win.Zotero.ItemPaneManager = { registerSection(value) { options = value; return "abstractin-section"; } };
	p.registerPaneSection();
	let enabled;
	const item = { isRegularItem: () => true };
	const setEnabled = value => { enabled = value; };
	options.onItemChange({ item, doc, tabType: "reader", setEnabled });
	assert.equal(enabled, false);
	options.onItemChange({ item, doc, tabType: "library", setEnabled });
	assert.equal(enabled, true);
	doc.getElementById("layout").remove();
	options.onItemChange({ item, doc, tabType: "reader", setEnabled });
	assert.equal(enabled, true);
});
