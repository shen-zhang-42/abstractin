"use strict";

// The shared title-bar entry opens the existing reader or a document chooser.
(() => {
	const addWindow = AbstractIn.addToWindow, removeWindow = AbstractIn.removeFromWindow;
	Object.assign(AbstractIn, {
		addToWindow(win) {
			addWindow.call(this, win);
			this.mountLibraryLauncher(win);
		},
		removeFromWindow(win) {
			win.document.getElementById("abstractin-main-toggle")?.remove();
			win.document.getElementById("abstractin-main-separator")?.remove();
			removeWindow.call(this, win);
		},
		mountLibraryLauncher(win) {
			const doc = win.document, anchor = doc.getElementById("zotero-tb-tabs-menu");
			if (!anchor) return false;
			if (doc.getElementById("abstractin-main-toggle")) return true;
			const button = this.iconButton(doc, "abstractin-main-toggle zotero-tb-button", "Open AbstractIn", "app", () => {
				this.openLibraryLauncher(win).catch(error => {
					this.logError("document chooser", error);
					Zotero.alert(win, "AbstractIn", error.message || String(error));
				});
			});
			button.id = "abstractin-main-toggle";
			button.setAttribute("aria-controls", "abstractin-reader-panel");
			button.setAttribute("aria-expanded", "false");
			const separator = this.el(doc, "div", "zotero-tb-separator abstractin-main-separator");
			separator.id = "abstractin-main-separator";
			separator.setAttribute("role", "separator"); separator.setAttribute("aria-orientation", "vertical");
			anchor.before(button, separator);
			return true;
		},
		async openLibraryLauncher(win) {
			const tabs = win.Zotero_Tabs;
			const reader = tabs?.selectedType === "reader" && Zotero.Reader.getByTabID(tabs.selectedID);
			if (reader) return this.openReaderPanel(reader, { toggle: true });
			let state = this.readerPanelState(win);
			if (state?.active && state.launcher && !state.launcher.hidden) return this.closeReaderPanel(state.win);
			if (state && !this.readerPanelNodeAlive(state.panel)) { this.removeReaderPanel(state.win); state = null; }
			state ||= this.createReaderPanel(win);
			if (!state.active) state.contextWasOpen = win.ZoteroContextPane?.collapsed === false;
			if (win.ZoteroContextPane) win.ZoteroContextPane.collapsed = true;
			for (const entry of state.views.values()) entry.body.hidden = true;
			state.reader = null; state.active = true;
			state.panel.hidden = false; state.splitter.hidden = false; state.splitter.setAttribute("state", "open");
			if (!state.launcher) {
				state.launcher = this.el(win.document, "div", "abstractin-library-picker");
				state.panel.append(state.launcher);
			}
			state.launcher.hidden = false;
			this.updateReaderPanelButtons(win);
			await this.renderLibraryPicker(state);
		},
		async renderLibraryPicker(state) {
			const { win, launcher } = state, doc = win.document;
			launcher.replaceChildren();
			const header = this.el(doc, "div", "abstractin-library-picker-head");
			header.append(this.el(doc, "h2", null, "Reading companion"),
				this.iconButton(doc, "", "Close AbstractIn", "close", () => this.closeReaderPanel(win)));
			const welcome = this.el(doc, "div", "abstractin-library-welcome");
			welcome.append(this.svgIcon(doc, this.MASCOTS[this.getAppearance().mascot].icon, "abstractin-mascot"),
				this.el(doc, "h3", null, "Read with " + this.companionName()),
				this.el(doc, "p", null, "Select books or papers in the document list on the left, then click Add selected documents."));
			const add = this.el(doc, "button", "abstractin-library-add", "Add selected documents"); add.type = "button";
			const list = this.el(doc, "div", "abstractin-library-list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Documents");
			const status = this.el(doc, "p", "abstractin-library-status"); status.setAttribute("role", "status");
			const start = this.el(doc, "button", "abstractin-library-start", "Start Reading"); start.type = "button"; start.disabled = true;
			launcher.append(header, welcome, add, list, status, start);
			const selected = state.readingDocuments ||= new Map();
			let busy = false;
			const draw = () => {
				list.replaceChildren();
				for (const [id, item] of selected) {
					if (item.deleted) { selected.delete(id); continue; }
					const row = this.el(doc, "div", "abstractin-library-item"); row.dataset.itemId = id;
					const title = this.safeField(item, "title") || "Untitled";
					row.append(this.el(doc, "span", null, title), this.iconButton(doc, "", "Remove " + title, "close", () => {
						if (!busy) { selected.delete(id); draw(); }
					})); list.append(row);
				}
				start.disabled = selected.size !== 1;
				status.textContent = selected.size > 1 ? selected.size + " documents added. Multi-document reading is not available yet. Keep one to start." :
					selected.size === 1 ? "1 document added. Ready to read." : "No documents added yet.";
			};
			add.addEventListener("click", async () => {
				if (busy) return;
				busy = true; add.disabled = true; start.disabled = true;
				try {
					const items = new Map();
					for (let item of win.ZoteroPane.itemsView?.getSelectedItems() || []) {
						if (item.deleted) continue;
						if ((item.isAttachment?.() || item.isNote?.()) && item.parentID) item = await Zotero.Items.getAsync(item.parentID);
						if (item?.isRegularItem?.() && !item.deleted) items.set(item.id, item);
					}
					await Zotero.Items.loadDataTypes([...items.values()], ["itemData"]);
					for (const [id, item] of items) selected.set(id, item);
					draw();
					if (!items.size) status.textContent = "Select a book or paper in the document list on the left first.";
				}
				catch (error) { status.textContent = "Could not add documents: " + (error.message || error); }
				finally { busy = false; add.disabled = false; start.disabled = selected.size !== 1; }
			});
			start.addEventListener("click", async () => {
				if (selected.size !== 1 || busy) return;
				busy = true; start.disabled = true; add.disabled = true;
				status.textContent = "Opening document…";
				try { await this.startLibraryReading(win, selected.values().next().value); }
				catch (error) { status.textContent = error.message || String(error); }
				finally { busy = false; start.disabled = selected.size !== 1; add.disabled = false; }
			});
			draw();
		},
		async startLibraryReading(win, item) {
			if (!item?.isRegularItem?.() || item.deleted) throw new Error("Choose a document to read.");
			// Load the owned notes before the existing recovery code reads their tags.
			await Zotero.Items.loadDataTypes([item], ["childItems"]);
			const notes = await Zotero.Items.getAsync(item.getNotes?.() || []);
			await Zotero.Items.loadDataTypes(notes, ["tags", "note"]);
			let ctx = await this.getContext(item);
			const attachment = ctx?.attachmentItem;
			if (!attachment?.isPDFAttachment?.()) throw new Error("Attach a PDF to this document before starting reading.");
			if (!ctx.reading && notes.some(note => this.noteInMetadata(note, item))) {
				const type = this.readingType(item);
				if (type) {
					this._readingStates.set(attachment.id, { type, title: this.safeField(item, "title"), goal: "" });
					ctx = await this.getContext(attachment);
				}
			}
			let reader = await Zotero.Reader.open(attachment.id, null, { openInWindow: false });
			// Zotero selects an unloaded existing tab and returns before creating its Reader.
			if (!reader) {
				const tabID = win.Zotero_Tabs.getTabIDByItemID(attachment.id);
				for (let i = 0; i < 200 && !reader; i++) {
					reader = Zotero.Reader.getByTabID(tabID);
					if (!reader) await new Promise(resolve => win.setTimeout(resolve, 50));
				}
			}
			if (!reader) throw new Error("The PDF tab could not be loaded. Try Start Reading again.");
			if (reader._initPromise) await reader._initPromise;
			await this.openReaderPanel(reader);
			const entry = this.readerPanelState(this.readerPanelWindow(reader))?.views.get(reader);
			if (entry?.render) await entry.render;
			const view = entry && this._views.get(entry.root);
			if (view && !view.ctx.reading && !this.needsAgentSetup()) await this.openReadingSetup(view.root);
			return reader;
		},
	});
})();
