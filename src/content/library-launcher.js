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
		async libraryReadingItems(win) {
			const search = new Zotero.Search();
			search.libraryID = win.ZoteroPane.getSelectedLibraryIDs()[0] || Zotero.Libraries.userLibraryID;
			search.addCondition("itemType", "isNot", "attachment");
			search.addCondition("itemType", "isNot", "note");
			const items = await Zotero.Items.getAsync(await search.search());
			await Zotero.Items.loadDataTypes(items, ["itemData"]);
			return items.filter(item => item?.isRegularItem?.() && !item.deleted)
				.sort((a, b) => this.safeField(a, "title").localeCompare(this.safeField(b, "title")));
		},
		async renderLibraryPicker(state) {
			const { win, launcher } = state, doc = win.document;
			const generation = state.pickerGeneration = (state.pickerGeneration || 0) + 1;
			launcher.replaceChildren();
			const header = this.el(doc, "div", "abstractin-library-picker-head");
			header.append(this.el(doc, "h2", null, "Choose documents"),
				this.iconButton(doc, "", "Close AbstractIn", "close", () => this.closeReaderPanel(win)));
			const filter = this.el(doc, "input", "abstractin-library-filter");
			filter.type = "search"; filter.placeholder = "Search by title"; filter.setAttribute("aria-label", "Search documents");
			const list = this.el(doc, "div", "abstractin-library-list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Documents");
			const status = this.el(doc, "p", "abstractin-library-status", "Loading documents…"); status.setAttribute("role", "status");
			const start = this.el(doc, "button", "abstractin-library-start", "Start Reading"); start.type = "button"; start.disabled = true;
			launcher.append(header, filter, list, status, start);
			const selected = state.selectedDocuments ||= new Set();
			const update = () => {
				start.disabled = selected.size !== 1;
				status.textContent = selected.size > 1 ? selected.size + " documents selected. Multi-document reading is not available yet. Choose one to start." :
					selected.size === 1 ? "1 document selected." : "Select a document to start reading. You can select multiple documents; reading currently supports one at a time.";
			};
			try {
				const items = await this.libraryReadingItems(win);
				if (state.pickerGeneration !== generation || !launcher.isConnected) return;
				const available = new Set(items.map(item => item.id));
				for (const id of selected) if (!available.has(id)) selected.delete(id);
				const draw = () => {
					list.replaceChildren(); const query = filter.value.trim().toLocaleLowerCase();
					const matches = items.filter(item => !query || this.safeField(item, "title").toLocaleLowerCase().includes(query));
					for (const item of matches.slice(0, 100)) {
						const row = this.el(doc, "label", "abstractin-library-item");
						const checkbox = this.el(doc, "input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(item.id);
						checkbox.dataset.itemId = item.id;
						checkbox.addEventListener("change", () => { checkbox.checked ? selected.add(item.id) : selected.delete(item.id); update(); });
						row.append(checkbox, this.el(doc, "span", null, this.safeField(item, "title") || "Untitled")); list.append(row);
					}
					if (!matches.length) list.append(this.el(doc, "p", null, "No matching documents."));
					else if (matches.length > 100) list.append(this.el(doc, "p", null, "Showing the first 100 matches. Search to narrow the list."));
				};
				filter.addEventListener("input", draw); draw(); update();
				start.addEventListener("click", async () => {
					if (selected.size !== 1 || start.disabled) return;
					start.disabled = true; filter.disabled = true;
					list.querySelectorAll("input").forEach(input => { input.disabled = true; });
					status.textContent = "Opening document…";
					try { await this.startLibraryReading(win, items.find(item => selected.has(item.id))); }
					catch (error) { status.textContent = error.message || String(error); }
					finally { start.disabled = selected.size !== 1; filter.disabled = false; list.querySelectorAll("input").forEach(input => { input.disabled = false; }); }
				});
			}
			catch (error) { if (state.pickerGeneration === generation) status.textContent = "Could not load documents: " + (error.message || error); }
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
