"use strict";
window.addEventListener("load", async () => {
 try {
  const plugin = Zotero.AbstractIn, state = plugin?._chatWindows.get(window.arguments?.[0]?.chatWindowID);
  if (!state) throw new Error("The discussion is unavailable. Open a new chat window from AbstractIn.");
  await plugin.mountChatWindow(state, window);
 } catch (error) { window.document.getElementById("abstractin-chat-window-root").textContent = error.message || String(error); }
}, { once: true });
