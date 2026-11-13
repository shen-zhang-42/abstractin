"use strict";
(() => {
 const startLibraryReading = AbstractIn.startLibraryReading, removeFromWindow = AbstractIn.removeFromWindow;
 Object.assign(AbstractIn, {
  _readingLayoutMenus: new Map(), _pendingReadingLayouts: new Map(),
  READING_LAYOUTS: [
   { id: "reading", title: "Read literature", description: "Native reader and reading discussion", boxes: [[0,0,96,66,"PDF",true],[100,0,76,66,"Read"]] },
   { id: "stacked", title: "Four panels", description: "Full-height note, discussions stacked", boxes: [[0,0,65,66,"PDF",true],[69,0,52,66,"Note"],[125,0,51,31,"Read"],[125,35,51,31,"Chat"]] },
   { id: "columns", title: "Four columns", description: "Reader, reading discussion, note and note discussion", boxes: [[0,0,56,66,"PDF",true],[60,0,35,66,"Read"],[99,0,43,66,"Note"],[146,0,30,66,"Chat"]] },
   { id: "separate", title: "Separate note window", description: "Note and its discussion float together", boxes: [[0,0,54,66,"PDF",true],[58,0,40,66,"Read"],[108,7,33,52,"Note"],[145,7,31,52,"Chat"]] }
  ],
  readingLayoutDiagram(doc, preset) {
   const ns = "http://www.w3.org/2000/svg", svg = doc.createElementNS(ns, "svg");
   svg.setAttribute("viewBox", "0 0 180 70"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", preset.description);
   svg.classList.add("abstractin-layout-diagram");
   for (const [x,y,width,height,label,reader] of preset.boxes) {
    const rect = doc.createElementNS(ns, "rect");
    for (const [key,value] of Object.entries({ x:x+1, y:y+1, width, height, rx:3 })) rect.setAttribute(key, value);
    rect.setAttribute("class", reader ? "abstractin-layout-reader-box" : "abstractin-layout-plugin-box");
    const text = doc.createElementNS(ns, "text"); text.setAttribute("x", x + width/2 + 1); text.setAttribute("y", y + height/2 + 4); text.textContent = label;
    svg.append(rect, text);
   }
   return svg;
  },
  closeReadingLayoutMenu(win) { this._readingLayoutMenus.get(win)?.close(); },
  openReadingLayoutMenu(win, anchor, { reader = null, layout = null } = {}) {
   const existing = this._readingLayoutMenus.get(win);
   if (existing) { const same = existing.anchor === anchor; existing.close(); if (same) return; }
   const doc = win.document, menu = this.el(doc, "section", "abstractin-menu abstractin-layout-launch-menu");
   menu.id = "abstractin-workspace-menu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Choose a reading layout");
   const heading = this.el(doc, "div", "abstractin-layout-menu-heading", "Choose layout"), legend = this.el(doc, "div", "abstractin-layout-menu-legend", "Blue: Zotero reader · Gray: plugin panels");
   menu.append(heading, legend);
   const close = () => { menu.remove(); anchor.setAttribute("aria-expanded", "false"); doc.removeEventListener("mousedown", outside, true); doc.removeEventListener("keydown", keyboard, true); win.removeEventListener("unload", close); this._readingLayoutMenus.delete(win); };
   const outside = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) close(); };
   const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); close(); anchor.focus(); return; }
    if (event.key === "Tab") { close(); return; }
    if (!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
    event.preventDefault(); const items = [...menu.querySelectorAll("button")], index = items.indexOf(doc.activeElement);
    items[event.key === "Home" ? 0 : event.key === "End" ? items.length-1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
   };
   for (const preset of this.READING_LAYOUTS) {
    const button = this.el(doc, "button", "abstractin-menu-item abstractin-layout-choice"); button.type = "button"; button.dataset.layout = preset.id; button.setAttribute("role", "menuitem");
    const label = this.el(doc, "span", "abstractin-menu-text"); label.append(this.el(doc, "span", "abstractin-menu-label", preset.title), this.el(doc, "span", "abstractin-menu-desc", preset.description));
    button.append(this.readingLayoutDiagram(doc, preset), label);
    button.onclick = () => {
     close();
     (layout ? this.applyReadingLayoutPreset(layout, preset.id) : this.startReadingLayout(win, preset.id, reader))
      .catch(error => Zotero.alert(win, "AbstractIn", error.message || String(error)));
    };
    menu.append(button);
   }
   (doc.body || doc.documentElement).append(menu);
   const rect = anchor.getBoundingClientRect(), width = Math.min(460, win.innerWidth - 24);
   Object.assign(menu.style, { width: width + "px", left: Math.max(12, Math.min(rect.right - width, win.innerWidth - width - 12)) + "px", top: Math.max(8, Math.min(rect.bottom + 5, win.innerHeight - menu.offsetHeight - 12)) + "px" });
   anchor.setAttribute("aria-expanded", "true"); this._readingLayoutMenus.set(win, { anchor, close });
   doc.addEventListener("mousedown", outside, true); doc.addEventListener("keydown", keyboard, true); win.addEventListener("unload", close, { once: true });
   menu.querySelector('button[data-layout="reading"]').focus();
  },
  async startReadingLayout(win, preset, reader = null) {
   if (!this.READING_LAYOUTS.some(value => value.id === preset)) throw new Error("Unknown reading layout.");
   reader ||= win.Zotero_Tabs?.selectedType === "reader" && Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
   if (!reader) { this._pendingReadingLayouts.set(win, preset); await this.openLibraryLauncher(win); return; }
   let layout = this._readingLayoutReaders.get(reader.itemID);
   await this.openReaderPanel(reader);
   if (layout) { await this.applyReadingLayoutPreset(layout, preset); return; }
   // Reading-only uses the same shell and discussion header as every preset.
   const state = this.readerPanelState(this.readerPanelWindow(reader)), entry = state?.views.get(reader);
   if (!entry) throw new Error("Open the PDF in Zotero before choosing this layout.");
   layout = await this.openReadingLayout(state, entry, reader, null, { restore: false });
   await this.applyReadingLayoutPreset(layout, preset);
  },
  async startLibraryReading(win, item) {
   const reader = await startLibraryReading.call(this, win, item), preset = this._pendingReadingLayouts.get(win);
   if (preset) { this._pendingReadingLayouts.delete(win); await this.startReadingLayout(win, preset, reader); }
   return reader;
  },
  removeFromWindow(win) { this.closeReadingLayoutMenu(win); this._pendingReadingLayouts.delete(win); return removeFromWindow.call(this, win); }
 });
})();
