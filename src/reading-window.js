"use strict";
window.addEventListener("load", () => {
 const { layoutID, groupID } = window.arguments[0];
 const plugin = Zotero.AbstractIn, layout = plugin._readingLayouts.get(layoutID);
 if (!layout) { window.close(); return; }
 plugin.mountReadingGroup(layout, groupID, window).catch(error => {
  window.document.getElementById("abstractin-floating-root").textContent = error.message || String(error);
 });
}, { once: true });
