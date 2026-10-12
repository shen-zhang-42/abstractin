// Zotero 9's standalone settings window shares the native pane's renderer
// and preference storage. Resolve the current plugin only after window load.
window.addEventListener("load", () => {
	const plugin = Zotero.AbstractIn;
	const stylesheet = document.createElement("link");
	stylesheet.rel = "stylesheet";
	stylesheet.href = plugin.stylesheetURL;
	document.head.appendChild(stylesheet);
	plugin.renderPrefsPane(document, document.getElementById("abstractin-prefs-root"));
}, { once: true });
