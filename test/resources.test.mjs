import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { loadPlugin } from "./load-plugin.mjs";

test("startup registers resources before loading scripts and releases them on shutdown", async () => {
	const events = [];
	const rootURI = "jar:file:///C:/Users/User/plugin.xpi!/";
	const plugin = Object.fromEntries(["init", "getKatex", "addToAllWindows", "registerPaneSection", "registerReaderHooks", "watchPrefs", "registerPrefsPane", "unwatchPrefs", "stopReadingPositionTracking", "unregisterPaneSection", "removeFromAllWindows"].map(name => [name, arg => { events.push({ name, arg }); return true; }]));
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
	assert.equal(events.find(e => e.name === "load").url, "chrome://abstractin/content/content/zusia.js");
	assert.equal(events.find(e => e.name === "init").arg.resourceURI, "chrome://abstractin/content/");
	assert.ok(events.findIndex(e => e.name === "getKatex") < events.findIndex(e => e.name === "addToAllWindows"));
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
