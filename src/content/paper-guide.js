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
  if (this._pending.has(view.ctx.dir)) return { handled: true };
  const next = /^(?:(?:没有问题|没问题|无问题|没有疑问|明白了)[，,。\s]*)?(?:没有问题|没问题|无问题|没有疑问|没有了|明白了|下一张(?:子图)?|下一个(?:子图)?|继续|next(?:\s+(?:panel|subfigure))?|continue|no questions?)[.!。！]?$/i.test(question);
  if (next && state.index + 1 >= state.panels.length && state.lazy && Number.isInteger(state.nextFigureStart)) {
   const dir = this.discussionRoot(view.ctx);
   const full = await Zotero.File.getContentsAsync(OS.Path.join(dir, "source-text.md"));
   const source = await this.readDiscussionJSON(OS.Path.join(dir, "source-manifest.json"));
   const figure = this.locatePaperGuideFigure(full, source, state.nextFigureStart);
   return { ...options, paperGuide: { operation: "next", state: { ...state, panels: [...state.panels, ...figure.panels], index: state.panels.length, nextFigureStart: figure.nextFigureStart } } };
  }
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
  bar.append(this.el(view.doc, "span", null, state.status === "preparing" ? "Opening the first figure…" : state.status === "complete" ? "All subfigures covered · " + state.panels[state.index].id : state.panels[state.index].id + (state.lazy ? " · one subfigure at a time" : " · " + (state.index + 1) + "/" + state.panels.length)));
  const next = this.el(view.doc, "button", "abstractin-btn abstractin-guide-next", "Next subfigure");
  next.disabled = state.status === "preparing" || state.status === "complete" || this._pending.has(view.ctx.dir);
  next.onclick = () => this.startRequest(view, "Next subfigure.");
  const exit = this.el(view.doc, "button", "abstractin-btn abstractin-guide-exit", "Exit guide");
  exit.onclick = () => this.stopPaperGuide(view).catch(error => this.appendError(view, error.message));
  bar.append(next, exit);
  view.root.querySelector(".abstractin-composer")?.prepend(bar);
 },

 validatePaperGuidePlan(ctx, data, source, full, captionSources = []) {
  if (!data || data.complete !== true || !Array.isArray(data.panels) || !data.panels.length || data.panels.length > 256 || typeof data.coverage !== "string" || !data.coverage.trim()) throw new Error("The figure inventory is incomplete. Figure captions and panel labels must be verified before starting the guide.");
  const normalize = value => value.replace(/\s+/g, " ").trim(), ids = new Set();
  const panels = data.panels.map(panel => {
   const fail = reason => { throw new Error("Figure panel " + (typeof panel?.id === "string" ? panel.id : "[unnamed]") + " could not be verified: " + reason + ". No guide was started."); };
   if (!panel || typeof panel.id !== "string" || !panel.id.trim() || panel.id.length > 100) fail("missing or invalid panel identifier");
   if (ids.has(panel.id.trim())) fail("duplicate panel identifier");
   const caption = captionSources.find(item => item.id === panel.sourceId);
   if (panel.sourceId && !caption) fail("unknown caption source ID " + panel.sourceId);
   if (caption && full.slice(caption.start, caption.end) !== caption.text) fail("caption source no longer matches this PDF");
   const figureNumber = panel.id.match(/(?:fig(?:ure)?\.?|图)\s*(S?\s*\d+)/i)?.[1].replace(/\s/g, "").toLowerCase();
   const captionNumber = caption?.text.match(/^\s*(?:(?:supplementary|extended data)\s+)?(?:fig(?:ure)?\.?|图)\s*(S?\s*\d+)/i)?.[1].replace(/\s/g, "").toLowerCase();
   if (figureNumber && captionNumber && figureNumber !== captionNumber) fail("caption source belongs to another figure");
   const evidence = caption ? caption.text : panel.evidence;
   if (typeof evidence !== "string" || evidence.trim().length < 12 || evidence.length > 12000 || !normalize(full).includes(normalize(evidence))) fail("caption quotation differs from the extracted source; use a supplied caption source ID instead of rewriting or shortening the quotation");
   ids.add(panel.id.trim());
   let pageIndex = null;
   if (source.pageMapping) {
    const matches = [];
    for (let page = 0; page < source.totalPages; page++) if (normalize(this.pdfPageText(full, page)).includes(normalize(evidence))) matches.push(page);
    if (caption && !matches.length) {
     const anchor = normalize(caption.text.slice(0, 180));
     for (let page = 0; page < source.totalPages; page++) if (normalize(this.pdfPageText(full, page)).includes(anchor)) matches.push(page);
    }
    if (matches.includes(panel.pageIndex)) pageIndex = panel.pageIndex;
    else if (matches.length === 1) pageIndex = matches[0];
   }
   return { id: panel.id.trim(), evidence: caption ? caption.text.slice(0, 240) : evidence, pageIndex,
    ...(caption ? { sourceStart: caption.start, sourceEnd: caption.end } : {}) };
  });
  return { status: "active", index: 0, panels, coverage: data.coverage, attachmentKey: ctx.attachmentItem.key };
 },

 locatePaperGuideFigure(full, source, from = 0) {
  // Locate caption headings locally. Only the current figure's caption is
  // read; a later heading is merely a pointer for the next user request.
  const pattern = /(?:^|\n)\s*((?:(?:supplementary|extended data)\s+)?(?:fig(?:ure)?\.?|图)\s*(?:S\s*)?\d+)\s*(?:[|:.]|\r?\n)/ig;
  pattern.lastIndex = from;
  const heading = pattern.exec(full);
  if (!heading) throw new Error("The next figure caption could not be located. Open the figure page or provide its caption to begin the guide.");
  const next = pattern.exec(full);
  const start = heading.index, end = Math.min(full.length, start + 5000, next?.index ?? full.length);
  const caption = full.slice(start, end), letters = new Set();
  for (const match of caption.matchAll(/(?:^|\s)\(?([a-z](?:\s*[,–-]\s*[a-z]){0,12})\)?\s*[,.:)]\s+/ig)) {
   const labels = match[1].toLowerCase();
   for (const range of labels.matchAll(/([a-z])\s*[–-]\s*([a-z])/g)) {
    for (let code = range[1].charCodeAt(0); code <= range[2].charCodeAt(0); code++) letters.add(String.fromCharCode(code));
   }
   for (const letter of labels.match(/[a-z]/g) || []) letters.add(letter);
  }
  const figureID = heading[1].replace(/\s+/g, " ").trim();
  const labels = [];
  // Isolated units such as "s." are not panel labels. Caption panels start at
  // a and form a continuous sequence; ignore unrelated later single letters.
  for (let code = 97; code <= 122 && letters.has(String.fromCharCode(code)); code++) labels.push(String.fromCharCode(code));
  if (!labels.length) labels.push("");
  let pageIndex = null;
  if (source?.pageMapping) {
   const anchor = caption.trim().split(/\n\s*## PDF page/)[0].slice(0, 180).replace(/\s+/g, " ");
   const matches = [];
   for (let page = 0; page < source.totalPages; page++) if (this.pdfPageText(full, page).replace(/\s+/g, " ").includes(anchor)) matches.push(page);
   if (matches.length === 1) pageIndex = matches[0];
  }
  return { panels: labels.map(label => ({ id: figureID + label, evidence: caption.slice(0, 240), sourceStart: start, sourceEnd: end, pageIndex })), nextFigureStart: next?.index ?? null };
 },

 async preparePaperGuideTurn(ctx, pending, source) {
  if (source.status !== "ready") return source;
  const full = await Zotero.File.getContentsAsync(OS.Path.join(ctx.documentDir || ctx.dir, "source-text.md"));
  let state = pending.paperGuide.state;
  if (pending.paperGuide.operation === "start") {
   pending.progress({ status: "opening the first figure" });
   const figure = this.locatePaperGuideFigure(full, source);
   state = { ...figure, lazy: true, status: "active", index: 0, attachmentKey: ctx.attachmentItem.key,
    coverage: "Only the current figure and specifically needed evidence are supplied. Later figures and supplements have not been read." };
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
  const caption = Number.isInteger(panel.sourceStart) && Number.isInteger(panel.sourceEnd) && full.slice(panel.sourceStart, panel.sourceStart + panel.evidence.length) === panel.evidence ? full.slice(panel.sourceStart, panel.sourceEnd) : panel.evidence;
  const text = source.pageMapping && Number.isInteger(panel.pageIndex) ? this.pdfPageText(full, panel.pageIndex) : full;
  const normalize = value => value.replace(/\s+/g, " ").trim();
  const lines = ["## Current panel caption\n\n" + caption];
  const terms = (ctx.reading.sourceQuestion || "") + "\n" + (ctx.reading.missingSourceEvidence || "");
  const search = this.discussionSearchRequest(ctx);
  for (const page of search.pages.filter(page => source.pageMapping && page < source.totalPages).slice(0, 2)) lines.push("## Requested evidence page; pageIndex " + page + "\n\n" + this.pdfPageText(full, page).slice(0, 6000));
  const hits = ctx.reading.missingSourceEvidence ? this.discussionConceptMatches(full, terms, search.queries) : [];
  const ranges = [];
  for (const hit of hits) {
   const start = Math.max(0, hit.index - 400), end = Math.min(full.length, hit.index + 2600);
   if (ranges.some(range => start < range.end && end > range.start)) continue;
   ranges.push({ start, end }); lines.push("## Related source text; page location unverified\n\n" + full.slice(start, end));
   if (ranges.length === 3) break;
  }
  if (Number.isInteger(panel.pageIndex) && normalize(text).includes(normalize(panel.evidence))) lines.unshift("## Figure location; pageIndex " + panel.pageIndex);
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
  return "\nGuided paper reading is active. Current subfigure: " + panel.id + ". Explain only this subfigure and answer follow-up questions about it; never advance on your own. Later figures have not been read. Start writing the current panel explanation as soon as its caption/image establishes a useful point; do not wait to analyze the whole paper or complete every part of your explanation before emitting text. " +
   "Explain the scientific question, what data and experimental conditions enter this panel, how the plot is constructed (axes, visual encodings, aggregation/normalization, sample unit, uncertainty/error bars), the analysis or statistical/modeling method, the observed result and what it does and does not establish. For schematic panels explain their construction and purpose without inventing a statistical analysis. Distinguish reported facts from general methodological explanations; do not invent code or analysis details absent from the paper. " +
   "Use the caption, related methods/results and the attached page image when available. Image status: " + guide.imageStatus + ". If the image is unavailable, say that visual details cannot be verified and identify what is supported by the caption. Request specific missing methods evidence through the source-needed protocol rather than guessing. " +
   "Inventory coverage: " + state.coverage + ". Finish by inviting questions about this panel; the user may choose Next subfigure or Exit guide. " +
   (guide.operation === "followup" ? "This is a follow-up: answer the question directly without repeating the full panel explanation. " : "Give the current panel's explanation now. ") +
   "Append the normal abstractin-record block. Do not emit or alter the inventory, skip panels or claim uninspected supplements were covered.";
 },

 finishPaperGuideTurn(ctx, pending, meta) {
  if (!pending.paperGuide || pending.cancelled) return;
  const state = pending.paperGuide.state;
  const saved = { ...state, status: state.index + 1 === state.panels.length && !Number.isInteger(state.nextFigureStart) ? "complete" : "active" };
  this._paperGuides.set(ctx.dir, saved); meta.paperGuide = saved;
 },
});
