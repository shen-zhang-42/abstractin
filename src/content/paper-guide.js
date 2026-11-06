"use strict";

Object.assign(AbstractIn, {
 _paperGuides: new Map(),
 _paperGuideImages: new Map(),

 paperReadingQuickQuestions() {
  return [
   { label: "Summarize paper", run: view => this.startRequest(view, "Generate or update the paper summary using scientific-paper-reading.", [], [], { readingAction: "summary" }) },
   { label: "Guide through the paper", run: view => this.startRequest(view, "Guide through the paper.", [], [], { paperGuide: { operation: "start" } }) },
  ];
 },

 paperGuideState(ctx) { return this._paperGuides.get(ctx.dir) || null; },

 restorePaperGuide(view, history) {
  const pending = this._pending.get(view.ctx.dir);
  if (pending?.paperGuide?.operation === "start" && !pending.paperGuide.state) return;
  const state = [...history].reverse().find(message => !message.carriedFrom && message.paperGuide?.attachmentKey === view.ctx.attachmentItem?.key)?.paperGuide;
  if (state) this._paperGuides.set(view.ctx.dir, state);
  else this._paperGuides.delete(view.ctx.dir);
 },

 async routePaperGuideRequest(view, text, options) {
  if (view.ctx.reading?.type !== "paper" || options.readingAction) return options;
  if (!this._paperGuides.has(view.ctx.dir)) this.restorePaperGuide(view, await this.loadHistory(view.ctx.dir));
  const state = this.paperGuideState(view.ctx), question = text.trim();
  if (state && state.status !== "stopped" && /^(?:退出导读|结束导读|退出引导|停止导读|退出\s*guide(?: through(?: the)? paper)?|(?:exit|stop|quit|end)\s+(?:the\s+)?guide(?: through(?: the)? paper)?)[.!。！]?$/i.test(question)) {
   await this.stopPaperGuide(view); return { handled: true };
  }
  if (options.paperGuide?.operation === "start" || /^(?:guide through (?:the )?paper|开始导读|逐图导读)[.!。！]?$/i.test(question)) {
   if (this._pending.has(view.ctx.dir)) return { handled: true };
   this._paperGuides.set(view.ctx.dir, { status: "preparing", panels: [], index: 0, attachmentKey: view.ctx.attachmentItem.key });
   this.renderPaperGuideControls(view);
   return { ...options, paperGuide: { operation: "start" } };
  }
  if (!state || state.status === "stopped") return options;
  const next = /^(?:(?:没有问题|没问题|无问题|没有疑问|明白了)[，,。\s]*)?(?:没有问题|没问题|无问题|没有疑问|没有了|明白了|下一张(?:子图)?|下一个(?:子图)?|继续|next(?:\s+(?:panel|subfigure))?|continue|no questions?)[.!。！]?$/i.test(question);
  if (next && state.index + 1 >= state.panels.length) return { handled: true };
  return { ...options, paperGuide: { operation: next ? "next" : "followup", state: { ...state, index: state.index + (next ? 1 : 0) } } };
 },

 async stopPaperGuide(view) {
  const dir = view.ctx.dir, state = this.paperGuideState(view.ctx);
  if (!state || state.status === "stopped") return;
  const stopped = { ...state, status: "stopped" };
  this._paperGuides.set(dir, stopped); this.renderPaperGuideControls(view);
  const pending = this._pending.get(dir);
  if (pending) { pending.cancel(); await pending.promise; }
  await this.appendHistory(dir, [
   { role: "user", text: "Exit guide through the paper.", ts: Date.now() },
   { role: "assistant", text: "Guided reading ended. You can continue asking questions or start a new guide.", ts: Date.now(), paperGuide: stopped },
  ]);
  if (view.ctx.dir === dir) this.renderMessages(view, await this.loadHistory(dir));
 },

 renderPaperGuideControls(view) {
  view.root.querySelector(".abstractin-paper-guide")?.remove();
  const state = this.paperGuideState(view.ctx);
  if (view.ctx.reading?.type !== "paper" || !state || state.status === "stopped") return;
  const bar = this.el(view.doc, "div", "abstractin-paper-guide");
  bar.setAttribute("aria-label", "Guide through the paper");
  bar.append(this.el(view.doc, "span", null, state.status === "preparing" ? "Preparing figure guide…" : state.status === "complete" ? "All subfigures covered · " + state.panels[state.index].id : state.panels[state.index].id + " · " + (state.index + 1) + "/" + state.panels.length));
  const next = this.el(view.doc, "button", "abstractin-btn abstractin-guide-next", "Next subfigure");
  next.disabled = state.status === "preparing" || state.status === "complete" || this._pending.has(view.ctx.dir);
  next.onclick = () => this.startRequest(view, "Next subfigure.");
  const exit = this.el(view.doc, "button", "abstractin-btn abstractin-guide-exit", "Exit guide");
  exit.onclick = () => this.stopPaperGuide(view).catch(error => this.appendError(view, error.message));
  bar.append(next, exit);
  view.root.querySelector(".abstractin-composer")?.prepend(bar);
 },

 validatePaperGuidePlan(ctx, data, source, full) {
  if (!data || data.complete !== true || !Array.isArray(data.panels) || !data.panels.length || data.panels.length > 256 || typeof data.coverage !== "string" || !data.coverage.trim()) throw new Error("The figure inventory is incomplete. Figure captions and panel labels must be verified before starting the guide.");
  const normalize = value => value.replace(/\s+/g, " ").trim(), ids = new Set();
  const panels = data.panels.map(panel => {
   if (!panel || typeof panel.id !== "string" || !panel.id.trim() || panel.id.length > 100 || ids.has(panel.id.trim()) || typeof panel.evidence !== "string" || panel.evidence.trim().length < 12 || panel.evidence.length > 4000 || !normalize(full).includes(normalize(panel.evidence))) throw new Error("A figure panel could not be verified against source evidence. No guide was started.");
   ids.add(panel.id.trim());
   let pageIndex = null;
   if (source.pageMapping) {
    const matches = [];
    for (let page = 0; page < source.totalPages; page++) if (normalize(this.pdfPageText(full, page)).includes(normalize(panel.evidence))) matches.push(page);
    if (matches.includes(panel.pageIndex)) pageIndex = panel.pageIndex;
    else if (matches.length === 1) pageIndex = matches[0];
   }
   return { id: panel.id.trim(), evidence: panel.evidence, pageIndex };
  });
  return { status: "active", index: 0, panels, coverage: data.coverage, attachmentKey: ctx.attachmentItem.key };
 },

 async preparePaperGuideTurn(ctx, pending, source) {
  if (source.status !== "ready") return source;
  const full = await Zotero.File.getContentsAsync(OS.Path.join(ctx.documentDir || ctx.dir, "source-text.md"));
  let state = pending.paperGuide.state;
  if (pending.paperGuide.operation === "start") {
   pending.progress({ status: "identifying figures and subfigures" });
   // Inventory uses captions and their local context, rather than another full
   // paper reading pass. Scan all matches before applying the prompt budget.
   const ranges = [];
   for (const match of full.matchAll(/(?:^|\n)\s*(?:(?:supplementary\s+)?fig(?:ure)?\.?\s*(?:S\s*)?\d+|图\s*\d+)/ig)) {
    const start = match.index, end = Math.min(full.length, start + 5000);
    if (!ranges.some(range => start < range.end && end > range.start)) ranges.push({ start, end });
   }
   const captions = ranges.length ? ranges.map(range => full.slice(range.start, range.end)).join("\n\n") : full;
   if (captions.length > 80000) throw new Error("The figure captions exceed the inventory budget. Narrow the paper or provide its figure captions before starting the guide.");
   const result = await this.runBackend(pending.backend, {
    ctx, files: {}, history: [], session: null, images: [], model: pending.model, effort: pending.effort,
    question: "Build the verified subfigure inventory for this exact paper. List every figure and its lettered/numbered panels in paper order; include supplementary figures only when actually present in this source. Treat an unlettered figure as one panel. Use captions to verify panel labels; never infer labels or invent missing panels. Preserve the paper's figure identifiers. If panel labels or coverage cannot be determined, set complete:false and explain the gap in coverage. Return only <abstractin-guide>{\"complete\":true,\"coverage\":\"source coverage and missing supplements\",\"panels\":[{\"id\":\"Figure 1a\",\"pageIndex\":null,\"evidence\":\"exact caption quotation supporting this panel\"}]}</abstractin-guide>. Use null unless a physical page index is verified. Do not explain panels yet.\n<figure-caption-source>\n" + captions + "\n</figure-caption-source>",
    onProgress: event => pending.progress({ status: event.status || "identifying figures and subfigures" }),
    onSpawn: proc => { pending.proc = proc; if (pending.cancelled) proc.kill(); },
   });
   if (pending.cancelled) return source;
   if (result.error || result.stopped) throw new Error(result.error || "Figure inventory was interrupted; no guide was started.");
   state = this.validatePaperGuidePlan(ctx, this.readingEnvelope(result.text, "guide"), source, full);
   pending.paperGuide.state = state;
   pending.paperGuide.operation = "explain";
  }
  if (!state || state.attachmentKey !== ctx.attachmentItem.key) throw new Error("The figure guide belongs to a different PDF. Start a new guide for this paper.");
  ctx.reading.paperGuide = { ...pending.paperGuide, state };
  const bounded = await this.exportPaperGuideSource(ctx, source, full);
  const panel = state.panels[state.index];
  const image = await this.paperGuidePageImage(ctx, panel.pageIndex, pending.backend);
  ctx.reading.paperGuide.imageStatus = image.status;
  if (image.path) pending.images = [...new Set([...(pending.images || []), image.path])];
  return bounded;
 },

 async exportPaperGuideSource(ctx, source, full) {
  const panel = ctx.reading.paperGuide.state.panels[ctx.reading.paperGuide.state.index];
  const text = source.pageMapping && Number.isInteger(panel.pageIndex) ? this.pdfPageText(full, panel.pageIndex) : full;
  const normalize = value => value.replace(/\s+/g, " ").trim();
  const lines = ["## Current panel caption\n\n" + panel.evidence];
  const terms = (ctx.reading.sourceQuestion || "") + "\n" + panel.evidence + "\n" + (ctx.reading.missingSourceEvidence || "");
  const search = this.discussionSearchRequest(ctx);
  for (const page of search.pages.filter(page => source.pageMapping && page < source.totalPages).slice(0, 2)) lines.push("## Requested evidence page; pageIndex " + page + "\n\n" + this.pdfPageText(full, page).slice(0, 6000));
  const hits = this.discussionConceptMatches(full, terms, search.queries);
  const ranges = [];
  for (const hit of hits) {
   const start = Math.max(0, hit.index - 400), end = Math.min(full.length, hit.index + 2600);
   if (ranges.some(range => start < range.end && end > range.start)) continue;
   ranges.push({ start, end }); lines.push("## Related source text; page location unverified\n\n" + full.slice(start, end));
   if (ranges.length === 3) break;
  }
  if (Number.isInteger(panel.pageIndex) && normalize(text).includes(normalize(panel.evidence))) lines.unshift("## Figure page; pageIndex " + panel.pageIndex + "\n\n" + text.slice(0, 6000));
  const bounded = { ...source, pdf: undefined, text: "source-text.md", scoped: true, matchedOnly: true, allowedPages: Number.isInteger(panel.pageIndex) ? [panel.pageIndex] : [] };
  await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-text.md"), lines.join("\n\n").slice(0, 24000));
  await Zotero.File.putContentsAsync(OS.Path.join(ctx.dir, "source-manifest.json"), JSON.stringify(bounded));
  return bounded;
 },

 async paperGuidePageImage(ctx, pageIndex, backend) {
  if (!Number.isInteger(pageIndex)) return { status: "unavailable: figure page location is unverified" };
  if (!this.BACKENDS[backend]?.images) return { status: "unavailable: this agent cannot inspect images" };
  const key = ctx.dir + ":" + ctx.reading.pdfSource?.signature + ":" + pageIndex;
  if (this._paperGuideImages.has(key)) return { status: "available", path: this._paperGuideImages.get(key) };
  try {
   const pdf = this.unwrapReadingValue(this.readingPDFApplication(ctx)?.pdfDocument);
   if (!pdf?.getPage) return { status: "unavailable: open the paper in the PDF reader to inspect its figure" };
   const page = this.unwrapReadingValue(await this.unwrapReadingValue(pdf.getPage(pageIndex + 1)));
   const viewport = page.getViewport({ scale: 1.5 });
   const canvas = Zotero.getMainWindow().document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
   canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
   await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
   const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
   if (!blob) throw new Error("The figure page could not be rendered.");
   const folder = OS.Path.join(ctx.dir, "attachments"); await Zotero.File.createDirectoryIfMissingAsync(folder);
   const path = this.attachmentPath(ctx.dir, "png"); await Zotero.File.putContentsAsync(path, blob);
   this._paperGuideImages.set(key, path); return { status: "available", path };
  } catch (error) { this.logError("figure page image", error); return { status: "unavailable: " + error.message }; }
 },

 paperGuidePrompt(ctx) {
  const guide = ctx.reading.paperGuide, state = guide.state, panel = state.panels[state.index];
  return "\nGuided paper reading is active. Current subfigure: " + panel.id + " (" + (state.index + 1) + "/" + state.panels.length + "). Explain only this subfigure and answer follow-up questions about it; never advance on your own. " +
   "Explain the scientific question, what data and experimental conditions enter this panel, how the plot is constructed (axes, visual encodings, aggregation/normalization, sample unit, uncertainty/error bars), the analysis or statistical/modeling method, the observed result and what it does and does not establish. For schematic panels explain their construction and purpose without inventing a statistical analysis. Distinguish reported facts from general methodological explanations; do not invent code or analysis details absent from the paper. " +
   "Use the caption, related methods/results and the attached page image when available. Image status: " + guide.imageStatus + ". If the image is unavailable, say that visual details cannot be verified and identify what is supported by the caption. Request specific missing methods evidence through the source-needed protocol rather than guessing. " +
   "Inventory coverage: " + state.coverage + ". Finish by inviting questions about this panel; the user may choose Next subfigure or Exit guide. " +
   (guide.operation === "followup" ? "This is a follow-up: answer the question directly without repeating the full panel explanation. " : "Give the current panel's explanation now. ") +
   "Append the normal abstractin-record block. Do not emit or alter the inventory, skip panels or claim uninspected supplements were covered.";
 },

 finishPaperGuideTurn(ctx, pending, meta) {
  if (!pending.paperGuide || pending.cancelled) return;
  const state = pending.paperGuide.state;
  const saved = { ...state, status: state.index + 1 === state.panels.length ? "complete" : "active" };
  this._paperGuides.set(ctx.dir, saved); meta.paperGuide = saved;
 },
});
