"use strict";

// AbstractIn owns document identity, UI, agent transport and Zotero records.
// Reading strategies remain in the user's original, locally installed skills.
Object.assign(AbstractIn, {
	_readingStates: new Map(),

	getReadingEvidenceMode() {
		return this.getPref("readingEvidenceMode") === "knowledge" ? "knowledge" : "source";
	},

	requestsKnowledgeDiscussion(question) {
		return /(?:不要|别|无需|不需要|不用|禁止)(?:再|继续|反复|去|重新|主动|额外|直接|频繁|重复|\s)*(?:读取|阅读|读|搜索|检索|查阅|回看|回到)[^，。；,;]{0,12}(?:pdf|文档|原文|这本书|论文)/i.test(question) ||
			/(?:do not|don't|dont|stop|without)\s+(?:re-?reading|reading|read|searching|search|opening|open)[^.!?;]{0,40}(?:pdf|document|source|paper|file)/i.test(question);
	},

	requestsReadingSource(question) {
		// Mentioning a numbered theorem is not permission to read another chapter.
		return /\b(?:read|search|look up|look at|consult|check|verify)\b[^.!?;]{0,80}\b(?:pdf|document|source|paper|book|section|chapter|theorem|lemma|proof|passage)\b/i.test(question) ||
			/(?:阅读|读取|搜索|检索|查阅|查看|核对|看一下|去看|看看)[^，。；]{0,40}(?:pdf|文档|原文|书|论文|章节|节|定理|引理|证明|页)/i.test(question);
	},

	requestsCurrentReadingPage(question) {
		return /(?:当前页|这一页|这页|本页|当前页面|选中|选定)/.test(question) ||
			/\b(?:current|this)\s+page\b|\bselected\s+(?:text|passage)\b/i.test(question);
	},

	async reuseCurrentReadingPage(ctx) {
		let location = ctx.reading.currentPage;
		if (!location || location.verified) return;
		// Only reuse already loaded text. Never call getPage or read source-text
		// during an ordinary knowledge follow-up.
		let pdf = this.readingPDFApplication(ctx)?.pdfDocument;
		let cached = pdf && this._nativeReadingPages.get(pdf)?.get(location.pageIndex);
		if (!cached) return;
		try { ctx.reading.currentPage = { ...location, text: (await cached).slice(0, 12000), verified: true }; }
		catch (e) { this.logError("cached current page", e); }
	},

	async knowledgeReadingSource(ctx) {
		// Validate identity without extracting the entire document again.
		let signature = "knowledge:" + ctx.attachmentItem.key;
		try {
			let path = await ctx.attachmentItem.getFilePathAsync();
			if (path && await OS.File.exists(path)) {
				let stat = await OS.File.stat(path);
				signature = JSON.stringify([ctx.paperItem.libraryID, ctx.attachmentItem.key, path, stat.size,
					new Date(stat.lastModificationDate || stat.mtime).getTime()]);
				try {
					let cached = JSON.parse(await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-manifest.json")));
					if (cached.signature === signature && cached.status === "ready") return cached;
				}
				catch (e) { /* Knowledge discussion does not require a full-text cache. */ }
			}
		}
		catch (e) { this.logError("knowledge source identity", e); }
		return { status: "context-only", signature, attachmentKey: ctx.attachmentItem.key };
	},

	async exportReadingSource(ctx) {
		let attachment = ctx.attachmentItem;
		try {
			if (!attachment?.isPDFAttachment?.()) throw new Error("Choose a PDF attachment in Start Reading.");
			let path = await attachment.getFilePathAsync();
			if (!path || !(await OS.File.exists(path))) throw new Error("The selected PDF is not available locally. Download it in Zotero or repair its linked-file path.");
			let stat = await OS.File.stat(path);
			let signature = JSON.stringify([ctx.paperItem.libraryID, attachment.key, path, stat.size,
				new Date(stat.lastModificationDate || stat.mtime).getTime()]);
			let manifestPath = OS.Path.join(ctx.dir, "source-manifest.json");
			try {
				let cached = JSON.parse(await Zotero.File.getContentsAsync(manifestPath));
				if (cached.signature === signature && cached.status === "ready" &&
					await OS.File.exists(OS.Path.join(ctx.dir, "source-text.md")) && await OS.File.exists(OS.Path.join(ctx.dir, "source.pdf"))) return cached;
			}
			catch (e) { /* No reusable source cache. */ }
			if (!Zotero.PDFWorker?.getFullText) throw new Error("This Zotero version does not expose PDF text extraction.");
			await OS.File.copy(path, OS.Path.join(ctx.dir, "source.pdf"));
			let result = await Zotero.PDFWorker.getFullText(attachment.id, null, true);
			if (!Number.isInteger(result?.totalPages) || result.totalPages < 1 || result.extractedPages !== result.totalPages) throw new Error("PDF text extraction did not cover every page. Try again or provide the relevant passage.");
			if (typeof result?.text !== "string" || !result.text.trim()) throw new Error("The PDF has no extractable text. It may be a scanned document; run OCR or attach the relevant page image.");
			let after = await OS.File.stat(path);
			if (after.size !== stat.size || new Date(after.lastModificationDate || after.mtime).getTime() !== new Date(stat.lastModificationDate || stat.mtime).getTime()) {
				throw new Error("The PDF changed during extraction. Please try again.");
			}
			let pages = result.text.split("\f");
			let pageMapping = Number.isInteger(result.extractedPages) && pages.length === result.extractedPages;
			let text = "# Extracted PDF text\n\nAttachment: " + attachment.key + "\n\n" +
				"Physical PDF pages and zero-based pageIndex are separate from printed page labels. Printed labels must be verified in the source.\n\n";
			text += pageMapping ? pages.map((page, index) => "## PDF page " + (index + 1) + "; pageIndex " + index + "\n\n" + (page.trim() || "[No extractable text on this page]")).join("\n\n") :
				"Page boundaries could not be verified. Do not infer page indices from this text.\n\n" + result.text;
			await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-text.md"), text);
			let source = { status: "ready", signature, attachmentKey: attachment.key,
				totalPages: result.totalPages, extractedPages: result.extractedPages, pageMapping,
				pdf: "source.pdf", text: "source-text.md" };
			await Zotero.File.putContentsAsync(manifestPath, JSON.stringify(source));
			this.log("PDF source ready: " + attachment.key + ", " + result.extractedPages + "/" + result.totalPages + " pages, " + result.text.length + " characters");
			return source;
		}
		catch (e) {
			this.logError("exportReadingSource", e);
			return { status: "unavailable", attachmentKey: attachment?.key, error: String(e.message || e) };
		}
	},

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
		if (!view || this._pending.has(view.ctx.dir) || view.readingSetup) return;
		let attachments = this.readingAttachments(view.ctx);
		let reader = this.readerFor(view.ctx, view.doc.defaultView);
		let active = attachments.find(item => item.id === reader?.itemID) || view.ctx.attachmentItem;
		view.readingSetup = { step: "title", attachments, attachment: attachments.find(item => item.id === active?.id) || attachments[0],
			type: this.readingType(view.ctx.paperItem), title: this.safeField(view.ctx.paperItem, "title") || "", goal: "" };
		view.root.dataset.readingIntro = "true";
		let welcome = view.logEl.querySelector(".abstractin-empty");
		if (welcome) welcome.querySelector(".abstractin-start-reading")?.remove();
		else {
			welcome = this.el(view.doc, "div", "abstractin-empty abstractin-reading-welcome");
			welcome.append(this.svgIcon(view.doc, this.MASCOTS[this.getAppearance().mascot].icon, "abstractin-mascot"),
				this.el(view.doc, "div", "abstractin-empty-title", "let's start reading"));
			view.logEl.appendChild(welcome);
		}
		this.updateControls(root);
		this.appendReadingSetupQuestion(view);
		this.setBusy(view, false);
		view.input.focus();
	},

	appendReadingSetupQuestion(view, error = "") {
		let state = view.readingSetup;
		if (!state) return;
		view.logEl.querySelectorAll(".abstractin-reading-choices button").forEach(button => { button.disabled = true; });
		let card = this.el(view.doc, "div", "abstractin-msg abstractin-assistant abstractin-reading-setup-question");
		let choices = [];
		let question;
		if (error) { question = error; choices = [["Try again", "retry"]]; }
		else if (!state.attachments.length) {
			question = "Please attach a PDF to this Zotero item, then let me check again.";
			choices = [["Check for PDF", "refresh-pdf"]];
		}
		else if (state.step === "title") {
			question = state.title ? "Are we reading “" + state.title + "”? Confirm it, or tell me the title you want to use." : "What book or paper are we reading? Tell me its title.";
			if (state.title) choices = [["Yes, this one", state.title]];
		}
		else if (state.step === "type") {
			question = "Is this a book or a scientific paper?";
			choices = state.type === "paper" ? [["Scientific paper", "paper"], ["Book", "book"]] : [["Book", "book"], ["Scientific paper", "paper"]];
		}
		else if (state.step === "attachment") {
			question = "Which PDF should we read?";
			choices = state.attachments.map(item => [this.safeField(item, "title") || item.key, String(item.id)]);
		}
		else {
			question = "Where would you like to begin, or what would you like to understand? You can also start at the current page.";
			choices = [["Start at the current page", "skip"]];
		}
		card.appendChild(this.el(view.doc, "p", null, question));
		let buttons = this.el(view.doc, "div", "abstractin-reading-choices");
		for (let [label, answer] of choices) {
			let button = this.el(view.doc, "button", "abstractin-reading-choice", label);
			button.type = "button";
			button.addEventListener("click", () => this.answerReadingSetup(view, answer, label));
			buttons.appendChild(button);
		}
		card.appendChild(buttons);
		card.setAttribute("aria-live", "polite");
		view.logEl.appendChild(card);
		view.input.placeholder = state.step === "title" ? "Tell me the book or paper title…" : state.step === "type" ? "Book or scientific paper…" : state.step === "attachment" ? "Choose a PDF above, or enter its name…" : "Where shall we begin?";
		this.scrollToEnd(view.logEl);
	},

	async answerReadingSetup(view, answer, label = answer) {
		let state = view.readingSetup;
		answer = String(answer || "").trim();
		if (!state || state.busy || !answer) return;
		if (!state.attachments.length) {
			if (answer === "refresh-pdf") { delete view.readingSetup; await this.openReadingSetup(view.root); }
			return;
		}
		if (state.step !== "ready") {
			if (state.step === "type") {
				let type = /^(book|书|书籍|图书|教材)$/i.test(answer) ? "book" : /^(paper|scientific paper|论文|科学论文|科研论文)$/i.test(answer) ? "paper" : "";
				if (!type) { this.appendReadingSetupQuestion(view); return; }
				state.type = type;
			}
			if (state.step === "attachment") {
				let matches = state.attachments.filter(item => String(item.id) === answer || item.key === answer || this.safeField(item, "title") === answer);
				if (matches.length !== 1) { this.appendReadingSetupQuestion(view); return; }
				state.attachment = matches[0];
			}
			view.logEl.querySelectorAll(".abstractin-reading-choices button").forEach(button => { button.disabled = true; });
			view.logEl.appendChild(this.el(view.doc, "div", "abstractin-msg abstractin-user abstractin-reading-setup-answer", label));
			view.input.value = "";
			this.autoGrow(view.input);
			if (state.step === "title") { state.title = answer; state.step = "type"; }
			else if (state.step === "type") state.step = state.attachments.length > 1 ? "attachment" : "goal";
			else if (state.step === "attachment") state.step = "goal";
			else { state.goal = answer === "skip" ? "" : answer; state.step = "ready"; }
			if (state.step !== "ready") { this.appendReadingSetupQuestion(view); this.setBusy(view, false); return; }
		}
		state.busy = true;
		view.input.disabled = true;
		view.root.querySelector(".abstractin-send").disabled = true;
		let status = this.el(view.doc, "div", "abstractin-notice abstractin-reading-setup-progress", "Getting ready to read…");
		status.setAttribute("role", "status");
		view.logEl.appendChild(status);
		try {
			let agent = this.readingAgent();
			await this.findBinary(agent);
			await this.assertAgentReadingReady(agent, this.getReadingEvidenceMode());
			let skill = await this.findReadingSkill(state.type);
			if (state.type === "paper") await this.findReadingSkill("extraction");
			if (this._views.get(view.root) !== view || view.readingSetup !== state) return;
			await this.activateReading(view, state.attachment, { type: state.type, title: state.title, goal: state.goal, skillPath: skill.path });
			delete view.readingSetup;
			view.root.dataset.readingIntro = "false";
			this.updateControls(view.root);
			await this.beginReadingWorkflow(view, { showWorkspace: false });
		}
		catch (e) {
			status.remove();
			if (this._views.get(view.root) === view) {
				if (view.readingSetup) this.appendReadingSetupQuestion(view, e.message || String(e));
				else this.appendError(view, e.message || String(e));
			}
		}
		finally {
			state.busy = false;
			if (this._views.get(view.root) === view) { this.setBusy(view, this._pending.has(view.ctx.dir)); view.input.focus(); }
		}
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
			type: options.type, title: options.title || "", goal: options.goal || "", itemKey: parent.key, attachmentKey: attachment.key,
		}));
		this._readingStates.set(attachment.id, options);
		view.ctx = { paperItem: parent, attachmentItem: attachment, dir, reading: options,
			reader: view.ctx.reader?.itemID === attachment.id ? view.ctx.reader : this.readerFor({ paperItem: parent, attachmentItem: attachment }, view.doc.defaultView) };
		this.registerChatContext(view.ctx);
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
			let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template");
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
		let evidence = view.root.querySelector(".abstractin-reading-evidence-mode");
		if (evidence) {
			let mode = this.getReadingEvidenceMode();
			evidence.hidden = !reading;
			evidence.dataset.mode = mode;
			let label = mode === "knowledge" ? "Knowledge discussion" : "Source verification";
			evidence.title = label + " — change reading discussion mode";
			evidence.setAttribute("aria-label", evidence.title);
			let icon = mode === "knowledge" ? "readingKnowledge" : "readingSource";
			let current = evidence.querySelector(".abstractin-i:not(.abstractin-chevron)");
			if (current?.dataset.icon !== icon) current?.replaceWith(this.svgIcon(view.doc, icon));
		}
		let label = view.root.querySelector(".abstractin-reading-status");
		if (label) label.textContent = reading ?
			(reading.type === "book" ? "Book" : "Paper") + " · " + (this.getLanguage() || "Same as my question") + " · " + this.BACKENDS[this.readingAgent()].label : "";
		let button = view.root.querySelector(".abstractin-start-reading");
		if (button) {
			button.setLabel("Start Reading");
			button.title = "Start Reading";
			button.hidden = !!reading || !!view.readingSetup || view.root.dataset.chatting === "true";
		}
		let tools = view.root.querySelector(".abstractin-reading-tools");
		if (tools) tools.hidden = !reading;
		let workspace = view.root.querySelector(".abstractin-reading-workspace");
		if (workspace && reading) workspace.textContent = reading.type === "book" ? "Contents & records" : "Summary & records";
		let resume = view.root.querySelector(".abstractin-reading-resume-here");
		if (resume) resume.hidden = !reading?.referenceNavigation;
		let sourceStatus = view.root.querySelector(".abstractin-reading-source-status");
		if (sourceStatus) sourceStatus.textContent = reading && this.getReadingEvidenceMode() === "knowledge" ?
			"Knowledge discussion · context first · verify sources when needed" : reading?.pdfSource ? (reading.pdfSource.status === "ready" ?
			"PDF text ready · " + reading.pdfSource.extractedPages + "/" + reading.pdfSource.totalPages + " pages" +
			(reading.pdfSource.pageMapping ? "" : " · page links unverified") : reading.pdfSource.status === "context-only" ?
			"Discussion context ready · full PDF text not loaded" : "PDF text unavailable — use a selected passage or page image") : "";
		let quick = view.root.querySelector(".abstractin-quick");
		let type = reading?.type === "book" ? "book" : "paper";
		if (quick && quick.dataset.materialType !== type) { this.closeMenu(view.root); this.renderQuickPrompts(view.root, quick); }
	},

	readingPrompt(ctx, selection) {
		let reading = ctx.reading;
		let introduction = "Reader-confirmed title and reading goal (context, not source evidence): " + JSON.stringify({ title: reading.title || "", goal: reading.goal || "" }) + ". ";
		if (reading.evidenceMode === "knowledge" && (!reading.action || reading.action === "discuss")) {
			return "AbstractIn Knowledge discussion. " + introduction + this.languageInstruction() +
				" Answer from the supplied current page/selection, saved notes and previous conversation, supplemented by your existing knowledge. " +
				"Do not open or search the PDF, source-text.md, skills or workspace files for this discussion. No file tools are needed. " +
				(reading.forbidSource ?
					"The user explicitly prohibited document access for this turn. If document-specific evidence is missing, explain that limitation and ask for the passage; do not guess or request tools. " :
					"If the supplied context cannot establish a document-specific statement, exact quotation, section, theorem, experiment or page location, output ONLY <abstractin-source-needed>brief description of the missing evidence</abstractin-source-needed>. The plugin will verify the original source automatically before answering. Never guess a numbered theorem or claim it follows from general knowledge. ") +
				"Write formulas as $...$ or $$...$$ (or standard LaTeX math delimiters), without wrapping the answer in a code fence. Use standard LaTeX commands supported by KaTeX; avoid undefined custom macros such as \\ThetaSpace and write the intended symbol explicitly. " +
				"Label independent explanations and alternative derivations naturally. Do not claim that generic knowledge was verified in this document. " +
				"Document identity: " + JSON.stringify({ itemKey: ctx.paperItem.key, attachmentKey: ctx.attachmentItem.key }) + ". " +
				"Supplied passage: " + JSON.stringify(selection || null) + ". Current page: " + JSON.stringify(reading.currentPage || null) + ". " +
				"Current editable Zotero notes take precedence over older chat: " + JSON.stringify(reading.knowledgeContext || "No saved notes.") + ". " +
				"Answer, then append exactly one <abstractin-record>JSON</abstractin-record> block with title, summary (concise discussed conclusions), " +
				"openQuestions (array), topicKey (stable lowercase hyphenated identifier), and scope {level: book|paper|chapter|section, id: verified contents ID or empty, title: scope title or empty}. " +
				"For follow-ups merge existing valid conclusions on the same topic, noting corrections. Do not infer mastery. " +
				"Use sources: [] unless quoting the supplied verified current page exactly; then use {pageIndex: supplied zero-based index, quote: exact supplied excerpt}. " +
				"Escape LaTeX correctly in JSON. Do not write files or perform external research.";
		}
		if (reading.action === "contents") return "AbstractIn book contents initialization. Read the original book-reading skill at " + JSON.stringify(reading.skillPath) +
			" and use only its structure initialization workflow. " + this.languageInstruction() +
			" Document identity: " + JSON.stringify({ libraryID: ctx.paperItem.libraryID, itemKey: ctx.paperItem.key, attachmentKey: ctx.attachmentItem.key }) + ". " +
			"PDF source status: " + JSON.stringify(reading.pdfSource || {}) + ". " +
			"Begin with contents-source.md, a bounded candidate excerpt copied from source-text.md. If it does not include the actual contents, search source-text.md for the contents heading and inspect only those pages. " +
			"Existing contents corrections are in workspace.md, derived from the current Zotero note. Recheck changed headings against the actual source. " +
			"Extract verified structure only. Do not read chapter openings, locate every chapter's physical page, or generate summaries. " +
			"The plugin creates folders and saves the authoritative Zotero contents note. Do not write files, use a browser bridge, or conduct external research. " +
			"Use the abstractin-workspace output schema in the action instructions. Do not emit abstractin-record.";
		let source = selection ? {
			selectedText: selection.text, printedPageLabel: selection.pageLabel || null,
			pdfPageIndex: selection.position?.pageIndex ?? null,
		} : null;
		return introduction + "AbstractIn reading session. Read and follow the original skill at " + JSON.stringify(reading.skillPath) +
			". Resolve its supporting resources relative to that skill directory; preserve the skill and its files. " +
			"Material type: " + reading.type + ". " + this.languageInstruction() + " " +
			(reading.type === "paper" ? (reading.action === "summary" ? "Use initial read mode; the user approved this paper summary. " : "Use discuss mode; use the saved summary when available. ") +
				"Use the original scientific-information-extraction skill at " + JSON.stringify(reading.extractionSkillPath) + " for narrow local checks. " :
			"Follow the book-reading source-scope discipline; initialize structure only when requested by the plugin. ") +
			"Document identity: " + JSON.stringify({ libraryID: ctx.paperItem.libraryID, itemKey: ctx.paperItem.key, attachmentKey: ctx.attachmentItem.key }) + ". " +
			"Source for this question: " + JSON.stringify(source) + ". " +
			"Current reader location: " + JSON.stringify(reading.currentPage || null) + ". " +
			"For 'this', an unnamed equation or a proof step, start at this current page when no passage is selected. If the reference stays ambiguous, ask which passage; do not infer it. " +
			(reading.currentPage?.verified ? "The current page above was read directly at its physical PDF index. Its complete text is in current-page.md when file is specified. For a current-page question, answer from this supplied text first; do not search source-text.md or scan the book unless a specific missing dependency requires it. Cite this verified zero-based pageIndex in record sources. " : "") +
			"Existing contents and paper summary are in workspace.md, derived from authoritative Zotero notes. For current-page questions use the supplied current page first; for broader paper discussion use the saved summary and verify missing details in source-text.md. " +
			"PDF source status: " + JSON.stringify(reading.pdfSource || { status: "not checked" }) + ". " +
			"When PDF source status is ready, source.pdf is the exact attachment and source-text.md contains its extracted text in this working directory. " +
			"Read the requested portions of source-text.md using local file tools; you do not need a Zotero browser or reader tool to access it. " +
			(reading.sourceLookup ? "This turn automatically verifies missing evidence from Knowledge discussion. Search the exact requested theorem/section/claim, read only its statement and relevant nearby definitions or proof, and answer from that evidence. Use cached source-text.md first; do not scan the whole book or perform general initialization. If the passage cannot be found, say so and ask for clarification rather than guessing. " : "") +
			"For a book overview, inspect the actual contents and chapter openings; for a chapter or proof question, locate the requested section and its dependencies. " +
			"Start from the selected passage or attached page when supplied. Expand only to answer the user's request, not by reading the whole book by default. " +
			"Do not claim to have read content you have not inspected, or to have verified a whole-book synthesis from metadata or highlights alone. " +
			"A ready text source does not guarantee accurate formula or diagram extraction; request a page image when needed. " +
			"When source status is unavailable, state its error and use only the supplied passage or image. Never use a previous source cache as current evidence. " +
			"Do not infer printed page numbers from PDF indices. " +
			"Read records.md only when previous discussions help answer this question; it is a derived snapshot of the current Zotero notes. " +
			"Current Zotero notes take precedence over old conversation text when the user has corrected a record. " +
			"Cite the verified passage/page locations in your answer; identify supplementary reasoning separately. " +
			"If the source is insufficient, ask the user for the specific passage or page. " +
			"Generate summaries only when the user requests them. Do not conduct external research or write files. " +
			"Use the plugin's Zotero note storage boundary for discussion records rather than creating parallel editable workspace notes or reports. " +
			"Distinguish the author's argument from supplementary explanations. " +
			(reading.action === "summary" ? "For this summary use only the abstractin-workspace output schema in the action instructions.\n" :
			"Answer the user's question, then append exactly one <abstractin-record>JSON</abstractin-record> block. " +
			"The JSON must have title (short string), summary (a concise useful discussion record, at most 200 words), " +
			"and openQuestions (array of strings). Save only conclusions actually discussed, never infer mastery. " +
			'Also provide scope {"level":"book|chapter|section|paper","id":"verified contents entry id or empty","title":"scope title or empty"} and a stable topicKey using lowercase letters, digits and hyphens. ' +
			"Use the narrowest verified shared scope; keep book/paper scope if location is unclear. For follow-up discussion use the same scope and topicKey, " +
			"or updateNoteKey from records.md, and return a merged concise record that preserves prior valid conclusions and explicitly notes corrections. " +
			'For newly retrieved source passages, also provide sources [{"pageIndex":0,"printedPageLabel":null,"quote":"exact extracted source excerpt"}], at most 10. ' +
			"Cite only verified physical page indices; use null for an unverified printed label. Existing selected-passage locations are supplied by Zotero. " +
			"Use valid JSON escaping for LaTeX. The plugin saves this record as a Zotero note; this block is hidden from the conversation.");
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
		for (let marker of ["<abstractin-record>", "<abstractin-workspace>", "<abstractin-source-needed>"]) {
			let index = text.indexOf(marker);
			if (index >= 0) text = text.slice(0, index);
			for (let length = marker.length - 1; length > 0; length--) {
				if (text.endsWith(marker.slice(0, length))) { text = text.slice(0, -length); break; }
			}
		}
		return text.trimEnd();
	},

	parseReadingAnswer(text) {
		let answer = this.readingVisibleText(text).trim();
		try {
			let record = this.readingEnvelope(text, "record");
			if (!record) return { answer, record: null };
			if (typeof record.title !== "string" || !record.title.trim() || typeof record.summary !== "string" ||
				!record.summary.trim() || record.summary.length > 6000 || !Array.isArray(record.openQuestions) ||
				!record.openQuestions.every(q => typeof q === "string")) return { answer, record: null };
			return { answer, record };
		}
		catch (e) { return { answer, record: null }; }
	},

	readingEnvelope(text, kind) {
		let blocks = [...String(text).matchAll(new RegExp("<abstractin-" + kind + ">\\s*([\\s\\S]*?)\\s*</abstractin-" + kind + ">", "g"))];
		if (blocks.length !== 1) return null;
		return JSON.parse(blocks[0][1].trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1"));
	},

	readingPDFLink(ctx, selection) {
		let library = Zotero.Libraries.get(ctx.paperItem.libraryID);
		let scope = library.libraryType === "group" ? "groups/" + Zotero.Groups.getGroupIDFromLibraryID(ctx.paperItem.libraryID) : "library";
		let index = selection?.position?.pageIndex;
		return "zotero://open-pdf/" + scope + "/items/" + ctx.attachmentItem.key +
			(Number.isInteger(index) && index >= 0 ? "?page=" + (index + 1) : "");
	},

	async saveReadingRecord(ctx, question, selection, record) {
		let notices = [];
		let candidates = Array.isArray(record.sources) ? record.sources.slice(0, 10) : [];
		let sources = [];
		let sourceText = "";
		if (candidates.length && ctx.reading.evidenceMode !== "knowledge" && ctx.reading.pdfSource?.status === "ready") {
			try { sourceText = await Zotero.File.getContentsAsync(OS.Path.join(ctx.dir, "source-text.md")); }
			catch (e) { this.logError("record source verification", e); }
		}
		let normalize = text => text.normalize("NFKC").replace(/[\u00ad\u200b]/g, "").replace(/\s+/g, " ").trim();
		let normalizedSource = normalize(sourceText);
		let unlocated = 0, omitted = 0;
		for (let candidate of candidates) {
			if (!candidate || typeof candidate.quote !== "string" || !candidate.quote.trim() || candidate.quote.length > 3000) { omitted++; continue; }
			let source = { ...candidate, printedPageLabel: typeof candidate.printedPageLabel === "string" ? candidate.printedPageLabel : null };
			let quote = normalize(source.quote), pageVerified = false;
			if (!quote) { omitted++; continue; }
			if (ctx.reading.evidenceMode === "knowledge" && ctx.reading.currentPage?.verified && source.pageIndex === ctx.reading.currentPage.pageIndex) {
				pageVerified = normalize(ctx.reading.currentPage.text || "").includes(quote);
			}
			if (ctx.reading.evidenceMode !== "knowledge" && ctx.reading.pdfSource?.status === "ready" && Number.isInteger(source.pageIndex) && source.pageIndex >= 0) {
				if (ctx.reading.pdfSource.pageMapping && source.pageIndex < ctx.reading.pdfSource.totalPages) pageVerified = normalize(this.pdfPageText(sourceText, source.pageIndex)).includes(quote);
				if (!pageVerified && (!ctx.discussion || ctx.reading.pdfSource.allowedPages?.includes(source.pageIndex))) {
					try { pageVerified = normalize((await this.readNativeReadingPage(ctx, source.pageIndex)).text).includes(quote); }
					catch (e) { /* Retain an independently verified excerpt without a page link. */ }
				}
			}
			if (!pageVerified && (!sourceText || !normalizedSource.includes(quote))) { omitted++; continue; }
			if (!pageVerified) { source.pageIndex = null; unlocated++; }
			sources.push(source);
		}
		if (unlocated) notices.push(unlocated + " source page locations are unverified. The discussion and verified excerpts were saved without those page links.");
		if (omitted) notices.push(omitted + " unverified source excerpts were omitted; the discussion was saved.");
		if (record.sources && (!Array.isArray(record.sources) || record.sources.length > 10)) notices.push("Unsupported source entries were omitted; the discussion was saved.");
		let broadScope = { level: ctx.reading.type === "book" ? "book" : "paper", id: "", title: "" };
		let scope = record.scope || broadScope;
		if (!["book", "chapter", "section", "paper"].includes(scope.level) || typeof scope.id !== "string" || typeof scope.title !== "string" ||
			(["chapter", "section"].includes(scope.level) && !this.readingArtifactNotes(ctx, "Contents").some(note => this.readingArtifactData(note)?.entries?.some(entry => entry.id === scope.id)))) {
			scope = broadScope; notices.push("The requested chapter/section scope is unverified. The discussion was saved at the document scope.");
		}
		record.saveNotice = notices.join(" ") || undefined;
		let topic = typeof record.topicKey === "string" && /^[a-z0-9-]{1,80}$/.test(record.topicKey) ? record.topicKey : null;
		let doc = Zotero.getMainWindow().document;
		let existing = (ctx.paperItem.getNotes?.() || []).map(id => Zotero.Items.get(id)).find(note => {
			if (!note || !note.getTags().some(t => t.tag === "AbstractIn") || note.getTags().some(t => t.tag.startsWith("AbstractIn:"))) return false;
			let template = doc.createElementNS("http://www.w3.org/1999/xhtml", "template"); template.innerHTML = note.getNote();
			let paragraphs = [...template.content.querySelectorAll("p")].map(n => n.textContent);
			return paragraphs.includes("Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key) &&
				paragraphs.includes("Scope: " + scope.level + "; id: " + scope.id) &&
				(!ctx.discussion || paragraphs.includes("Discussion: " + ctx.discussion.id)) &&
				(topic ? paragraphs.includes("Topic: " + topic) : note.key === record.updateNoteKey);
		});
		let note = existing || new Zotero.Item("note");
		note.libraryID = ctx.paperItem.libraryID;
		note.parentID = ctx.paperItem.id;
		let wrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
		wrapper.appendChild(this.el(doc, "h1", null, "AbstractIn — " + record.title));
		let add = text => wrapper.appendChild(this.el(doc, "p", null, text));
		add("Material: " + ctx.reading.type + " · " + new Date().toISOString());
		if (ctx.reading.evidenceMode === "knowledge") add("Discussion mode: Knowledge discussion — supplementary reasoning; original PDF not searched for this answer.");
		add("Zotero item: " + ctx.paperItem.key + "; attachment: " + ctx.attachmentItem.key);
		add("Scope: " + scope.level + "; id: " + scope.id);
		if (ctx.discussion) add("Discussion: " + ctx.discussion.id);
		if (scope.title) add("Scope title: " + scope.title);
		if (topic) add("Topic: " + topic);
		if (existing) add("Updated from follow-up discussion. The concise discussion replaces the earlier version.");
		let link = this.el(doc, "a", null, "Open source PDF");
		link.href = this.readingPDFLink(ctx, selection);
		let source = this.el(doc, "p");
		source.appendChild(link);
		wrapper.appendChild(source);
		if (selection?.pageLabel) add("Printed page label: " + selection.pageLabel);
		if (Number.isInteger(selection?.position?.pageIndex)) add("PDF page index (zero-based): " + selection.position.pageIndex);
		if (selection?.text) wrapper.appendChild(this.el(doc, "blockquote", null, selection.text));
		for (let verified of sources) {
			if (Number.isInteger(verified.pageIndex)) {
				let link = this.el(doc, "a", null, "Source PDF page " + (verified.pageIndex + 1));
				link.href = this.readingPDFLink(ctx, { position: { pageIndex: verified.pageIndex } });
				wrapper.append(link);
			}
			else add("Verified source excerpt; physical PDF page unverified.");
			wrapper.append(this.el(doc, "blockquote", null, verified.quote));
			if (verified.printedPageLabel) add("Agent-reported printed label (verify in PDF): " + verified.printedPageLabel);
		}
		if (ctx.reading.pdfSource?.status === "unavailable") add("Source coverage: supplied passage or image only. PDF text was unavailable.");
		for (let notice of notices) add("Source validation: " + notice);
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
