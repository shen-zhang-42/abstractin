"use strict";

// AbstractIn owns document identity, UI, agent transport and Zotero records.
// Reading strategies remain in the user's original, locally installed skills.
Object.assign(Zusia, {
	_readingStates: new Map(),

	readingType(item) {
		if (item.itemType === "book") return "book";
		if (["journalArticle", "conferencePaper", "preprint"].includes(item.itemType)) return "paper";
		return "";
	},

	readingSkillName(type) {
		if (type === "book") return "book-reading";
		if (type === "paper") return "scientific-paper-reading";
		throw new Error("Choose Book or Scientific paper.");
	},

	async findReadingSkill(type) {
		let name = type === "extraction" ? "scientific-information-extraction" : this.readingSkillName(type);
		let env = Subprocess.getEnvironment();
		let home = env.USERPROFILE || env.HOME || "";
		let configured = (this.getPref("readingSkillsDir") || "").trim();
		let roots = configured ? [configured] : [
			OS.Path.join(home, ".codex", "skills"), OS.Path.join(home, ".agents", "skills"),
		];
		let directories = name === "book-reading" ? ["book-reading", "scientific-book-reading"] : [name];
		for (let root of roots) {
			for (let directory of directories) {
				let path = OS.Path.join(root, directory, "SKILL.md");
				if (await OS.File.exists(path)) {
					let content = await Zotero.File.getContentsAsync(path);
					if (!content.trim()) throw new Error(name + "/SKILL.md is empty.");
					return { path, content };
				}
			}
		}
		if (!configured && this.rootURI && Zotero.getMainWindow().fetch) {
			let root = await this.installBundledReadingSkills();
			let directory = name === "book-reading" ? "scientific-book-reading" : name;
			let path = OS.Path.join(root, directory, "SKILL.md");
			return { path, content: await Zotero.File.getContentsAsync(path) };
		}
		throw new Error("Could not find " + name + "/SKILL.md. Set the reading skills folder to the directory containing both original skills.");
	},

	async installBundledReadingSkills() {
		if (!this._bundledSkills) {
			this._bundledSkills = (async () => {
				let win = Zotero.getMainWindow();
				let read = async url => {
					let response = await win.fetch(url);
					if (!response.ok) throw new Error("Could not read bundled skill resource: " + url);
					return response.text();
				};
				let catalog = JSON.parse(await read((this.resourceURI || this.rootURI) + "content/reading-skill-assets.json"));
				let resources = this.rootURI.startsWith("file:") ? new win.URL("../skills/", this.rootURI).href : (this.resourceURI || this.rootURI) + "skills/";
				let cache = OS.Path.join(this.getDataDir(), "skill-cache");
				let root = OS.Path.join(cache, this.version || "development");
				await Zotero.File.createDirectoryIfMissingAsync(cache);
				await Zotero.File.createDirectoryIfMissingAsync(root);
				for (let relative of catalog.files) {
					let parts = relative.split("/");
					if (parts.length !== 2 || parts.some(p => !p || p === "." || p === "..")) throw new Error("Invalid skill resource path.");
					let directory = OS.Path.join(root, parts[0]);
					await Zotero.File.createDirectoryIfMissingAsync(directory);
					await Zotero.File.putContentsAsync(OS.Path.join(directory, parts[1]), await read(resources + relative));
				}
				return root;
			})();
		}
		try { return await this._bundledSkills; }
		catch (e) { this._bundledSkills = null; throw e; }
	},

	async stageReadingSkill(ctx, skill, name) {
		let root = OS.Path.join(ctx.dir, ".agents");
		let skills = OS.Path.join(root, "skills");
		let target = OS.Path.join(skills, name);
		for (let directory of [root, skills, target]) await Zotero.File.createDirectoryIfMissingAsync(directory);
		let source = skill.path.replace(/[\\/]SKILL\.md$/, "");
		let copy = async (from, to) => {
			let iterator = new OS.File.DirectoryIterator(from);
			let entries = [];
			try {
				await iterator.forEach(entry => entries.push(entry));
			}
			finally { iterator.close(); }
			for (let entry of entries) {
				if (entry.isSymLink) throw new Error("Skill resources must not contain symbolic links: " + entry.name);
				let destination = OS.Path.join(to, entry.name);
				if (entry.isDir) {
					await Zotero.File.createDirectoryIfMissingAsync(destination);
					await copy(entry.path, destination);
				}
				else await OS.File.copy(entry.path, destination);
			}
		};
		await copy(source, target);
		return OS.Path.join(target, "SKILL.md");
	},

	async prepareReadingSkills(ctx) {
		let skill = await this.findReadingSkill(ctx.reading.type);
		let skillPath = await this.stageReadingSkill(ctx, skill, this.readingSkillName(ctx.reading.type));
		let extractionSkillPath;
		if (ctx.reading.type === "paper") {
			let extraction = await this.findReadingSkill("extraction");
			extractionSkillPath = await this.stageReadingSkill(ctx, extraction, "scientific-information-extraction");
		}
		return { ...ctx.reading, skillPath, extractionSkillPath };
	},

	readingAttachments(ctx) {
		let items = ctx.paperItem.getAttachments ? ctx.paperItem.getAttachments().map(id => Zotero.Items.get(id)) : [];
		if (ctx.attachmentItem && !items.some(item => item && item.id === ctx.attachmentItem.id)) items.push(ctx.attachmentItem);
		return items.filter(item => item && item.isPDFAttachment && item.isPDFAttachment());
	},

	async openReadingSetup(root) {
		let view = this._views.get(root);
		if (!view || this._pending.has(view.ctx.dir)) return;
		root.querySelector(".zs-panel")?.remove();
		let doc = view.doc;
		let panel = this.el(doc, "div", "zs-panel zs-reading-panel");
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", "Start Reading");
		let head = this.el(doc, "div", "zs-panel-head");
		head.append(this.el(doc, "div", "zs-panel-title", "Start Reading"),
			this.iconButton(doc, "zs-small", "Close", "close", () => panel.remove()));
		let body = this.el(doc, "div", "zs-panel-body zs-reading-form");
		let field = (title, control) => {
			let label = this.el(doc, "label", "zs-reading-field");
			label.append(this.el(doc, "span", null, title), control);
			body.appendChild(label);
			return control;
		};
		let attachments = this.readingAttachments(view.ctx);
		let reader = this.readerFor(view.ctx, doc.defaultView);
		let active = attachments.find(item => item.id === reader?.itemID) || view.ctx.attachmentItem;
		let attachment = field("PDF attachment", this.select(doc,
			attachments.map(item => [String(item.id), this.safeField(item, "title") || item.key]), String(active?.id || ""), () => {}));
		let previous = view.ctx.reading || {};
		if (!view.ctx.reading && active) {
			try {
				let dir = OS.Path.join(this.getDataDir(), view.ctx.paperItem.libraryID + "-" + view.ctx.paperItem.key, "reading-" + active.key);
				previous = JSON.parse(await Zotero.File.getContentsAsync(OS.Path.join(dir, "reading.json")));
			}
			catch (e) { /* First use has no previous document preferences. */ }
		}
		let type = field("Material type", this.select(doc,
			[["", "Choose material type…"], ["book", "Book"], ["paper", "Scientific paper"]],
			previous.type || this.readingType(view.ctx.paperItem), () => {}));
		let folder = field("Reading skills folder (optional)", this.el(doc, "input"));
		let modelControl = field("Codex model (empty uses local Default)", this.codexModelInput(doc));
		folder.type = "text";
		folder.value = this.getPref("readingSkillsDir") || "";
		folder.placeholder = "Default: your local .codex/skills folder";
		let status = this.el(doc, "div", "zs-notice");
		status.setAttribute("role", "status");
		body.append(this.el(doc, "p", null,
			"Uses your local Codex and original reading skill. Leave the folder empty to use local skills or the bundled originals. Start with a selected passage; no summary is generated automatically."));
		let start = this.readingButton(doc, "zs-reading-confirm", async () => {
			start.disabled = true;
			status.textContent = "Checking local Codex and reading skill…";
			try {
				this.saveCodexModel(modelControl.querySelector("input").value);
				let selected = attachments.find(item => String(item.id) === attachment.value);
				if (!selected) throw new Error("This item needs a PDF attachment before reading can start.");
				this.readingSkillName(type.value);
				this.setPref("readingSkillsDir", folder.value.trim());
				await this.findBinary("codex");
				let skill = await this.findReadingSkill(type.value);
				if (type.value === "paper") await this.findReadingSkill("extraction");
				if (this._views.get(root) !== view) return;
				await this.activateReading(view, selected, { type: type.value, skillPath: skill.path });
				panel.remove();
			}
			catch (e) { status.textContent = e.message || String(e); }
			finally { start.disabled = false; }
		});
		start.disabled = !attachments.length;
		if (!attachments.length) status.textContent = "Attach a PDF to the Zotero item first.";
		body.append(start, status);
		panel.append(head, body);
		if (this._views.get(root) !== view) return;
		root.querySelector(".zs-panel")?.remove();
		root.appendChild(panel);
		type.focus();
	},

	async activateReading(view, attachment, options) {
		if (this._pending.has(view.ctx.dir)) throw new Error("Wait for the current answer or stop it before changing reading settings.");
		let parent = attachment.parentItem || attachment;
		if (parent.id !== view.ctx.paperItem.id || !parent.isRegularItem()) {
			throw new Error("Choose a PDF stored under a regular Zotero book or paper item.");
		}
		let baseDir = OS.Path.join(this.getDataDir(), parent.libraryID + "-" + parent.key);
		let dir = OS.Path.join(baseDir, "reading-" + attachment.key);
		await Zotero.File.createDirectoryIfMissingAsync(dir);
		options = await this.prepareReadingSkills({ dir, reading: options });
		if (this._pending.has(view.ctx.dir) || this._pending.has(dir)) throw new Error("This PDF already has an active reading request.");
		let previous = {};
		try { previous = JSON.parse(await Zotero.File.getContentsAsync(OS.Path.join(dir, "reading.json"))); }
		catch (e) { /* First use has no preferences to restore. */ }
		if (previous.type !== options.type) await this.saveSessions(dir, {});
		// Language comes from the shared plugin preference, never document preferences.
		delete options.language;
		await Zotero.File.putContentsAsync(OS.Path.join(dir, "reading.json"), JSON.stringify({
			type: options.type, itemKey: parent.key, attachmentKey: attachment.key,
		}));
		this._readingStates.set(attachment.id, options);
		view.ctx = { paperItem: parent, attachmentItem: attachment, dir, reading: options };
		this.setPref("backend", "codex");
		this.updateControls(view.root);
		this.renderPaperChip(view.root, this.paperInfo(view.ctx));
		this.renderMessages(view, await this.loadHistory(dir));
		this.renderAttachments(view);
		this.updateReadingControls(view);
		let draft = this._drafts.get(baseDir);
		if (draft?.selection?.attachmentID === attachment.id) {
			this._drafts.delete(baseDir);
			this._drafts.set(dir, draft);
		}
		this.setBusy(view, false);
		this.applyDraft(view);
		view.input.focus();
	},

	async exportReadingRecords(ctx) {
		let doc = Zotero.getMainWindow().document;
		let records = [];
		let ids = ctx.paperItem.getNotes ? ctx.paperItem.getNotes() : [];
		for (let id of ids) {
			let note = Zotero.Items.get(id);
			if (!note || !note.getTags().some(tag => tag.tag === "AbstractIn")) continue;
			let template = doc.createElement("template");
			template.innerHTML = note.getNote();
			let text = [...template.content.querySelectorAll("h1, h2, h3, p, blockquote, li")].map(node => node.textContent).join("\n");
			if (!text.includes("attachment: " + ctx.attachmentItem.key)) continue;
			records.push("## Zotero note " + note.key + "\n" + text);
		}
		// This is derived from editable Zotero notes, never a competing editable record.
		let text = "# Saved reading records (derived from Zotero notes)\n\n" + records.slice(-20).join("\n\n").slice(-24000);
		await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "records.md"), text);
		return text;
	},

	updateReadingControls(view) {
		let reading = view.ctx.reading;
		let label = view.root.querySelector(".zs-reading-status");
		if (label) label.textContent = reading ?
			(reading.type === "book" ? "Book" : "Paper") + " · " + (this.getLanguage() || "Same as my question") + " · Codex" : "";
		let button = view.root.querySelector(".zs-start-reading");
		if (button) {
			button.setLabel("Start Reading");
			button.title = reading ? "Start Reading · change document or reading settings" : "Start Reading";
		}
		let quick = view.root.querySelector(".zs-quick");
		if (quick) quick.hidden = true;
	},

	readingPrompt(ctx, selection) {
		let reading = ctx.reading;
		let source = selection ? {
			selectedText: selection.text, printedPageLabel: selection.pageLabel || null,
			pdfPageIndex: selection.position?.pageIndex ?? null,
		} : null;
		return "AbstractIn reading session. Read and follow the original skill at " + JSON.stringify(reading.skillPath) +
			". Resolve its supporting resources relative to that skill directory; preserve the skill and its files. " +
			"Material type: " + reading.type + ". " + this.languageInstruction() + " " +
			(reading.type === "paper" ? "Use discuss mode; the user has skipped initial summarization for this minimal passage-reading session. " +
				"Use the original scientific-information-extraction skill at " + JSON.stringify(reading.extractionSkillPath) + " for narrow local checks. " :
				"This is an isolated selected-passage question, not a request to initialize a continuing whole-book workspace. ") +
			"Document identity: " + JSON.stringify({ libraryID: ctx.paperItem.libraryID, itemKey: ctx.paperItem.key, attachmentKey: ctx.attachmentItem.key }) + ". " +
			"Source for this question: " + JSON.stringify(source) + ". " +
			"Start from this selected passage or attached page. Do not infer printed page numbers from PDF indices. " +
			"Read records.md only when previous discussions help answer this question; it is a derived snapshot of the current Zotero notes. " +
			"Current Zotero notes take precedence over old conversation text when the user has corrected a record. " +
			"Cite the verified passage/page locations in your answer; identify supplementary reasoning separately. " +
			"If the source is insufficient, ask the user for the specific passage or page. " +
			"Do not automatically read chapters, generate chapter summaries, conduct external research, or write files. " +
			"Use the plugin's Zotero note storage boundary for discussion records rather than creating parallel editable workspace notes or reports. " +
			"Distinguish the author's argument from supplementary explanations. " +
			"Answer the user's question, then append exactly one <abstractin-record>JSON</abstractin-record> block. " +
			"The JSON must have title (short string), summary (a concise useful discussion record, at most 200 words), " +
			"and openQuestions (array of strings). Save only conclusions actually discussed, never infer mastery. " +
			"Use valid JSON escaping for LaTeX. The plugin saves this record as a Zotero note; this block is hidden from the conversation.";
	},

	async windowsCodexExecutable(path) {
		if (/\.exe$/i.test(path)) return path;
		// Search the actual npm installation, rather than attempting to execute a .cmd shim.
		let directory = path.replace(/[\\/][^\\/]+$/, "");
		let root = OS.Path.join(directory, "node_modules", "@openai", "codex");
		let search = async (folder, depth) => {
			if (depth > 7 || !(await OS.File.exists(folder))) return null;
			let iterator = new OS.File.DirectoryIterator(folder);
			let entries = [];
			try { await iterator.forEach(entry => entries.push(entry)); }
			finally { iterator.close(); }
			let binary = entries.find(entry => !entry.isDir && /^codex\.exe$/i.test(entry.name));
			if (binary) return binary.path;
			for (let entry of entries) {
				if (entry.isDir && !entry.isSymLink) {
					let found = await search(entry.path, depth + 1);
					if (found) return found;
				}
			}
			return null;
		};
		for (let folder of [root, OS.Path.join(directory, "node_modules", "@openai", "codex-win32-x64"),
			OS.Path.join(directory, "node_modules", "@openai", "codex-win32-arm64")]) {
			let native = await search(folder, 0);
			if (native) return native;
		}
		throw new Error("Zotero needs native codex.exe. Set extensions.abstractin.codexPath to the executable inside your Codex installation, rather than its .cmd or .ps1 wrapper.");
	},

	readingVisibleText(text) {
		text = String(text);
		let marker = "<abstractin-record>";
		let index = text.indexOf(marker);
		if (index >= 0) return text.slice(0, index).trimEnd();
		for (let length = marker.length - 1; length > 0; length--) {
			if (text.endsWith(marker.slice(0, length))) return text.slice(0, -length).trimEnd();
		}
		return text.trimEnd();
	},

	parseReadingAnswer(text) {
		let answer = this.readingVisibleText(text).trim();
		let match = String(text).match(/<abstractin-record>\s*([\s\S]*?)\s*<\/abstractin-record>\s*$/);
		if (!match) return { answer, record: null };
		try {
			let record = JSON.parse(match[1]);
			if (typeof record.title !== "string" || !record.title.trim() || typeof record.summary !== "string" ||
				!record.summary.trim() || record.summary.length > 6000 || !Array.isArray(record.openQuestions) ||
				!record.openQuestions.every(q => typeof q === "string")) return { answer, record: null };
			return { answer, record };
		}
		catch (e) { return { answer, record: null }; }
	},

	readingPDFLink(ctx, selection) {
		let library = Zotero.Libraries.get(ctx.paperItem.libraryID);
		let scope = library.libraryType === "group" ? "groups/" + Zotero.Groups.getGroupIDFromLibraryID(ctx.paperItem.libraryID) : "library";
		let index = selection?.position?.pageIndex;
		return "zotero://open-pdf/" + scope + "/items/" + ctx.attachmentItem.key +
			(Number.isInteger(index) && index >= 0 ? "?page=" + (index + 1) : "");
	},

	async saveReadingRecord(ctx, question, selection, record) {
		let note = new Zotero.Item("note");
		note.libraryID = ctx.paperItem.libraryID;
		note.parentID = ctx.paperItem.id;
		let doc = Zotero.getMainWindow().document;
		let wrapper = doc.createElement("div");
		wrapper.appendChild(this.el(doc, "h1", null, "AbstractIn — " + record.title));
		let add = text => wrapper.appendChild(this.el(doc, "p", null, text));
		add("Material: " + ctx.reading.type + " · " + new Date().toISOString());
		add("Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key);
		let link = this.el(doc, "a", null, "Open source PDF");
		link.href = this.readingPDFLink(ctx, selection);
		let source = this.el(doc, "p");
		source.appendChild(link);
		wrapper.appendChild(source);
		if (selection?.pageLabel) add("Printed page label: " + selection.pageLabel);
		if (Number.isInteger(selection?.position?.pageIndex)) add("PDF page index (zero-based): " + selection.position.pageIndex);
		if (selection?.text) wrapper.appendChild(this.el(doc, "blockquote", null, selection.text));
		add("Question: " + question);
		// Reuse upstream TeX-preserving note rendering; never insert agent HTML directly.
		let summary = this.noteHTML("Discussion", record.summary);
		let questions = "";
		if (record.openQuestions.length) {
			let list = this.el(doc, "ul");
			for (let text of record.openQuestions) list.appendChild(this.el(doc, "li", null, text));
			questions = "<h2>Open questions</h2>" + list.outerHTML;
		}
		note.setNote(wrapper.outerHTML + summary + questions);
		note.addTag("AbstractIn");
		await note.saveTx();
		return note.key;
	},
});
