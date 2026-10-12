/* Native textarea editing with a separate, non-editable KaTeX preview. */
Object.assign(AbstractIn, {
	composerMathTokens(text) {
		const tokens = [];
		const escaped = index => {
			let slashes = 0;
			while (index > 0 && text[--index] === "\\") slashes++;
			return slashes % 2 === 1;
		};
		for (let start = 0; start < text.length; start++) {
			if (text[start] !== "$" || escaped(start)) continue;
			const display = text[start + 1] === "$";
			const size = display ? 2 : 1;
			for (let close = start + size; close < text.length; close++) {
				if (!display && text[close] === "\n") break;
				if (text[close] !== "$" || escaped(close)) continue;
				if (display && text[close + 1] !== "$") continue;
				if (!display && text[close + 1] === "$") break;
				const end = close + size;
				const tex = text.slice(start + size, close);
				if (tex.trim()) tokens.push({ start, end, tex, display, source: text.slice(start, end) });
				start = end - 1;
				break;
			}
		}
		return tokens;
	},

	installMathComposer(input) {
		// Keep Gecko's native textarea as the editing host, including in Zotero's
		// chrome documents. Rendering must never replace its text or selection.
		const doc = input.ownerDocument;
		const preview = this.el(doc, "div", "abstractin-math-preview");
		preview.setAttribute("aria-label", "LaTeX preview");
		preview.hidden = true;
		input.after(preview);
		let composing = false, renderedText = null;
		const updateState = () => {
			const focused = doc.activeElement === input;
			for (const node of preview.children) {
				node.disabled = input.disabled;
				node.dataset.active = String(focused && input.selectionStart === input.selectionEnd
					&& input.selectionStart >= Number(node.dataset.start) && input.selectionStart <= Number(node.dataset.end));
			}
		};
		const refresh = () => {
			if (composing) return;
			if (renderedText === input.value) { updateState(); return; }
			try {
				const fragment = doc.createDocumentFragment();
				for (const token of this.composerMathTokens(input.value)) {
					const math = this.texToMathML(doc, token.tex, token.display);
					if (!math) continue;
					const node = this.el(doc, "button", "abstractin-composer-formula");
					node.type = "button";
					node.disabled = input.disabled;
					node.dataset.display = String(token.display);
					node.dataset.start = String(token.start);
					node.dataset.end = String(token.end);
					node.setAttribute("aria-label", token.source);
					node.title = "Click to edit LaTeX";
					node.appendChild(math);
					node.addEventListener("click", () => {
						if (input.disabled) return;
						input.focus();
						input.setSelectionRange(token.end, token.end);
						refresh();
					});
					fragment.appendChild(node);
				}
				preview.replaceChildren(fragment);
				preview.hidden = !preview.childNodes.length;
				renderedText = input.value;
				updateState();
			} catch (error) {
				// A broken formula or unavailable renderer must not disable typing.
				preview.replaceChildren();
				preview.hidden = true;
				renderedText = null;
				Zotero.debug("AbstractIn formula preview: " + error);
			}
		};
		// Programmatic draft changes already call autoGrow; no native DOM
		// properties or editing methods need to be shadowed for synchronization.
		input._refreshMathPreview = refresh;
		const listeners = [];
		const on = (type, handler) => {
			input.addEventListener(type, handler);
			listeners.push([type, handler]);
		};
		for (const type of ["input", "focus", "blur", "select", "selectionchange", "keyup", "mouseup"]) on(type, refresh);
		on("compositionstart", () => { composing = true; });
		on("compositionend", () => { composing = false; refresh(); });
		on("keydown", event => {
			// Leave insertion, deletion, clipboard, selection and undo to Gecko.
			// Only protect IME confirmation and formula newlines from send-on-Enter.
			if (event.key !== "Enter" || input.disabled) return;
			if (composing || event.isComposing || event.keyCode === 229) {
				event.stopImmediatePropagation();
				return;
			}
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const prefix = input.value.slice(0, input.selectionStart);
			let display = false;
			for (let i = 0; i < prefix.length - 1; i++) {
				if (prefix.slice(i, i + 2) !== "$$") continue;
				let slashes = 0, before = i;
				while (before > 0 && prefix[--before] === "\\") slashes++;
				if (slashes % 2 === 0) { display = !display; i++; }
			}
			if (display) event.stopImmediatePropagation(); // Native Enter still inserts the newline.
		});
		const observer = new doc.defaultView.MutationObserver(refresh);
		observer.observe(input, { attributes: true, attributeFilter: ["disabled"] });
		refresh();
		return () => {
			for (const [type, handler] of listeners) input.removeEventListener(type, handler);
			observer.disconnect();
			delete input._refreshMathPreview;
			preview.remove();
		};
	},
});
