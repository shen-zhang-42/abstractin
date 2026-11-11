"use strict";
window.addEventListener("load", async () => {
 try {
  const args = window.arguments?.[0], plugin = Zotero.AbstractIn;
  if (!plugin) throw new Error("AbstractIn is not ready. Reopen NoteOut from Zotero.");
  if (args?.homeKey != null) {
   const home = plugin._noteOutHomes.get(String(args.homeKey)); if (!home) throw new Error("The notes workspace is unavailable.");
   await plugin.mountNoteOutHome(window, home);
  } else {
   const state = plugin._markdownNoteWindows.get(args?.noteKey); if (!state) throw new Error("The note workspace is unavailable.");
   await plugin.mountMarkdownNote(window, state);
  }
 } catch (error) {
  const message = window.document.createElement("p"); message.textContent = "Could not open the note: " + (error.message || error);
  window.document.getElementById("abstractin-note-root").append(message);
 }
}, { once: true });
