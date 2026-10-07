var AbstractIn;
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
	Services.scriptloader.loadSubScript(resourceURI + "content/abstractin.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/icon-assets.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading-workflow.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reader-panel.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/agents.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/chats.js");
	AbstractIn.init({ id, version, rootURI, resourceURI });
	// Load the bundled renderer immediately, before any answer needs it.
	AbstractIn.getKatex();
	// The settings pane runs in the Settings window and reaches the plugin through Zotero.
	Zotero.AbstractIn = AbstractIn;
	AbstractIn.addToAllWindows();
	AbstractIn.registerPaneSection();
	// Zotero removes the reader listeners itself when the plugin shuts down.
	AbstractIn.registerReaderHooks();
	// Installing/enabling while PDFs are open need not rerender their toolbar.
	AbstractIn.restoreReaderToolbarEntries();
	AbstractIn.watchPrefs();
	await AbstractIn.registerPrefsPane();

	log("Startup complete");
}

function onMainWindowLoad({ window }) {
	AbstractIn.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	AbstractIn.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	if (!AbstractIn) {
		chromeHandle?.destruct();
		chromeHandle = null;
		return;
	}
	AbstractIn.unwatchPrefs();
	AbstractIn.stopReadingPositionTracking();
	AbstractIn.removeAllReaderPanels();
	AbstractIn.unregisterPaneSection();
	AbstractIn.removeFromAllWindows();
	delete Zotero.AbstractIn;
	AbstractIn = undefined;
	chromeHandle?.destruct();
	chromeHandle = null;
}

function uninstall() {
	log("Uninstalled");
}
