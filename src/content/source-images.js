"use strict";

Object.assign(AbstractIn, {
 _readingPageImages: new Map(),

 requestsReadingImage(question) {
  return /图片|图像|图形|图表|示意图|这张图|图中|图\s*\d|曲线|坐标轴|这个公式|\b(?:images?|figures?|fig\.|plots?|diagrams?|charts?|illustrations?|visual details)\b/i.test(question || "");
 },

 async readingImagePages(ctx, pending, source) {
  const search = this.discussionSearchRequest(ctx), pages = [...search.imagePages];
  const question = [ctx.reading.sourceQuestion, ctx.reading.sourceSelection, ...search.queries].filter(Boolean).join("\n");
  if (!pages.length && (pending.paperGuide || !this.requestsReadingImage(question))) return [];
  const total = source.totalPages || this.readingPDFApplication(ctx)?.pdfDocument?.numPages;
  const references = [...new Set([...question.matchAll(/(?:fig(?:ure)?\.?|图)\s*(S?\s*\d+(?:\s*\.\s*\d+)*)/ig)].map(match => match[1].replace(/\s/g, "")))];
  if (!pages.length && references.length && source.pageMapping) {
   let full = "";
   try { full = await Zotero.File.getContentsAsync(OS.Path.join(this.discussionRoot(ctx), "source-text.md")); }
   catch (error) { this.logError("image source text", error); }
   const sourcePages = Array.from({ length: source.totalPages }, (_, pageIndex) => ({ pageIndex, text: this.pdfPageText(full, pageIndex) }));
   for (const reference of references.slice(0, 4)) {
    const label = "(?:fig(?:ure)?\\.?|图)\\s*" + reference.replace(/\./g, "\\s*\\.\\s*") + "(?![\\d]|\\.\\d)";
    const match = new RegExp(label, "i"), heading = new RegExp("(?:^|\\n)\\s*(?:(?:supplementary|extended data)\\s+)?" + label, "i");
    const hits = sourcePages.filter(page => match.test(page.text)).map(page => ({ pageIndex: page.pageIndex, score: heading.test(page.text) ? 100 : 1 }));
    hits.sort((a, b) => b.score - a.score || a.pageIndex - b.pageIndex);
    pages.push(...hits.slice(0, 2).map(hit => hit.pageIndex));
   }
  }
  if (!pages.length && !references.length) {
   const current = ctx.reading.selectedPageIndex ?? pending.currentPage?.pageIndex ?? ctx.reading.currentPage?.pageIndex;
   if (Number.isInteger(current)) pages.push(current);
   else if (source.pageMapping) {
    let full = "";
    try { full = await Zotero.File.getContentsAsync(OS.Path.join(this.discussionRoot(ctx), "source-text.md")); }
    catch (error) { this.logError("image caption search", error); }
    const hits = [];
    for (let page = 0; page < total; page++) {
     const matches = this.discussionConceptMatches(this.pdfPageText(full, page), question, search.queries);
     if (matches.length) hits.push({ page, score: matches[0].score });
    }
    hits.sort((a, b) => b.score - a.score || a.page - b.page);
    pages.push(...hits.slice(0, 2).map(hit => hit.page));
   }
  }
  return [...new Set(pages)].filter(page => Number.isInteger(page) && page >= 0 && (!Number.isInteger(total) || page < total)).slice(0, 4);
 },

 async prepareReadingImages(ctx, pending, source) {
  ctx.reading.sourceImages = [];
  if (ctx.reading.forbidSource || ctx.reading.vocabularyTutor || ctx.reading.evidenceMode === "knowledge" || pending.readingAction === "contents") return;
  pending.images = (pending.images || []).filter(path => !(pending.readingImagePaths || []).includes(path));
  pending.readingImagePaths = [];
  const pages = await this.readingImagePages(ctx, pending, source);
  for (const pageIndex of pages) {
   if (pending.cancelled) return;
   pending.progress({ status: "rendering source page " + (pageIndex + 1) });
   const image = await this.readingPageImage(ctx, pageIndex, pending.backend);
   if (pending.cancelled) return;
   if (image.path && !pending.images.includes(image.path)) { pending.images.push(image.path); pending.readingImagePaths.push(image.path); }
   ctx.reading.sourceImages.push({ pageIndex, status: image.status, imageAttachment: image.path ? pending.images.indexOf(image.path) + 1 : null });
  }
  if (!pages.length && !pending.paperGuide && this.requestsReadingImage(ctx.reading.sourceQuestion)) {
   ctx.reading.sourceImages.push({ status: "unavailable: the requested image's physical page has not been located; search its caption first, then request imagePageIndices" });
  }
 },

 async readingPageImage(ctx, pageIndex, backend) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return { status: "unavailable: page location is unverified" };
  if (!this.BACKENDS[backend]?.images) return { status: "unavailable: this agent cannot inspect images" };
  const key = ctx.dir + ":" + ctx.attachmentItem?.key + ":" + ctx.reading.pdfSource?.signature + ":" + pageIndex;
  if (this._readingPageImages.has(key)) return { status: "available", path: this._readingPageImages.get(key) };
  try {
   const pdf = this.unwrapReadingValue(this.readingPDFApplication(ctx)?.pdfDocument);
   if (!pdf?.getPage) return { status: "unavailable: open this source in the PDF reader to inspect page images" };
   if (Number.isInteger(pdf.numPages) && pageIndex >= pdf.numPages) return { status: "unavailable: page is outside this PDF" };
   const page = this.unwrapReadingValue(await this.unwrapReadingValue(pdf.getPage(pageIndex + 1)));
   const size = this.unwrapReadingValue(page.getViewport({ scale: 1 }));
   const viewport = this.unwrapReadingValue(page.getViewport({ scale: Math.min(1.5, 2000 / Math.max(size.width, size.height)) }));
   const canvas = Zotero.getMainWindow().document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
   canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
   const task = this.unwrapReadingValue(page.render({ canvasContext: canvas.getContext("2d"), viewport }));
   await this.unwrapReadingValue(task.promise);
   const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
   if (!blob) throw new Error("The source page could not be rendered.");
   await Zotero.File.createDirectoryIfMissingAsync(OS.Path.join(ctx.dir, "attachments"));
   const path = this.attachmentPath(ctx.dir, "png"); await Zotero.File.putContentsAsync(path, blob);
   this._readingPageImages.set(key, path); return { status: "available", path };
  } catch (error) { this.logError("source page image", error); return { status: "unavailable: " + error.message }; }
 },

 readingImagePrompt(ctx) {
  if (!ctx.reading?.sourceImages?.length) return "";
  return "\nOriginal PDF page images: " + JSON.stringify(ctx.reading.sourceImages) + ". pageIndex is zero-based physical PDF page; imageAttachment is the one-based index in this turn's actual image attachments. Inspect the attached images directly; no Read tool is needed. Never claim visual inspection for unavailable images. If visual evidence is missing, search the caption and request imagePageIndices through abstractin-source-needed. Do not guess physical pages from printed page numbers.";
 },
});
