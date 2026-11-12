/* CodeMirror in an HTML document, with native textarea editing as fallback. */
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

	installMathComposer(input, options = {}) {
		const doc = input.ownerDocument, win = doc.defaultView;
		let disposeNative = this.installNativeMathComposer(input);
		const frame = this.el(doc, "iframe", "abstractin-composer-frame");
		frame.setAttribute("title", options.note ? "Markdown note editor" : "Message editor");
		// XUL chrome documents may not create a docshell for display:none
		// iframes. Keep it laid out offscreen until the HTML editor is ready.
		frame.style.cssText = "position:absolute;left:-10000px;visibility:hidden;height:40px";

		const nativeFocus = input.focus, nativeSelect = input.setSelectionRange;
		const focusDescriptor = Object.getOwnPropertyDescriptor(input, "focus");
		const selectDescriptor = Object.getOwnPropertyDescriptor(input, "setSelectionRange");
		let editor = null, disposed = false, failed = false, updating = false, initializing = false;
		const sync = () => {
			if (!editor || updating) return;
			editor.sync(input.value, input.disabled, input.placeholder);
			const tabIndex = input.disabled ? -1 : 0;
			if (frame.tabIndex !== tabIndex) frame.tabIndex = tabIndex;
			const computed = win.getComputedStyle(input);
			const style = frame.contentDocument.documentElement.style;
			for (const [target, source] of [["--editor-text", "--abstractin-text"], ["--editor-faint", "--abstractin-faint"], ["--editor-hover", "--abstractin-hover"]]) {
				const value = computed.getPropertyValue(source);
				if (style.getPropertyValue(target) !== value) style.setProperty(target, value);
			}
			// Gecko can return an empty computed font shorthand when its longhands
			// cannot be serialized together. Copy the actual display properties.
			const bodyStyle = frame.contentDocument.body.style;
			let fontChanged = false;
			for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "lineHeight"]) {
				const value = computed[property];
				if (value && bodyStyle[property] !== value) { bodyStyle[property] = value; fontChanged = true; }
			}
			if (fontChanged) editor.measure();
		};
		const restore = () => {
			input.hidden = false;
			if (focusDescriptor) Object.defineProperty(input, "focus", focusDescriptor); else delete input.focus;
			if (selectDescriptor) Object.defineProperty(input, "setSelectionRange", selectDescriptor); else delete input.setSelectionRange;
			delete input._composerEditor;
			frame.hidden = true;
		};
		const fail = error => {
			if (disposed || failed) return;
			failed = true;
			const focused = doc.activeElement === frame;
			editor?.destroy(); editor = null;
			disposeNative?.();
			restore();
			disposeNative = this.installNativeMathComposer(input);
			if (focused && !input.disabled) nativeFocus.call(input);
			Zotero.debug("AbstractIn " + (options.note ? "NoteOut" : "CodeMirror") + " fallback: " + error);
		};
		const forward = (type, original, property) => {
			if (input.disabled) return true;
			const event = type === "keydown"
				? new win.KeyboardEvent(type, { key: original.key, code: original.code, ctrlKey: original.ctrlKey, metaKey: original.metaKey, altKey: original.altKey, shiftKey: original.shiftKey, bubbles: true, cancelable: true })
				: new win.Event(type, { bubbles: true, cancelable: true });
			if (property) Object.defineProperty(event, property, { value: original[property] });
			input.dispatchEvent(event);
			return event.defaultPrevented;
		};
		const loaded = async () => {
			if (disposed || failed || editor || initializing) return;
			initializing = true;
			try {
				const child = frame.contentWindow.wrappedJSObject || frame.contentWindow;
				const bridge = options.note && this.noteEditorURI ? this.noteEditorBridge : null;
				const factory = child.AbstractInComposer;
				if (!factory) throw new Error("Editor bundle did not load");
				const focused = doc.activeElement === input;
				const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
				const config = {
					note: !!options.note,
					maxHeight: options.note ? 600 : 180, minHeight: options.note ? 300 : 40, label: options.note ? "Markdown note" : "Message",
					text: input.value, disabled: input.disabled, placeholder: input.placeholder,
					tokens: text => this.composerMathTokens(text),
					renderMath: (target, tex, display) => this.texToMathML(target, tex, display),
					onChange: (text, anchor, head, changed) => {
						updating = true;
						try {
							if (changed) input.value = text;
							nativeSelect.call(input, Math.min(anchor, head), Math.max(anchor, head), anchor > head ? "backward" : "forward");
							if (changed) input.dispatchEvent(new win.Event("input", { bubbles: true }));
						} finally { updating = false; }
					},
					onKey: event => options.note ? ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" ? forward("keydown", event) : false) :
						(this.isSendKey(event) || event.key === "Escape" || (event.key === "ArrowUp" && !input.value) || event.altKey) ? forward("keydown", event) : false,
					onPaste: event => event.clipboardData?.files.length ? forward("paste", event, "clipboardData") : false,
					onDrop: event => event.dataTransfer?.files.length ? forward("drop", event, "dataTransfer") : false,
					onHeight: height => { if (!options.note) frame.style.height = height + "px"; },
					onError: error => win.setTimeout(() => fail(error), 0),
				};
				const created = factory.create(bridge ? bridge.cloneInto(config, child, { cloneFunctions: true }) : config);
				editor = created?.then ? await created : created;
				if (bridge) {
					const nativeEditor = bridge.waiveXrays(editor);
					// Only an AI edit snapshot crosses back into the content realm as an
					// object; normal editor operations use strings, numbers and callbacks.
					editor = {};
					for (const name of ["sync", "select", "focus", "measure", "flush", "getMarkdown", "destroy"]) {
						if (typeof nativeEditor[name] === "function") editor[name] = (...args) => nativeEditor[name](...args);
					}
					editor.getSelectionSnapshot = () => JSON.parse(JSON.stringify(nativeEditor.getSelectionSnapshot()));
					editor.replaceMarkdownRange = (markdown, from, to, snapshot) => nativeEditor.replaceMarkdownRange(markdown, from, to, bridge.cloneInto(snapshot, child));
				}
				if (disposed || failed) { editor?.destroy(); editor = null; return; }
				editor.select(direction === "backward" ? end : start, direction === "backward" ? start : end);
				disposeNative(); disposeNative = null;
				input._refreshMathPreview = sync;
				input._composerEditor = editor;
				input.focus = () => { if (!input.disabled) { sync(); editor.focus(); } };
				input.setSelectionRange = (start, end = start, direction = "none") => {
					nativeSelect.call(input, start, end, direction);
					sync();
					editor.select(direction === "backward" ? input.selectionEnd : input.selectionStart, direction === "backward" ? input.selectionStart : input.selectionEnd);
				};
				input.hidden = true;
				frame.style.removeProperty("position");
				frame.style.removeProperty("left");
				frame.style.removeProperty("visibility");
				if (options.note) { frame.style.height = "100%"; frame.classList.add("abstractin-note-rich-frame"); }
				frame.hidden = false;
				sync(); editor.measure();
				if (focused) editor.focus();
			} catch (error) { fail(error); }
			finally { initializing = false; }
		};
		frame.addEventListener("load", loaded, true);
		frame.addEventListener("error", fail);
		const observer = new win.MutationObserver(() => { try { sync(); } catch (error) { fail(error); } });
		observer.observe(input, { attributes: true, attributeFilter: ["disabled", "placeholder"] });
		frame.src = (options.note && this.noteEditorURI || this.resourceURI || this.rootURI || "") + "content/editor/" + (options.note ? "note.html" : "composer.html");
		input.after(frame);
		// Chrome documents can load a local frame synchronously during insertion.
		if (frame.contentWindow?.AbstractInComposer) loaded();
		return () => {
			disposed = true;
			observer.disconnect();
			frame.removeEventListener("load", loaded, true);
			frame.removeEventListener("error", fail);
			editor?.destroy();
			disposeNative?.();
			restore();
			delete input._refreshMathPreview;
			frame.remove();
		};
	},

	installNativeMathComposer(input) {
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
