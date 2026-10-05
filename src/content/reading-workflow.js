"use strict";

Object.assign(Zusia, {
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
			let template = doc.createElement("template"); template.innerHTML = note.getNote();
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
		let template = doc.createElement("template"); template.innerHTML = note.getNote();
		for (let pre of template.content.querySelectorAll("pre")) {
			try { let data = JSON.parse(pre.textContent); if (data.format === "abstractin-workspace-v1") return data; }
			catch (e) { /* Other pre blocks can contain mathematical notation. */ }
		}
		return null;
	},

	readingNoteMarkdown(note) {
		let doc = Zotero.getMainWindow().document;
		let template = doc.createElement("template"); template.innerHTML = note.getNote();
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
				let template = doc.createElement("template"); template.innerHTML = note.getNote();
				parts.push("## " + kind + " — Zotero note " + note.key + "\n\n" + template.content.textContent);
			}
		}
		await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "workspace.md"), "# Reading workspace (derived from current Zotero notes)\n\n" + parts.join("\n\n"));
	},

	readingActionPrompt(ctx, action) {
		if (action === "contents") return "Initialize the book-reading workspace from the actual table of contents in source-text.md. " +
			"Find the contents pages first, and extract the real chapter hierarchy. Do not read or summarize chapters. " +
			"Append one <abstractin-workspace>JSON</abstractin-workspace> block instead of an abstractin-record. " +
			'The JSON schema is {"kind":"contents","entries":[{"id":"ch-01","title":"exact chapter heading","printedPageLabel":null,"pageIndex":null,"evidence":"exact contents-page text"}],"coverage":"actual contents pages inspected"}. ' +
			"IDs must be stable lowercase letters/digits/hyphens. Include parts and sections only if supported by the contents. " +
			"Use null for unknown locations; a printed chapter-start label is not its physical PDF page. Only fill pageIndex after finding the actual chapter heading on that extracted physical page. " +
			"Each evidence string must be an exact excerpt from extracted source text. Do not invent missing chapters. " +
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
		let match = String(text).match(/<abstractin-workspace>\s*([\s\S]*?)\s*<\/abstractin-workspace>\s*$/);
		if (!match) throw new Error("Codex did not return a verified " + action + " workspace. The answer remains available; no workspace was saved.");
		let data = JSON.parse(match[1]);
		if (data.kind !== action || typeof data.coverage !== "string" || !data.coverage.trim()) throw new Error("Invalid workspace source coverage.");
		let answer = this.readingVisibleText(text).trim();
		if (!answer) throw new Error("Codex returned an empty workspace answer.");
		if (action === "contents") {
			if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 1000) throw new Error("No verified table of contents was returned.");
			let source = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md"));
			let normalize = text => text.replace(/\s+/g, " ").trim();
			let ids = new Set();
			for (let entry of data.entries) {
				if (!entry || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id) || typeof entry.title !== "string" || !entry.title.trim() ||
					typeof entry.evidence !== "string" || !entry.evidence.trim() || !normalize(source).includes(normalize(entry.evidence))) throw new Error("A contents entry has no verifiable source evidence or valid identifier.");
				if (entry.pageIndex !== null && (!Number.isInteger(entry.pageIndex) || entry.pageIndex < 0 || !ctx.reading.pdfSource.pageMapping || entry.pageIndex >= ctx.reading.pdfSource.totalPages)) throw new Error("Invalid chapter PDF page index.");
				if (entry.pageIndex !== null && !normalize(this.pdfPageText(source, entry.pageIndex)).toLowerCase().includes(normalize(entry.title).toLowerCase())) throw new Error("The chapter heading was not verified on the specified physical PDF page. Use null for unknown locations.");
				if (entry.printedPageLabel !== null && typeof entry.printedPageLabel !== "string") throw new Error("Invalid printed page label.");
				ids.add(entry.id);
			}
		}
		data.sourceSignature = ctx.reading.pdfSource?.signature;
		let key = await this.saveReadingArtifact(ctx, action === "contents" ? "Contents" : "Summary", action === "contents" ? "Book contents" : "Paper summary", answer, data);
		await this.exportReadingWorkspace(ctx);
		if (action === "contents") {
			let chapters = OS.Path.join(ctx.dir, "chapters"); await Zotero.File.createDirectoryIfMissingAsync(chapters);
			for (let entry of data.entries) await Zotero.File.createDirectoryIfMissingAsync(OS.Path.join(chapters, entry.id));
		}
		return { answer, key };
	},

	exactReadingReader(ctx) {
		return (Zotero.Reader?._readers || []).find(reader => reader.itemID === ctx.attachmentItem.id && reader.type === "pdf") || null;
	},

	currentReadingLocation(ctx) {
		let reader = this.exactReadingReader(ctx);
		let pdfView = reader?._internalReader?._lastView || reader?._internalReader?._primaryView;
		let frame = pdfView?._iframeWindow;
		frame = frame?.wrappedJSObject || frame;
		let viewer = frame?.PDFViewerApplication?.pdfViewer;
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
		if (Number.isInteger(view.ctx.reading.pdfSource?.totalPages) && location.pageIndex >= view.ctx.reading.pdfSource.totalPages) throw new Error("This location is outside the selected PDF.");
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

	async beginReadingWorkflow(view) {
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
		if (ctx.reading.type === "book" && !this.readingArtifactNotes(ctx, "Contents").length && !this._pending.has(ctx.dir)) {
			this.startRequest(view, "Initialize the actual book contents without chapter summaries.", [], [], { readingAction: "contents" });
		}
		else this.openReadingWorkspace(view);
	},

	openReadingWorkspace(view) {
		let { doc, root, ctx } = view;
		if (!ctx.reading) return;
		root.querySelector(".zs-panel")?.remove();
		let panel = this.el(doc, "div", "zs-panel zs-workspace-panel");
		panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Reading workspace");
		let head = this.el(doc, "div", "zs-panel-head");
		head.append(this.el(doc, "div", "zs-panel-title", ctx.reading.type === "book" ? "Book workspace" : "Paper workspace"), this.iconButton(doc, "zs-small", "Close", "close", () => panel.remove()));
		let body = this.el(doc, "div", "zs-panel-body");
		let action = ctx.reading.type === "book" ? "contents" : "summary";
		let kind = action === "contents" ? "Contents" : "Summary";
		let note = this.readingArtifactNotes(ctx, kind)[0];
		let controls = this.el(doc, "div", "zs-workspace-actions");
		let button = (label, click) => {
			let node = this.el(doc, "button", "zs-reading-tool", label); node.type = "button";
			node.addEventListener("click", click); controls.append(node); return node;
		};
		if (note) button("View " + kind.toLowerCase(), () => {
			body.querySelector(".zs-workspace-view")?.remove();
			let content = this.el(doc, "div", "zs-workspace-view");
			let text = this.readingNoteMarkdown(note);
			this.renderMarkdown(doc, content, text); body.append(content);
			if (kind === "Contents") {
				for (let entry of this.readingArtifactData(note)?.entries || []) {
					if (Number.isInteger(entry.pageIndex)) {
						let link = this.el(doc, "button", "zs-reading-tool", "Open " + entry.title);
						link.addEventListener("click", () => this.navigateReading(view, entry).catch(e => this.appendError(view, e.message)));
						content.append(link);
					}
				}
			}
		});
		let generate = button(note ? "Update " + kind.toLowerCase() : action === "contents" ? "Initialize contents" : "Summarize paper", () => {
			panel.remove();
			this.startRequest(view, action === "contents" ? "Initialize the actual book contents without chapter summaries." : "Generate or update the paper summary using scientific-paper-reading.", [], [], { readingAction: action });
		});
		generate.disabled = this._pending.has(ctx.dir);
		button("Go to questions", () => panel.remove());
		body.append(this.el(doc, "p", null, action === "contents" ? "Initialize structure from the actual contents. Chapter summaries are generated only when you ask." : "Choose whether to summarize first or ask immediately. Existing summaries are saved as editable Zotero notes."), controls);
		let records = (ctx.paperItem.getNotes?.() || []).map(id => Zotero.Items.get(id)).filter(n => n && n.getTags().some(t => t.tag === "AbstractIn") && !n.getTags().some(t => t.tag.startsWith("AbstractIn:")));
		let recap = this.el(doc, "div", "zs-workspace-recap");
		recap.append(this.el(doc, "h3", null, "Previous discussions and open questions"));
		let count = 0;
		for (let record of records.slice().reverse()) {
			let template = doc.createElement("template"); template.innerHTML = record.getNote();
			if (![...template.content.querySelectorAll("p")].some(p => p.textContent === "Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key)) continue;
			let title = template.content.querySelector("h1")?.textContent || record.key;
			let questions = [...template.content.querySelectorAll("li")].map(n => n.textContent);
			let discussion = [...template.content.querySelectorAll("h2")].find(n => n.textContent === "Discussion");
			let conclusion = discussion?.parentElement.textContent.replace(/^Discussion/, "").trim().slice(0, 450) || "";
			recap.append(this.el(doc, "p", null, title + (conclusion ? " — " + conclusion : "") + (questions.length ? " — Open: " + questions.join("; ") : "")));
			if (++count >= 5) break;
		}
		if (!count) recap.append(this.el(doc, "p", null, "No recorded discussions for this attachment yet."));
		body.append(recap); panel.append(head, body); root.append(panel);
	},
});
