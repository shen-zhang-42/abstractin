var AbstractIn;
var chromeHandle;
var noteResourcePackage;

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
	// Vditor must run with a content principal. In chrome documents Gecko strips
	// native toolbar buttons from innerHTML before the editor can initialize.
	const resources = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
	resources.setSubstitutionWithFlags(resourcePackage, Services.io.newURI(rootURI), resources.ALLOW_CONTENT_ACCESS);
	noteResourcePackage = resourcePackage;
	Services.scriptloader.loadSubScript(resourceURI + "content/abstractin.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/composer-math.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/icon-assets.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading-workflow.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/source-images.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/paper-guide.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reader-panel.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/library-launcher.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/agents.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/cli-adapters.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/api-agents.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/api-providers.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/api-provider-setup.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/agent-setup.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/chats.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/chat-tools.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/history-browser.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading-export.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/notein.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/note-storage.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/note-editor.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading-layout.js");
	Services.scriptloader.loadSubScript(resourceURI + "content/reading-layout-menu.js");
	AbstractIn.init({ id, version, rootURI, resourceURI });
	AbstractIn.noteEditorURI = "resource://" + resourcePackage + "/";
	AbstractIn.noteEditorBridge = Components.utils;
	// Load the bundled renderer immediately, before any answer needs it.
	AbstractIn.getKatex();
	// The settings pane runs in the Settings window and reaches the plugin through Zotero.
	Zotero.AbstractIn = AbstractIn;
	AbstractIn.addToAllWindows();
	// Keep explicit listener ownership across plugin updates and shutdown.
	AbstractIn.registerReaderHooks();
	// Installing/enabling while PDFs are open need not rerender their toolbar.
	AbstractIn.restoreReaderToolbarEntries();
	AbstractIn.watchPrefs();
	await AbstractIn.registerPrefsPane();
	AbstractIn.startNoteIn();

	log("Startup complete");
}

function onMainWindowLoad({ window }) {
	AbstractIn.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	AbstractIn.removeFromWindow(window);
}

async function shutdown() {
	log("Shutting down");
	if (!AbstractIn) {
		chromeHandle?.destruct();
		chromeHandle = null;
		if (noteResourcePackage) Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(noteResourcePackage, null);
		noteResourcePackage = null;
		return;
	}
	AbstractIn.unregisterReaderHooks();
	await AbstractIn.closeMarkdownNoteWindows();
	AbstractIn.closeSettings();
	AbstractIn.stopNoteIn();
	AbstractIn.unwatchPrefs();
	AbstractIn.stopReadingPositionTracking();
	AbstractIn.removeAllReaderPanels();
	AbstractIn.removeFromAllWindows();
	delete Zotero.AbstractIn;
	AbstractIn = undefined;
	chromeHandle?.destruct();
	chromeHandle = null;
	if (noteResourcePackage) Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(noteResourcePackage, null);
	noteResourcePackage = null;
}

function uninstall() {
	log("Uninstalled");
}
