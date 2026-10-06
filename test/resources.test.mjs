import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { loadPlugin } from "./load-plugin.mjs";

test("startup registers resources before loading scripts and releases them on shutdown", async () => {
	const events = [];
	const rootURI = "jar:file:///C:/Users/User/plugin.xpi!/";
	const plugin = Object.fromEntries(["init", "getKatex", "addToAllWindows", "registerPaneSection", "registerReaderHooks", "restoreReaderToolbarEntries", "watchPrefs", "registerPrefsPane", "unwatchPrefs", "stopReadingPositionTracking", "removeAllReaderPanels", "unregisterPaneSection", "removeFromAllWindows"].map(name => [name, arg => { events.push({ name, arg }); return true; }]));
	const scope = {
		Zotero: { debug() {} },
		Cc: { "@mozilla.org/addons/addon-manager-startup;1": { getService: () => ({ registerChrome: (uri, entries) => {
			events.push({ name: "register", uri, entries }); return { destruct: () => events.push({ name: "destruct" }) };
		} }) } },
		Ci: { amIAddonManagerStartup: {} },
		Services: { io: { newURI: uri => uri }, scriptloader: { loadSubScript: url => { events.push({ name: "load", url }); scope.Zusia = plugin; } } },
	};
	runInNewContext(readFileSync(new URL("../src/bootstrap.js", import.meta.url), "utf8"), scope);
	await scope.startup({ id: "abstractin@test", version: "test", rootURI });
	assert.equal(events[0].name, "register");
	assert.equal(events[0].uri, rootURI + "manifest.json");
	assert.equal(events[0].entries[0][1], "abstractin");
	const resourcePackage = events[0].entries[1][1];
	assert.match(resourcePackage, /^abstractin-test-\d+$/);
	assert.equal(events.find(e => e.name === "load").url, "chrome://" + resourcePackage + "/content/content/zusia.js");
	assert.equal(events.find(e => e.name === "init").arg.resourceURI, "chrome://" + resourcePackage + "/content/");
	assert.ok(events.findIndex(e => e.name === "getKatex") < events.findIndex(e => e.name === "addToAllWindows"));
	assert.ok(events.findIndex(e => e.name === "registerReaderHooks") < events.findIndex(e => e.name === "restoreReaderToolbarEntries"));
	scope.shutdown();
	assert.equal(events.at(-1).name, "destruct");
});

test("registered resources supply KaTeX, styles and icons while preserving the source directory", () => {
	const { plugin: p } = loadPlugin();
	p.init({ id: "test", version: "test", rootURI: "file:///checkout/src/", resourceURI: "chrome://abstractin/content/" });
	assert.equal(p.rootURI, "file:///checkout/src/");
	assert.equal(p.iconBase, "chrome://abstractin/content/content/icons/");
	assert.ok(p.stylesheetURL.startsWith("chrome://abstractin/content/content/zusia.css"));
	assert.equal(typeof p.getKatex().renderToString, "function");
});

test("toolbar and composer icons load through Zotero resources when iframe fetch cannot access chrome URLs", async () => {
 const { plugin: p, window, document: doc } = loadPlugin();
 p.iconBase = 'chrome://abstractin/content/content/icons/'; p._iconCache.clear();
 let reads = 0;
 window.Zotero.File = { getResourceAsync: async url => { reads++; assert.ok(url.startsWith(p.iconBase)); return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="context-fill" d="M1 1h18v18H1z"/></svg>'; } };
 window.fetch = async () => { throw new Error('Reader fetch is blocked'); };
 const icon = p.svgIcon(doc, 'settings'); doc.body.append(icon);
 await p.loadIcon(doc, 'settings'); await Promise.resolve();
 assert.equal(reads, 1); assert.ok(icon.querySelector('svg')); assert.equal(icon.querySelector('path').getAttribute('fill'), 'currentColor');
});


test("marmoset artwork renders in the header and empty chat even when resource reads fail", () => {
 const { plugin: p, window, document: doc } = loadPlugin({ prefs: { "extensions.abstractin.onboarded": true } });
 p.iconBase = "chrome://abstractin/content/content/icons/";
 window.Zotero.File = { getResourceAsync: async () => { throw new Error("Resource unavailable"); } };
 window.fetch = async () => { throw new Error("Iframe fetch blocked"); };
 const body = doc.createElement("div"); doc.body.append(body);
 p.renderSkeleton(doc, body);
 const root = body.querySelector(".zs-root");
 p.renderEmptyState({ doc, root, logEl: root.querySelector(".zs-log"), ctx: { dir: "/tmp/reading" } });
 const avatar = root.querySelector(".zs-header-icon svg");
 const companion = root.querySelector(".zs-empty .zs-mascot svg");
 assert.equal(avatar?.namespaceURI, "http://www.w3.org/2000/svg");
 assert.equal(companion?.namespaceURI, "http://www.w3.org/2000/svg");
 assert.equal(avatar.getAttribute("stroke"), "#808088");
 for (const size of [16, 20]) {
  const native = p.parseIcon(doc, readFileSync(new URL("../src/icons/icon" + size + ".svg", import.meta.url), "utf8"));
  assert.ok(native.isEqualNode(avatar), "native app entry matches the chat avatar");
 }
 assert.ok(companion.querySelectorAll("path").length > 10);
 for (const [name, artwork] of Object.entries(p.BRAND_ICONS)) {
  assert.equal(artwork, readFileSync(new URL("../src/content/icons/" + p.ICON_FILES[name], import.meta.url), "utf8").trim());
 }
});
