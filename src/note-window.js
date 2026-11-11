"use strict";
window.addEventListener("load", () => {
 const { plugin, state } = window.arguments[0];
 plugin.mountMarkdownNote(window, state).catch(error => {
  const message = window.document.createElement("p"); message.textContent = "Could not open the note: " + (error.message || error);
  window.document.getElementById("abstractin-note-root").append(message);
 });
}, { once: true });
