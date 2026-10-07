"use strict";

Object.assign(AbstractIn, {
	_chatContexts: new Map(),
	_chatArchiveImports: new Set(),

	registerChatContext(ctx) {
		if (ctx?.paperItem && ctx.dir) this._chatContexts.set(ctx.dir, ctx);
		return ctx;
	},

	chatSyncID() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); },

	chatDeviceID() {
		let id = this.getPref("chatDeviceID");
		if (!id) { id = this.chatSyncID(); this.setPref("chatDeviceID", id); }
		return id;
	},

	async chatSyncState(dir) {
		try { return JSON.parse(await Zotero.File.getContentsAsync(OS.Path.join(dir, "chat-sync.json"))); }
		catch (e) { return null; }
	},

	async writeChatSyncState(dir, state) {
		await Zotero.File.putContentsAsync(OS.Path.join(dir, "chat-sync.json"), JSON.stringify(state));
	},

	chatNoteParts(ctx) {
		let doc = Zotero.getMainWindow().document, parts = [];
		for (let id of ctx.paperItem.getNotes?.() || []) {
			let note = Zotero.Items.get(id);
			if (!note || note.deleted || !note.getTags().some(t => t.tag === "AbstractIn:Chat")) continue;
			let template = this.el(doc, "template"); template.innerHTML = note.getNote();
			for (let pre of template.content.querySelectorAll("pre")) {
				try {
					let data = JSON.parse(pre.textContent);
					if (data.format === "abstractin-chat-v1" && /^[a-z0-9-]{1,100}$/.test(data.chatID) &&
						/^[a-z0-9-]{1,100}$/.test(data.writerID) && /^[a-z0-9-]{1,100}$/.test(data.revision) &&
						Number.isFinite(data.updatedAt) && data.total > 0 && data.total <= 10000 && data.itemKey === ctx.paperItem.key &&
						data.attachmentKey === (ctx.reading ? ctx.attachmentItem?.key : null) &&
						typeof data.chatID === "string" && typeof data.text === "string" &&
						Number.isInteger(data.part) && Number.isInteger(data.total) && data.part >= 0 && data.part < data.total) parts.push({ note, data });
				}
				catch (e) { /* Keep malformed/edited notes intact; never execute note HTML. */ }
			}
		}
		return parts;
	},

	chatNoteHistories(ctx) {
		let groups = new Map();
		for (let part of this.chatNoteParts(ctx)) {
			let key = part.data.chatID + ":" + part.data.revision;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(part);
		}
		let histories = [];
		for (let parts of groups.values()) {
			let data = parts[0].data;
			let ordered = Array.from({ length: Math.min(data.total, 10000) }, (_, i) => parts.find(p => p.data.part === i && p.data.total === data.total));
			if (data.total > 10000 || ordered.some(p => !p)) continue; // A sync may still be downloading later parts.
			try {
				let history = JSON.parse(ordered.map(p => p.data.text).join(""));
				if (Array.isArray(history) && history.every(m => ["user", "assistant"].includes(m.role) && typeof m.text === "string")) histories.push({ ...data, history });
			}
			catch (e) { this.logError("chat note decoding", e); }
		}
		return histories.sort((a, b) => b.updatedAt - a.updatedAt);
	},

	async saveChatNotes(dir, history, override = null) {
		let ctx = this._chatContexts.get(dir);
		if (!ctx) return;
		let state = override || await this.chatSyncState(dir), writerID = this.chatDeviceID();
		// A device always writes its own branch, never overwriting another
		// computer's transcript before Zotero has reconciled its updates.
		if (!state || state.writerID !== writerID) state = { chatID: this.chatSyncID(), writerID };
		let text = JSON.stringify(history), revision = this.chatSyncID();
		let updatedAt = this.chatNoteParts(ctx).reduce((stamp, part) => Math.max(stamp, part.data.updatedAt + 1), Date.now());
		let total = Math.max(1, Math.ceil(text.length / 20000));
		let old = this.chatNoteParts(ctx).filter(p => p.data.chatID === state.chatID && p.data.writerID === writerID);
		for (let part = 0; part < total; part++) {
			let note = old.find(p => p.data.part === part)?.note || new Zotero.Item("note");
			note.libraryID = ctx.paperItem.libraryID; note.parentID = ctx.paperItem.id;
			let wrapper = this.el(Zotero.getMainWindow().document, "div");
			let title = history.find(m => m.role === "user")?.text?.replace(/\s+/g, " ").slice(0, 100) || "New chat";
			wrapper.append(this.el(wrapper.ownerDocument, "h1", null, "AbstractIn — Chat: " + title + (total > 1 ? " (" + (part + 1) + "/" + total + ")" : "")),
				this.el(wrapper.ownerDocument, "p", null, "Complete conversation text with LaTeX; image files and Codex session identifiers stay local."),
				this.el(wrapper.ownerDocument, "pre", null, JSON.stringify({
					format: "abstractin-chat-v1", itemKey: ctx.paperItem.key,
					attachmentKey: ctx.reading ? ctx.attachmentItem?.key : null,
					chatID: state.chatID, writerID, revision, updatedAt, part, total,
					archived: !!override?.archived,
					discussionID: ctx.discussion?.id || null,
					discussion: ctx.discussion || null,
					chapter: ctx.discussion ? (await this.discussionIndex(ctx)).chapters.find(c => c.id === ctx.discussion.chapterID) || null : null,
					text: text.slice(part * 20000, (part + 1) * 20000),
				})));
			note.setNote(wrapper.outerHTML); note.addTag("AbstractIn"); note.addTag("AbstractIn:Chat");
			await note.saveTx();
		}
		// Extra older parts remain harmless and are ignored by revision. Avoid
		// deleting notes on another device during partial or concurrent sync.
		if (!override) await this.writeChatSyncState(dir, { ...state, revision, updatedAt });
	},

	async hydrateChatHistory(dir, local, exists) {
		let ctx = this._chatContexts.get(dir);
		if (!ctx) return local;
		if (!this._chatArchiveImports.has(dir)) {
			this._chatArchiveImports.add(dir);
			try { await this.listArchives(dir); }
			catch (e) { this._chatArchiveImports.delete(dir); this.logError("legacy chat archive migration", e); }
		}
		let remote = this.chatNoteHistories(ctx), state = await this.chatSyncState(dir);
		if (exists) {
			// Import existing installations into Zotero without replacing their
			// local conversation with an unrelated device's newest chat.
			if (!state && local.length) {
				try { await this.saveChatNotes(dir, local); }
				catch (e) { this.logError("chat history migration", e); }
			}
			return local;
		}
		let chosen = remote.find(chat => chat.chatID === state?.chatID) || remote.find(chat => !chat.archived) || remote[0];
		if (!chosen) return local;
		let history = chosen.history.map(message => ({ ...message, ...(message.selection && ctx.attachmentItem ?
			{ selection: { ...message.selection, attachmentID: ctx.attachmentItem.id } } : {}) }));
		await Zotero.File.putContentsAsync(OS.Path.join(dir, "chat.json"), JSON.stringify(history, null, 2));
		await this.writeChatSyncState(dir, { chatID: chosen.chatID, writerID: chosen.writerID, revision: chosen.revision });
		await this.saveSessions(dir, {}); // Remote CLI thread identifiers are not portable.
		return history;
	},

	async syncedChatArchives(dir) {
		let ctx = this._chatContexts.get(dir);
		if (!ctx) return [];
		let state = await this.chatSyncState(dir), archives = [], seen = new Set();
		let chats = this.chatNoteHistories(ctx);
		for (let chat of chats) {
			let key = JSON.stringify(chat.history);
			if (!chat.history.length || chat.chatID === state?.chatID || seen.has(key)) continue;
			seen.add(key);
			// A newer branch already contains this prefix; keep the fuller
			// version in Previous chats, but never delete the older source note.
			if (chats.some(other => other.history.length > chat.history.length &&
				JSON.stringify(other.history.slice(0, chat.history.length)) === key)) continue;
			let path = OS.Path.join(dir, "chat-sync-" + chat.chatID + ".json");
			let history = chat.history.map(message => ({ ...message, ...(message.selection && ctx.attachmentItem ?
				{ selection: { ...message.selection, attachmentID: ctx.attachmentItem.id } } : {}) }));
			await Zotero.File.putContentsAsync(path, JSON.stringify(history, null, 2));
			archives.push({ path, title: chat.history.find(m => m.role === "user")?.text?.replace(/\s+/g, " ").trim() || "Chat",
				count: chat.history.length, ts: chat.updatedAt, synced: true });
		}
		return archives;
	},


	_positionBindings: new Map(),
	_positionWrites: new Map(),

	trackReadingPosition(view) {
		let reader = this.exactReadingReader(view.ctx);
		if (!reader) return;
		let frame = reader._internalReader?._primaryView?._iframeWindow;
		frame = frame?.wrappedJSObject || frame;
		let bus = frame?.PDFViewerApplication?.eventBus;
		if (!bus || !(bus.on || bus._on)) return;
		let previous = this._positionBindings.get(reader);
		if (previous) { (previous.bus.off || previous.bus._off)?.call(previous.bus, "pagechanging", previous.listener); previous.win.clearTimeout(previous.timer); }
		let attachmentID = view.ctx.attachmentItem.id;
		let binding = { bus, timer: null, win: view.doc.defaultView };
		binding.listener = () => {
			binding.win.clearTimeout(binding.timer);
			binding.timer = binding.win.setTimeout(() => {
				if (this._views.get(view.root) === view && view.ctx.attachmentItem.id === attachmentID && !view.ctx.reading.referenceNavigation) {
					this.rememberReadingPosition(view.ctx).catch(e => this.logError("reading position", e));
				}
			}, 1500);
		};
		(bus.on || bus._on).call(bus, "pagechanging", binding.listener);
		this._positionBindings.set(reader, binding);
	},

	stopReadingPositionTracking() {
		for (let binding of this._positionBindings.values()) {
			(binding.bus.off || binding.bus._off)?.call(binding.bus, "pagechanging", binding.listener);
			binding.win.clearTimeout(binding.timer);
		}
		this._positionBindings.clear();
	},
	readingArtifactNotes(ctx, kind) {
		let doc = Zotero.getMainWindow().document;
		return (ctx.paperItem.getNotes?.() || []).map(id => Zotero.Items.get(id)).filter(note => {
			if (!note || !note.getTags().some(t => t.tag === "AbstractIn:" + kind)) return false;
			let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template"); template.innerHTML = note.getNote();
			return [...template.content.querySelectorAll("p")].some(p => p.textContent === "Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key);
		});
	},

	pdfPageText(text, pageIndex) {
		let marker = "## PDF page " + (pageIndex + 1) + "; pageIndex " + pageIndex + "\n";
		let start = text.indexOf(marker);
		if (start < 0) return "";
		start += marker.length;
		let next = text.slice(start).search(/\n## PDF page \d+; pageIndex \d+\n/);
		return text.slice(start, next < 0 ? undefined : start + next).trim();
	},

	handleReadingSourceLink(view, event) {
		let link = event.target.closest?.("a[href]");
		if (!view?.ctx.reading || !link) return;
		let prefix = this.readingPDFLink(view.ctx) + "?page=";
		if (!link.href.startsWith(prefix)) return;
		let page = Number(link.href.slice(prefix.length));
		if (!Number.isInteger(page) || page < 1) return;
		event.preventDefault();
		this.navigateReading(view, { pageIndex: page - 1 }).catch(e => this.appendError(view, e.message || String(e)));
	},

	readingArtifactData(note) {
		if (!note) return null;
		let doc = Zotero.getMainWindow().document;
		let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template"); template.innerHTML = note.getNote();
		for (let pre of template.content.querySelectorAll("pre")) {
			try { let data = JSON.parse(pre.textContent); if (data.format === "abstractin-workspace-v1") return data; }
			catch (e) { /* Other pre blocks can contain mathematical notation. */ }
		}
		return null;
	},

	readingNoteMarkdown(note) {
		let doc = Zotero.getMainWindow().document;
		let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template"); template.innerHTML = note.getNote();
		for (let pre of template.content.querySelectorAll("pre")) {
			try {
				if (JSON.parse(pre.textContent).format === "abstractin-workspace-v1") {
					if (pre.previousElementSibling?.textContent === "Workspace data") pre.previousElementSibling.remove();
					pre.remove();
				}
			}
			catch (e) { /* A mathematical pre block is human-facing content. */ }
		}
		let inline = node => {
			if (node.nodeType === 3) return node.textContent;
			let text = [...node.childNodes].map(inline).join("");
			if (node.localName === "strong" || node.localName === "b") return "**" + text + "**";
			if (node.localName === "em" || node.localName === "i") return "*" + text + "*";
			if (node.localName === "br") return "\n";
			if (node.localName === "a" && node.getAttribute("href")) return "[" + text + "](" + node.getAttribute("href") + ")";
			return text;
		};
		let block = node => {
			let tag = node.localName;
			if (/^h[1-6]$/.test(tag || "")) return "#".repeat(Number(tag[1])) + " " + inline(node) + "\n\n";
			if (tag === "p") return inline(node) + "\n\n";
			if (tag === "pre") return node.classList.contains("math") ? node.textContent + "\n\n" : "```\n" + node.textContent + "\n```\n\n";
			if (tag === "li") return "- " + inline(node) + "\n";
			if (tag === "blockquote") return "> " + inline(node).replace(/\n/g, "\n> ") + "\n\n";
			if (tag === "table") {
				let rows = [...node.querySelectorAll("tr")].map(row => "| " + [...row.children].map(cell => inline(cell).replace(/\|/g, "\\|")).join(" | ") + " |");
				if (rows.length) rows.splice(1, 0, "| " + [...node.querySelector("tr").children].map(() => "---").join(" | ") + " |");
				return rows.join("\n") + "\n\n";
			}
			return [...node.childNodes].map(block).join("");
		};
		return block(template.content);
	},

	async saveReadingArtifact(ctx, kind, title, text, data) {
		let existing = this.readingArtifactNotes(ctx, kind)[0];
		let note = existing || new Zotero.Item("note");
		note.libraryID = ctx.paperItem.libraryID; note.parentID = ctx.paperItem.id;
		let doc = Zotero.getMainWindow().document;
		let wrapper = this.el(doc, "div");
		wrapper.append(this.el(doc, "h1", null, "AbstractIn — " + title),
			this.el(doc, "p", null, "Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key));
		let link = this.el(doc, "a", null, "Open source PDF"); link.href = this.readingPDFLink(ctx);
		wrapper.append(link);
		if (data) {
			wrapper.append(this.el(doc, "h2", null, "Workspace data"),
				this.el(doc, "pre", null, JSON.stringify({ ...data, format: "abstractin-workspace-v1" }, null, 2)));
		}
		note.setNote(wrapper.outerHTML + this.noteHTML(title, text));
		note.addTag("AbstractIn"); note.addTag("AbstractIn:" + kind);
		await note.saveTx(); return note.key;
	},

	async exportReadingWorkspace(ctx) {
		let doc = Zotero.getMainWindow().document;
		let parts = [];
		for (let kind of ["Contents", "Summary"]) {
			for (let note of this.readingArtifactNotes(ctx, kind)) {
				let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template"); template.innerHTML = note.getNote();
				parts.push("## " + kind + " — Zotero note " + note.key + "\n\n" + template.content.textContent);
			}
		}
		let text = "# Reading workspace (derived from current Zotero notes)\n\n" + parts.join("\n\n");
		await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "workspace.md"), text);
		return text;
	},

	contentsExcerpt(source) {
		let heading = /^\s*(?:table of contents|contents|目\s*录)\s*(?:[ivxlcdm]+|\d+)?\s*$/im.exec(source);
		let start = heading ? heading.index : 0;
		return source.slice(start).split(/\f|(?=^## PDF page \d+; pageIndex \d+\r?$)/m).slice(0, 12).join("\n\n").slice(0, 60000);
	},

	async prepareContentsSource(ctx) {
		let source = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md"));
		await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "contents-source.md"),
			"# Candidate contents excerpt\n\nCopied from the current PDF text. This bounded excerpt may require continuation; it is not a whole-book read or an independently verified page mapping.\n\n" + this.contentsExcerpt(source));
	},

	readingActionPrompt(ctx, action) {
		if (action === "contents") return "Initialize the book-reading workspace from the actual table of contents in source-text.md. " +
			"Use contents-source.md first, then search the full text only for missing contents pages. Extract the real chapter hierarchy. Do not read or summarize chapters. " +
			"Append one <abstractin-workspace>JSON</abstractin-workspace> block instead of an abstractin-record. " +
			'The JSON schema is {"kind":"contents","entries":[{"id":"ch-01","title":"exact chapter heading","printedPageLabel":null,"pageIndex":null,"evidence":"exact contents-page text"}],"coverage":"actual contents pages inspected"}. ' +
			"Include parts and sections only if supported by the contents. The plugin assigns safe stable identifiers. " +
			"For this structural initialization set every pageIndex to null. Do not scan chapter bodies to resolve page links; physical locations can be verified later for a requested chapter. " +
			"Each evidence string must be an exact contents excerpt, including the entry heading. Copy it without reformulating punctuation or dot leaders. Do not invent missing chapters. " +
			"If no contents can be verified, explain the missing source and do not emit a workspace block. The plugin creates the structural workspace and saves its authoritative Zotero note.";
		if (action === "summary") return "The user has approved creating or updating this paper's summary. Follow the original scientific-paper-reading skill's initial read workflow and report format. " +
			"Use source-text.md for progressive structural scan, targeted extraction, whole-paper synthesis and consistency checks. " +
			"When updating, inspect the existing Summary in workspace.md and the corrected Zotero records first. " +
			"Cover every substantive experiment/analysis, relevant controls, limitations and conflicting results. Do not perform external literature search. " +
			"The visible answer is the complete human-facing summary; the plugin saves it as the authoritative editable Zotero summary note. " +
			'Append one <abstractin-workspace>{"kind":"summary","coverage":"source portions actually inspected"}</abstractin-workspace> block instead of an abstractin-record. Do not write parallel editable reports.';
		return "";
	},

	async saveReadingAction(ctx, action, text) {
		let data = this.readingEnvelope(text, "workspace");
		if (!data) throw new Error("Codex did not return a verified " + action + " workspace. The answer remains available; no workspace was saved.");
		if (data.kind !== action || typeof data.coverage !== "string" || !data.coverage.trim()) throw new Error("Invalid workspace source coverage.");
		let answer = this.readingVisibleText(text).trim();
		if (!answer) throw new Error("Codex returned an empty workspace answer.");
		let notices = [];
		if (action === "contents") {
			if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 1000) throw new Error("No verified table of contents was returned.");
			let source = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md"));
			let normalize = text => text.normalize("NFKC").replace(/[\u00ad\u200b]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
			let normalized = normalize(source);
			let candidates = this.contentsExcerpt(source).split(/\r?\n/);
			let prior = this.readingArtifactData(this.readingArtifactNotes(ctx, "Contents")[0])?.entries || [];
			let ids = new Set();
			let verified = [], omitted = 0, unlocated = 0;
			for (let candidate of data.entries) {
				if (!candidate || typeof candidate.title !== "string" || !candidate.title.trim() || candidate.title.length > 600) { omitted++; continue; }
				let entry = { ...candidate, title: candidate.title.trim(), pageIndex: candidate.pageIndex ?? null, printedPageLabel: candidate.printedPageLabel ?? null };
				let title = normalize(entry.title);
				if (!title) { omitted++; continue; }
				if (typeof entry.evidence !== "string" || !normalize(entry.evidence).includes(title) || !normalized.includes(normalize(entry.evidence))) {
					// Recover the exact quoted contents line when the model reformats
					// whitespace/dot leaders. Never substitute a guessed heading.
					entry.evidence = null;
					for (let count = 1; count <= 3 && !entry.evidence; count++) {
						for (let i = 0; i < candidates.length; i++) {
							let excerpt = candidates.slice(i, i + count).join("\n").trim();
							if (excerpt.length <= 3000 && normalize(excerpt).includes(title) && normalized.includes(normalize(excerpt))) { entry.evidence = excerpt; break; }
						}
					}
				}
				if (!entry.evidence) { omitted++; continue; }
				if (entry.printedPageLabel !== null && typeof entry.printedPageLabel !== "string") entry.printedPageLabel = null;
				let old = prior.find(previous => normalize(previous.title) === title && !ids.has(previous.id) && previous.printedPageLabel === entry.printedPageLabel) ||
					prior.find(previous => normalize(previous.title) === title && !ids.has(previous.id));
				let id = old?.id || entry.id;
				if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || ids.has(id)) {
					let hash = 2166136261;
					for (let char of title + "|" + (entry.printedPageLabel || "")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
					id = "entry-" + hash.toString(36);
					let suffix = 1; while (ids.has(id)) id = "entry-" + hash.toString(36) + "-" + suffix++;
				}
				entry.id = id; ids.add(id);
				if (entry.pageIndex !== null && (!Number.isInteger(entry.pageIndex) || entry.pageIndex < 0 || !ctx.reading.pdfSource?.pageMapping ||
					entry.pageIndex >= ctx.reading.pdfSource.totalPages || !normalize(this.pdfPageText(source, entry.pageIndex)).includes(title))) {
					entry.pageIndex = null; unlocated++;
				}
				verified.push(entry);
			}
			if (!verified.length) throw new Error("No contents entries could be verified against this PDF text. No contents note was saved; you can still ask about a selected passage or initialize again explicitly.");
			data.entries = verified; data.omittedEntries = omitted;
			if (omitted) notices.push("Saved " + verified.length + " verified contents entries; " + omitted + " unverified entries were omitted. The directory is incomplete.");
			if (unlocated) notices.push(unlocated + " chapter page locations were unverified; structure was saved without those page links.");
			// The saved human-facing directory must reflect validated entries,
			// rather than an agent's claim that an unverified directory is complete.
			let escape = value => value.replace(/[\\`*_\[\]<>]/g, "\\$&");
			answer = "## Verified book contents\n\n" + verified.map(entry => "- " + escape(entry.title) + (entry.printedPageLabel ? " (printed page " + escape(entry.printedPageLabel) + ")" : "")).join("\n") +
				"\n\nSource coverage: " + data.coverage + "\n\nPhysical page links are available only for independently verified locations.\n\n" + notices.join("\n\n");
		}
		data.sourceSignature = ctx.reading.pdfSource?.signature;
		let key = await this.saveReadingArtifact(ctx, action === "contents" ? "Contents" : "Summary", action === "contents" ? "Book contents" : "Paper summary", answer, data);
		try {
			await this.exportReadingWorkspace(ctx);
			if (action === "contents") {
				let chapters = OS.Path.join(ctx.dir, "chapters"); await Zotero.File.createDirectoryIfMissingAsync(chapters);
				for (let entry of data.entries) await Zotero.File.createDirectoryIfMissingAsync(OS.Path.join(chapters, entry.id));
			}
		}
		catch (e) { this.logError("workspace cache", e); notices.push("Zotero note saved, but its derived workspace cache could not be refreshed: " + (e.message || e)); }
		return { answer, key, notice: notices.join(" ") || undefined };
	},

	exactReadingReader(ctx) {
		let matches = reader => !!reader && reader.itemID === ctx.attachmentItem.id && reader.type === "pdf";
		if (matches(ctx.reader)) return ctx.reader;
		let selected = Zotero.Reader?.getByTabID?.(Zotero.getMainWindow()?.Zotero_Tabs?.selectedID);
		return (matches(selected) ? selected : null) || (Zotero.Reader?._readers || []).find(matches) || null;
	},

	readingPDFApplication(ctx) {
		let internal = this.exactReadingReader(ctx)?._internalReader;
		let frame = (internal?._lastView || internal?._primaryView)?._iframeWindow;
		return (frame?.wrappedJSObject || frame)?.PDFViewerApplication || null;
	},

	_nativeReadingPages: new WeakMap(),

	async readNativeReadingPage(ctx, pageIndex) {
		let app = this.readingPDFApplication(ctx), pdf = app?.pdfDocument;
		if (!pdf) throw new Error("Open this PDF in the Zotero reader to verify page locations.");
		if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) throw new Error("This location is outside the selected PDF.");
		let pages = this._nativeReadingPages.get(pdf);
		if (!pages) { pages = new Map(); this._nativeReadingPages.set(pdf, pages); }
		if (!pages.has(pageIndex)) {
			let request = (async () => {
				let page = await pdf.getPage(pageIndex + 1);
				let content = await page.getTextContent();
				return content.items.filter(item => typeof item.str === "string").map(item => item.str + (item.hasEOL ? "\n" : " ")).join("").trim();
			})();
			pages.set(pageIndex, request);
			request.catch(() => { if (pages.get(pageIndex) === request) pages.delete(pageIndex); });
		}
		return { pageIndex, pageLabel: app.pdfViewer?.getPageView(pageIndex)?.pageLabel || "", text: await pages.get(pageIndex) };
	},

	_pageMappingRepairs: new WeakMap(),

	async recoverReadingPageMapping(ctx, source) {
		let pdf = this.readingPDFApplication(ctx)?.pdfDocument;
		if (source.status !== "ready" || source.pageMapping || !pdf || pdf.numPages !== source.totalPages) return source;
		let attempted = this._pageMappingRepairs.get(pdf);
		if (!attempted) { attempted = new Set(); this._pageMappingRepairs.set(pdf, attempted); }
		if (attempted.has(source.signature)) return source;
		attempted.add(source.signature);
		try {
			let text = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md"));
			let warning = "Page boundaries could not be verified. Do not infer page indices from this text.\n\n";
			let start = text.indexOf(warning);
			if (start < 0) return source;
			let pages = text.slice(start + warning.length).split("\f");
			let missing = source.totalPages - pages.length;
			// Limit edge probing; current-page access remains independent if this check fails.
			if (missing < 1 || missing > 12) return source;
			let compact = value => value.normalize("NFKC").replace(/[\s\u00ad\u200b]/g, "");
			let leading = 0, trailing = 0;
			let first = await this.readNativeReadingPage(ctx, leading);
			while (!first.text.trim() && leading < missing) first = await this.readNativeReadingPage(ctx, ++leading);
			let last = await this.readNativeReadingPage(ctx, source.totalPages - 1);
			while (!last.text.trim() && trailing < missing - leading) last = await this.readNativeReadingPage(ctx, source.totalPages - 1 - ++trailing);
			if (leading + trailing !== missing || !compact(first.text) || !compact(last.text) ||
				compact(first.text) !== compact(pages[0]) || compact(last.text) !== compact(pages[pages.length - 1])) return source;
			pages = [...Array(leading).fill(""), ...pages, ...Array(trailing).fill("")];
			let mapped = text.slice(0, start) + pages.map((page, i) => "## PDF page " + (i + 1) + "; pageIndex " + i + "\n\n" +
				(page.trim() || "[No extractable text on this page]")).join("\n\n");
			await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-text.md"), mapped);
			source = { ...source, pageMapping: true, mappingVerification: "Native edge pages verified trimmed blank-page boundaries" };
			await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-manifest.json"), JSON.stringify(source));
			this.log("Recovered PDF page mapping: " + leading + " leading and " + trailing + " trailing blank pages");
		}
		catch (e) { this.logError("PDF page boundary verification", e); }
		return source;
	},

	async prepareCurrentReadingPage(ctx) {
		let location = ctx.reading.currentPage;
		if (!location) return;
		try {
			let page = await this.readNativeReadingPage(ctx, location.pageIndex);
			ctx.reading.currentPage = { ...page, text: page.text.slice(0, 12000), file: "current-page.md", verified: true };
			await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "current-page.md"),
				"# Current PDF page\n\nAttachment: " + ctx.attachmentItem.key + "\nPhysical PDF page: " + (page.pageIndex + 1) +
				"; pageIndex: " + page.pageIndex + "\nPrinted label: " + (page.pageLabel || "unverified") + "\n\n" + (page.text || "[No extractable text; request a page image.]"));
		}
		catch (e) {
			this.logError("current PDF page", e);
			if (ctx.reading.evidenceMode !== "knowledge" && ctx.reading.pdfSource?.pageMapping) {
				let text = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md"));
				ctx.reading.currentPage = { ...location, text: this.pdfPageText(text, location.pageIndex).slice(0, 12000), verified: true };
			}
		}
	},

	async openReadingContentsEntry(view, entry) {
		let ctx = view.ctx, pdf = this.readingPDFApplication(ctx)?.pdfDocument;
		let normalize = text => String(text || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
		let title = normalize(entry.title), indices = new Set();
		let heading = text => normalize(text).replace(/^(?:chapter\s+)?(?:\d+(?:\.\d+)*|[ivxlcdm]+)[\s.:–—-]+/i, "");
		if (pdf) {
			let walk = async nodes => {
				for (let node of nodes || []) {
					if ((normalize(node.title) === title || (heading(node.title) && heading(node.title) === heading(entry.title))) && node.dest) {
						let dest = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
						let ref = dest?.[0];
						let index = Number.isInteger(ref) ? ref : ref ? await pdf.getPageIndex(ref) : null;
						if (Number.isInteger(index) && index >= 0 && index < pdf.numPages) indices.add(index);
					}
					await walk(node.items);
				}
			};
			await walk(await pdf.getOutline?.());
			if (!indices.size && entry.printedPageLabel && pdf.getPageLabels) {
				let labels = await pdf.getPageLabels();
				for (let i = 0; i < (labels?.length || 0); i++) {
					if (labels[i] === entry.printedPageLabel && normalize((await this.readNativeReadingPage(ctx, i)).text).includes(title)) indices.add(i);
				}
			}
		}
		if (!indices.size && ctx.reading.pdfSource?.pageMapping) {
			let source = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md"));
			let markers = [...source.matchAll(/^## PDF page \d+; pageIndex (\d+)\r?\n/gm)];
			for (let i = 0; i < markers.length; i++) {
				let pageIndex = Number(markers[i][1]);
				if (pageIndex >= ctx.reading.pdfSource.totalPages) continue;
				let text = source.slice(markers[i].index + markers[i][0].length, markers[i + 1]?.index ?? source.length);
				// A contents row is not a chapter heading. Accept an exact standalone heading only.
				let lines = text.split(/\r?\n/);
				if (lines.some((line, j) => normalize(line) === title || normalize(line + " " + (lines[j + 1] || "")) === title) &&
					!/^\s*(?:table of contents|contents|目\s*录)\s*$/im.test(text)) indices.add(pageIndex);
			}
		}
		if (indices.size !== 1) throw new Error("A unique chapter location could not be verified. Open its heading in the PDF or use a PDF bookmark; no printed-page offset was guessed.");
		await this.navigateReading(view, { pageIndex: [...indices][0] });
	},

	currentReadingLocation(ctx) {
		let viewer = this.readingPDFApplication(ctx)?.pdfViewer;
		let index = viewer?.currentPageNumber - 1;
		if (!Number.isInteger(index) || index < 0) return null;
		return { pageIndex: index, pageLabel: viewer.getPageView(index)?.pageLabel || "" };
	},

	async rememberReadingPosition(ctx) {
		if (ctx.reading?.referenceNavigation) return;
		let location = this.currentReadingLocation(ctx);
		if (!location) return;
		let saved = this.readingArtifactData(this.readingArtifactNotes(ctx, "Position")[0]);
		if (saved?.pageIndex === location.pageIndex && saved.pageLabel === location.pageLabel) { ctx.reading.resumePosition = location; return; }
		let previous = this._positionWrites.get(ctx.dir) || Promise.resolve();
		let write = previous.catch(() => {}).then(() => this.saveReadingArtifact(ctx, "Position", "Reading position", "Last genuine reading location. This does not indicate understanding or mastery.", { kind: "position", ...location }));
		this._positionWrites.set(ctx.dir, write);
		try { await write; }
		finally { if (this._positionWrites.get(ctx.dir) === write) this._positionWrites.delete(ctx.dir); }
		ctx.reading.resumePosition = location;
	},

	async navigateReading(view, location, reference = true) {
		if (!Number.isInteger(location?.pageIndex) || location.pageIndex < 0) throw new Error("This location has no verified PDF page index.");
		let totalPages = this.readingPDFApplication(view.ctx)?.pdfDocument?.numPages ?? view.ctx.reading.pdfSource?.totalPages;
		if (Number.isInteger(totalPages) && location.pageIndex >= totalPages) throw new Error("This location is outside the selected PDF.");
		if (reference && !view.ctx.reading.referenceNavigation) await this.rememberReadingPosition(view.ctx);
		view.ctx.reading.referenceNavigation = reference;
		let reader = this.exactReadingReader(view.ctx);
		if (!reader) reader = await Zotero.Reader.open(view.ctx.attachmentItem.id);
		if (reader._initPromise) await reader._initPromise;
		await reader.navigate({ pageIndex: location.pageIndex });
		this.updateReadingControls(view);
	},

	async returnToReading(view) {
		let note = this.readingArtifactNotes(view.ctx, "Position")[0];
		let location = this.readingArtifactData(note);
		if (!location) throw new Error("No genuine reading position has been recorded yet.");
		await this.navigateReading(view, location, false);
	},

	async beginReadingWorkflow(view, { showWorkspace = true } = {}) {
		let ctx = view.ctx;
		let position = this.readingArtifactData(this.readingArtifactNotes(ctx, "Position")[0]);
		try {
			if (position) {
				ctx.reading.resumePosition = position;
				await this.navigateReading(view, position, false);
			}
			else await this.rememberReadingPosition(ctx);
		}
		catch (e) { this.appendError(view, "Reading position could not be restored or saved: " + (e.message || e)); }
		this.trackReadingPosition(view);
		await this.exportReadingRecords(ctx);
		if (!this.agentCanReadSources()) { if (showWorkspace) this.openReadingWorkspace(view); return; }
		if (ctx.reading.type === "book" && !ctx.reading.contentsAttempted) {
			try {
				let attempt = JSON.parse(await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "contents-auto-attempt.json")));
				ctx.reading.contentsAttempted = attempt.attachmentKey === ctx.attachmentItem.key;
			}
			catch (e) { /* No previous automatic attempt for this attachment. */ }
		}
		if (ctx.reading.type === "book" && !this.readingArtifactNotes(ctx, "Contents").length && !ctx.reading.contentsAttempted && !this._pending.has(ctx.dir)) {
			ctx.reading.contentsAttempted = true;
			try { await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "contents-auto-attempt.json"), JSON.stringify({ attachmentKey: ctx.attachmentItem.key, requestedAt: new Date().toISOString() })); }
			catch (e) { this.logError("contents initialization attempt", e); }
			this.startRequest(view, "Initialize the actual book contents without chapter summaries.", [], [], { readingAction: "contents" });
		}
		else if (showWorkspace) this.openReadingWorkspace(view);
	},

	openReadingWorkspace(view) {
		let { doc, root, ctx } = view;
		if (!ctx.reading) return;
		root.querySelector(".abstractin-panel")?.remove();
		let panel = this.el(doc, "div", "abstractin-panel abstractin-workspace-panel");
		panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Reading workspace");
		let head = this.el(doc, "div", "abstractin-panel-head");
		head.append(this.el(doc, "div", "abstractin-panel-title", ctx.reading.type === "book" ? "Book workspace" : "Paper workspace"), this.iconButton(doc, "abstractin-small", "Close", "close", () => panel.remove()));
		let body = this.el(doc, "div", "abstractin-panel-body");
		let action = ctx.reading.type === "book" ? "contents" : "summary";
		let kind = action === "contents" ? "Contents" : "Summary";
		let note = this.readingArtifactNotes(ctx, kind)[0];
		let controls = this.el(doc, "div", "abstractin-workspace-actions");
		let button = (label, click) => {
			let node = this.el(doc, "button", "abstractin-reading-tool", label); node.type = "button";
			node.addEventListener("click", click); controls.append(node); return node;
		};
		if (note) button("View " + kind.toLowerCase(), () => {
			body.querySelector(".abstractin-workspace-view")?.remove();
			let content = this.el(doc, "div", "abstractin-workspace-view");
			let text = this.readingNoteMarkdown(note);
			this.renderMarkdown(doc, content, text); body.append(content);
			if (kind === "Contents") {
				for (let entry of this.readingArtifactData(note)?.entries || []) {
					{
						let link = this.el(doc, "button", "abstractin-reading-tool", "Open " + entry.title);
						link.addEventListener("click", async () => {
							link.disabled = true;
							try { await this.openReadingContentsEntry(view, entry); }
							catch (e) { this.appendError(view, e.message); }
							finally { link.disabled = false; }
						});
						content.append(link);
					}
				}
			}
		});
		let generate = button(note ? "Update " + kind.toLowerCase() : action === "contents" ? "Initialize contents" : "Summarize paper", () => {
			panel.remove();
			this.startRequest(view, action === "contents" ? "Initialize the actual book contents without chapter summaries." : "Generate or update the paper summary using scientific-paper-reading.", [], [], { readingAction: action });
		});
		generate.disabled = this._pending.has(ctx.dir) || !this.agentCanReadSources();
		if (!this.agentCanReadSources()) generate.title = "Choose an agent that passed original-source checks to initialize or summarize.";
		button("Go to questions", () => panel.remove());
		body.append(this.el(doc, "p", null, action === "contents" ? "Initialize structure from the actual contents. Chapter summaries are generated only when you ask." : "Choose whether to summarize first or ask immediately. Existing summaries are saved as editable Zotero notes."), controls);
		if (action === "contents" && !note && ctx.reading.contentsAttempted) body.append(this.el(doc, "p", "abstractin-notice", "Contents are not saved yet. Initialize contents to retry explicitly, or go straight to questions. Start Reading will not repeat the scan automatically."));
		let records = (ctx.paperItem.getNotes?.() || []).map(id => Zotero.Items.get(id)).filter(n => n && n.getTags().some(t => t.tag === "AbstractIn") && !n.getTags().some(t => t.tag.startsWith("AbstractIn:")));
		let recap = this.el(doc, "div", "abstractin-workspace-recap");
		recap.append(this.el(doc, "h3", null, "Previous discussions and open questions"));
		let count = 0;
		for (let record of records.slice().reverse()) {
			let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template"); template.innerHTML = record.getNote();
			if (![...template.content.querySelectorAll("p")].some(p => p.textContent === "Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key)) continue;
			let title = template.content.querySelector("h1")?.textContent || record.key;
			let questions = [...template.content.querySelectorAll("li")].map(n => n.textContent);
			let discussion = [...template.content.querySelectorAll("h2")].find(n => n.textContent === "Discussion");
			let content = discussion?.parentElement.cloneNode(true);
			content?.querySelector("h2")?.remove();
			let conclusion = content ? this.readingNoteMarkdown({ getNote: () => content.outerHTML }) : "";
			let entry = this.el(doc, "div", "abstractin-workspace-recap-entry");
			this.renderMarkdown(doc, entry, title + "\n\n" + conclusion + (questions.length ? "\n\nOpen questions:\n" + questions.map(text => "- " + text).join("\n") : ""));
			recap.append(entry);
			if (++count >= 5) break;
		}
		if (!count) recap.append(this.el(doc, "p", null, "No recorded discussions for this attachment yet."));
		body.append(recap); panel.append(head, body); root.append(panel);
		this.fitWideContent(recap);
	},
});
