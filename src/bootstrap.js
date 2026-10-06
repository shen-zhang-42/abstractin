var Zusia;
var chromeHandle;

function log(msg) {
	Zotero.debug("[abstractin] " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting up, rootURI=" + rootURI);

	// Give each startup its own resource address so Gecko cannot reuse artwork,
	// scripts or styles cached from the previously installed XPI.
	let resourcePackage = "abstractin-" + version.replace(/[^a-z0-9-]/gi, "-").toLowerCase() + "-" + Date.now();
	let aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
	chromeHandle = aomStartup.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
		["content", "abstractin", "./"],
		["content", resourcePackage, "./"],
	]);
	let resourceURI = "chrome://" + resourcePackage + "/content/";
	Services.scriptloader.loadSubScript(resourceURI + "content/zusia.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading-workflow.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reader-panel.js");
	Zusia.init({ id, version, rootURI, resourceURI });
	// Load the bundled renderer immediately, before any answer needs it.
	Zusia.getKatex();
	// The settings pane runs in the Settings window and reaches the plugin through Zotero.
	Zotero.AbstractIn = Zusia;
	Zusia.addToAllWindows();
	Zusia.registerPaneSection();
	// Zotero removes the reader listeners itself when the plugin shuts down.
	Zusia.registerReaderHooks();
	// Installing/enabling while PDFs are open need not rerender their toolbar.
	Zusia.restoreReaderToolbarEntries();
	Zusia.watchPrefs();
	await Zusia.registerPrefsPane();

	log("Startup complete");
}

function onMainWindowLoad({ window }) {
	Zusia.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	Zusia.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	if (!Zusia) {
		chromeHandle?.destruct();
		chromeHandle = null;
		return;
	}
	Zusia.unwatchPrefs();
	Zusia.stopReadingPositionTracking();
	Zusia.removeAllReaderPanels();
	Zusia.unregisterPaneSection();
	Zusia.removeFromAllWindows();
	delete Zotero.AbstractIn;
	Zusia = undefined;
	chromeHandle?.destruct();
	chromeHandle = null;
}

function uninstall() {
	log("Uninstalled");
}
