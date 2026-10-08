"use strict";

// The toolbar entry uses Zotero's public Reader API. Keep the native-window
// layout adapter here, separate from reading, storage and model transport.
Object.assign(AbstractIn, {
	_readerPanelWindows: new Map(),
	_readerToolbarButtons: new Map(),
	_readerToolbarObservers: new Map(),
	_readerToolbarGeneration: 0,

	readerPanelNodeAlive(node) {
		// Even reading isConnected throws on Gecko wrappers from destroyed windows.
		try { return !!node?.isConnected && !node.ownerDocument?.defaultView?.closed; }
		catch (_) { return false; }
	},

	cleanupReaderPanelResource(callback) {
		try { callback(); }
		catch (e) { this.logError("reader panel cleanup", e); }
	},

	async restoreReaderToolbarEntries() {
		let generation = this._readerToolbarGeneration;
		await Promise.all((Zotero.Reader?._readers || []).map(async reader => {
			try {
				if (reader._initPromise) await reader._initPromise;
				if (generation !== this._readerToolbarGeneration) return;
				if (reader.type !== "pdf") return;
				let doc = reader._iframeWindow?.document;
				if (!doc) return;
				let restore = () => {
					let button = this._readerToolbarButtons.get(this.readerPanelWindow(reader))?.get(reader);
					if (this.readerPanelNodeAlive(button)) return true;
					let end = doc.querySelector(".toolbar .end");
					if (!end) return false;
					this.renderReaderToolbar({ reader, doc, append: node => end.insertBefore(node, end.firstChild) });
					this.log("Restored AbstractIn toolbar entry for attachment " + reader.itemID);
					return true;
				};
				if (!restore() && !this._readerToolbarObservers.has(reader)) {
					let observer = new doc.defaultView.MutationObserver(() => {
						if (restore()) { observer.disconnect(); this._readerToolbarObservers.delete(reader); }
					});
					observer.observe(doc.documentElement, { childList: true, subtree: true });
					this._readerToolbarObservers.set(reader, observer);
				}
			}
			catch (e) { this.logError("restore reader toolbar", e); }
		}));
	},

	renderReaderPanelLauncher(doc, body, item) {
		let ctx = { paperItem: item?.parentItem || item, attachmentItem: item };
		let reader = this.readerFor(ctx, doc.defaultView);
		if (!reader || !this.readerPanelMount(doc)) return false;
		body.textContent = "";
		let button = this.el(doc, "button", "abstractin-reading-tool", "Open AbstractIn panel");
		button.type = "button";
		button.addEventListener("click", () => this.openReaderPanel(reader).catch(e => {
			this.logError("reader panel launcher", e);
			body.append(this.el(doc, "p", "abstractin-notice", e.message || String(e)));
		}));
		body.append(button);
		return true;
	},

	readerPanelWindow(reader) {
		return reader._window || Zotero.getMainWindow();
	},

	readerPanelMount(doc) {
		let context = doc.getElementById("zotero-context-pane");
		let splitter = doc.getElementById("zotero-context-splitter");
		if (context && splitter?.parentElement === context.parentElement) {
			return { parent: context.parentElement, before: splitter, context };
		}
		// Detached reader windows have a reader vbox, without the main tab deck.
		let reader = doc.getElementById("zotero-reader");
		if (reader?.parentElement && doc.getElementById("reader")) {
			return { parent: reader.parentElement, before: reader.nextSibling, context: null };
		}
		return null;
	},

	renderReaderToolbar({ reader, doc, append }) {
		if (reader.type !== "pdf") return;
		let win = this.readerPanelWindow(reader);
		let buttons = this._readerToolbarButtons.get(win);
		if (!buttons) { buttons = new Map(); this._readerToolbarButtons.set(win, buttons); }
		let old = buttons.get(reader);
		if (this.readerPanelNodeAlive(old)) old.remove();
		let button = this.el(doc, "button", "toolbar-button abstractin-reader-toggle");
		button.type = "button";
		button.title = "Toggle AbstractIn panel";
		button.setAttribute("aria-label", button.title);
		button.setAttribute("aria-controls", "abstractin-reader-panel");
		button.setAttribute("data-tabstop", "1");
		button.tabIndex = -1;
		button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;align-self:center;line-height:normal;gap:4px;width:auto;min-width:32px;min-height:28px;padding:4px 6px;color:inherit;";
		let icon = this.svgIcon(doc, "app");
		icon.style.cssText = "display:block;width:20px;height:20px;";
		// The reader toolbar is in its own document without the chat stylesheet.
		this.loadIcon(doc, "app").then(() => {
			if (!this.readerPanelNodeAlive(icon)) return;
			let svg = icon.querySelector("svg");
			if (!svg) icon.style.display = "none";
			if (svg) {
				svg.style.cssText = "display:block;width:20px;height:20px;";
				for (let layer of svg.querySelectorAll(".abstractin-duo")) layer.style.opacity = "0.2";
			}
		}).catch(e => this.logError("reader toolbar icon", e));
		button.append(icon, this.el(doc, "span", null, "AbstractIn"));
		button.addEventListener("click", () => {
			this.openReaderPanel(reader, { toggle: true }).catch(e => {
				this.logError("openReaderPanel", e);
				button.title = "AbstractIn: " + (e.message || e);
				if (Zotero.alert) Zotero.alert(win, "AbstractIn", e.message || String(e));
			});
		});
		buttons.set(reader, button);
		append(button);
		this.updateReaderPanelButtons(win);
	},

	updateReaderPanelButtons(win) {
		let state = this._readerPanelWindows.get(win);
		for (let [reader, button] of this._readerToolbarButtons.get(win) || []) {
			if (!this.readerPanelNodeAlive(button)) { this._readerToolbarButtons.get(win)?.delete(reader); continue; }
			let active = !!state?.active && state.reader === reader;
			button.setAttribute("aria-pressed", String(active));
			button.classList.toggle("active", active);
		}
	},

	createReaderPanel(win) {
		let doc = win.document;
		let mount = this.readerPanelMount(doc);
		if (!mount) throw new Error("This Zotero reader layout does not expose a supported side-panel mount. Use the AbstractIn item section or open the PDF in a main-window tab.");
		this.addToWindow(win);
		let splitter = doc.createXULElement("splitter");
		splitter.classList.add("abstractin-reader-splitter");
		for (let [name, value] of Object.entries({ orient: "horizontal", resizebefore: "flex", resizeafter: "closest", collapse: "after", state: "open" })) splitter.setAttribute(name, value);
		let panel = this.el(doc, "section", "abstractin-reader-panel");
		panel.id = "abstractin-reader-panel";
		panel.setAttribute("role", "complementary");
		panel.setAttribute("aria-label", "AbstractIn reading assistant");
		let width = Number(this.getPref("readerPanelWidth"));
		panel.style.width = (Number.isFinite(width) && width >= 280 ? Math.min(width, 720) : 380) + "px";
		panel.setAttribute("width", parseInt(panel.style.width, 10));
		panel.hidden = true; splitter.hidden = true;
		mount.parent.insertBefore(splitter, mount.before);
		mount.parent.insertBefore(panel, mount.before);
		let state = { win, panel, splitter, views: new Map(), active: false, reader: null, contextWasOpen: false };
		this._readerPanelWindows.set(win, state);
		state.observer = new win.MutationObserver(() => {
			// Native XUL splitters resize their next sibling through a width
			// attribute. HTML sections need that value reflected into CSS.
			let width = Number(panel.getAttribute("width"));
			if (width >= 280 && panel.style.width !== Math.min(width, 720) + "px") panel.style.width = Math.min(width, 720) + "px";
			if (!state.active) return;
			if (splitter.getAttribute("state") === "collapsed") this.closeReaderPanel(win);
			else if (mount.context && win.ZoteroContextPane?.collapsed === false) this.closeReaderPanel(win, { restoreContext: false });
		});
		if (mount.context) state.observer.observe(mount.context, { attributes: true, attributeFilter: ["collapsed"] });
		state.observer.observe(splitter, { attributes: true, attributeFilter: ["state"] });
		state.observer.observe(panel, { attributes: true, attributeFilter: ["width"] });
		if (win.ResizeObserver) {
			state.resize = new win.ResizeObserver(entries => {
				let width = Math.round(entries[0].contentRect.width);
				if (state.active && width >= 280) this.setPref("readerPanelWidth", Math.min(width, 720));
			});
			state.resize.observe(panel);
		}
		state.notifier = Zotero.Notifier.registerObserver({ notify: async (action, type, ids, extraData) => {
			if (type !== "tab") return;
			if (action === "close") {
				for (let [reader, entry] of state.views) {
					if (ids.includes(reader.tabID)) {
						this.releaseReaderPanelView(state, reader, entry);
						if (state.reader === reader) this.closeReaderPanel(win, { restoreContext: false });
					}
				}
			}
			if (!state.active || !["select", "load"].includes(action)) return;
			let tabs = win.Zotero_Tabs;
			if (!tabs || !ids.includes(tabs.selectedID)) return;
			let tabType = extraData?.[tabs.selectedID]?.type || tabs.selectedType;
			if (tabType !== "reader") { this.closeReaderPanel(win, { restoreContext: false }); return; }
			let reader = Zotero.Reader.getByTabID(tabs.selectedID);
			if (reader?.type === "pdf") await this.openReaderPanel(reader);
			else if (!reader) {
				// Selecting an unloaded PDF precedes its Reader instance. Hide the old
				// attachment immediately and resume on the subsequent load event.
				state.reader = null;
				for (let entry of state.views.values()) entry.body.hidden = true;
				if (!state.panel.querySelector(".abstractin-reader-loading")) state.panel.append(this.el(doc, "div", "abstractin-notice abstractin-reader-loading", "Loading selected PDF…"));
				this.updateReaderPanelButtons(win);
			}
			else this.closeReaderPanel(win, { restoreContext: false });
		} }, ["tab"], "abstractinReaderPanel");
		state.unload = () => this.removeReaderPanel(win);
		win.addEventListener("unload", state.unload, { once: true });
		return state;
	},

	async openReaderPanel(reader, { toggle = false } = {}) {
		if (reader.type !== "pdf") throw new Error("Open a PDF to use the AbstractIn reading panel.");
		let win = this.readerPanelWindow(reader);
		let state = this._readerPanelWindows.get(win);
		if (state && (!this.readerPanelNodeAlive(state.panel) || !this.readerPanelNodeAlive(state.splitter))) { this.removeReaderPanel(win); state = null; }
		if (toggle && state?.active && state.reader === reader) { this.closeReaderPanel(win); return; }
		let item = Zotero.Items.get(reader.itemID);
		if (!item) throw new Error("The selected PDF attachment is no longer available.");
		state = state || this.createReaderPanel(win);
		if (!state.active) state.contextWasOpen = win.ZoteroContextPane?.collapsed === false;
		if (win.ZoteroContextPane && this.readerPanelMount(win.document)?.context) win.ZoteroContextPane.collapsed = true;
		state.reader = reader; state.active = true;
		state.panel.querySelector(".abstractin-reader-loading")?.remove();
		state.panel.hidden = false; state.splitter.hidden = false; state.splitter.setAttribute("state", "open");
		let entry = state.views.get(reader);
		for (let [cachedReader, existing] of state.views) {
			if (!this.readerPanelNodeAlive(existing.body) || !this.readerPanelNodeAlive(existing.root)) {
				this.releaseReaderPanelView(state, cachedReader, existing);
				if (cachedReader === reader) entry = null;
			} else existing.body.hidden = true;
		}
		if (!entry) {
			let body = this.el(win.document, "div", "abstractin-reader-view");
			state.panel.append(body);
			this.renderSkeleton(win.document, body);
			let root = body.querySelector(".abstractin-root");
			root.querySelector(".abstractin-header").append(this.iconButton(win.document, "abstractin-reader-close", "Close AbstractIn panel", "close", () => this.closeReaderPanel(win)));
			entry = { body, root, itemID: item.id };
			state.views.set(reader, entry);
			// renderContent attaches to an existing pending request; never await that
			// request here, so a panel can close or switch while an answer streams.
			entry.render = this.renderContent(win.document, body, item, reader).catch(e => {
				this.logError("reader panel render", e);
				if (!this.readerPanelNodeAlive(root)) return;
				let view = this._views.get(root);
				if (view) this.appendError(view, e.message || String(e));
				else root.querySelector(".abstractin-log").textContent = "AbstractIn could not load this PDF: " + (e.message || e);
			});
		}
		entry.body.hidden = false;
		this.updateReaderPanelButtons(win);
		this.fitWideContent(entry.root);
		let view = this._views.get(entry.root);
		if (view) { this.applyDraft(view); view.input.focus(); }
	},

	closeReaderPanel(win, { restoreContext = true } = {}) {
		let state = this._readerPanelWindows.get(win);
		if (!state?.active) return;
		this.closeReaderPanelState(state, { restoreContext });
		this.updateReaderPanelButtons(win);
	},

	releaseReaderPanelView(state, reader, entry) {
		// Remove registrations before touching any potentially dead DOM wrapper.
		state.views.delete(reader); this._views.delete(entry.root);
		this.cleanupReaderPanelResource(() => entry.root.disposeUI?.());
		this.cleanupReaderPanelResource(() => entry.body.remove());
		const binding = this._positionBindings.get(reader);
		this._positionBindings.delete(reader);
		if (binding) {
			this.cleanupReaderPanelResource(() => (binding.bus.off || binding.bus._off)?.call(binding.bus, "pagechanging", binding.listener));
			this.cleanupReaderPanelResource(() => binding.win.clearTimeout(binding.timer));
		}
		const buttons = this._readerToolbarButtons.get(state.win), button = buttons?.get(reader);
		buttons?.delete(reader);
		if (this.readerPanelNodeAlive(button)) button.remove();
	},

	removeReaderPanel(win) {
		for (let [reader, observer] of this._readerToolbarObservers) {
			this.cleanupReaderPanelResource(() => {
				if (this.readerPanelWindow(reader) === win) {
					this._readerToolbarObservers.delete(reader); observer.disconnect();
				}
			});
		}
		const state = this._readerPanelWindows.get(win);
		this._readerPanelWindows.delete(win);
		if (state) {
			if (this.readerPanelNodeAlive(state.panel)) this.cleanupReaderPanelResource(() => this.closeReaderPanelState(state));
			this.cleanupReaderPanelResource(() => state.observer.disconnect());
			this.cleanupReaderPanelResource(() => state.resize?.disconnect());
			this.cleanupReaderPanelResource(() => Zotero.Notifier.unregisterObserver(state.notifier));
			this.cleanupReaderPanelResource(() => win.removeEventListener("unload", state.unload));
			for (let [reader, entry] of state.views) this.releaseReaderPanelView(state, reader, entry);
			this.cleanupReaderPanelResource(() => state.panel.remove());
			this.cleanupReaderPanelResource(() => state.splitter.remove());
		}
		const buttons = this._readerToolbarButtons.get(win); this._readerToolbarButtons.delete(win);
		for (const button of buttons?.values() || []) if (this.readerPanelNodeAlive(button)) button.remove();
		this.cleanupReaderPanelResource(() => {
			if (!win.closed && !win.ZoteroPane) {
				win.document.getElementById("abstractin-stylesheet")?.remove();
				win.document.querySelector('[href="abstractin.ftl"]')?.remove();
			}
		});
	},

	closeReaderPanelState(state, { restoreContext = true } = {}) {
		if (!state.active) return;
		state.active = false;
		state.panel.hidden = true; state.splitter.hidden = true;
		if (restoreContext && state.contextWasOpen && state.win.ZoteroContextPane) state.win.ZoteroContextPane.collapsed = false;
	},

	removeAllReaderPanels() {
		this._readerToolbarGeneration++;
		for (let observer of this._readerToolbarObservers.values()) observer.disconnect();
		this._readerToolbarObservers.clear();
		for (let win of new Set([...this._readerPanelWindows.keys(), ...this._readerToolbarButtons.keys()])) this.removeReaderPanel(win);
	},
});
