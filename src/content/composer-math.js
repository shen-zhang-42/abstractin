/* The textarea remains the source-of-truth API for drafts and sending.
 * The editable surface shows math, never serializes rendered MathML. */
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
		const doc = input.ownerDocument, win = doc.defaultView;
		const editor = this.el(doc, "div", "abstractin-math-editor");
		editor.setAttribute("role", "textbox");
		editor.setAttribute("aria-multiline", "true");
		editor.setAttribute("aria-label", "Message");
		editor.spellcheck = false;
		input.before(editor);
		input.hidden = true;
		input._mathEditor = editor;
		const proto = win.HTMLTextAreaElement.prototype;
		const value = Object.getOwnPropertyDescriptor(proto, "value");
		let composing = false, rendering = false, lastRender = "", saved = [0, 0];
		let past = [], future = [], previous = value.get.call(input);
		const source = node => node.nodeType === 3 ? node.data
			: node.dataset?.mathSource !== undefined ? node.dataset.mathSource
			// Enter/paste insert explicit newline text. Gecko's contenteditable
			// filler <br> is not draft content (especially after deleting all text).
			: node.localName === "br" ? "" : Array.from(node.childNodes, source).join("");
		const selection = () => {
			const sel = win.getSelection();
			if (!sel?.rangeCount || !editor.contains(sel.anchorNode) || !editor.contains(sel.focusNode)) return null;
			const offset = (node, position) => {
				let total = 0;
				const walk = current => {
					if (current === node) {
						total += current.nodeType === 3 ? position : Array.from(current.childNodes).slice(0, position).map(source).join("").length;
						return true;
					}
					if (current.contains(node) && current.dataset?.mathSource === undefined) {
						for (const child of current.childNodes) if (walk(child)) return true;
					} else total += source(current).length;
					return false;
				};
				walk(editor);
				return total;
			};
			return [offset(sel.anchorNode, sel.anchorOffset), offset(sel.focusNode, sel.focusOffset)];
		};
		const place = (positions) => {
			const point = offset => {
				for (const node of editor.childNodes) {
					const length = source(node).length;
					if (offset <= length && node.nodeType === 3) return [node, offset];
					if (offset < length) return [editor, Array.from(editor.childNodes).indexOf(node)];
					offset -= length;
				}
				return [editor, editor.childNodes.length];
			};
			win.getSelection().setBaseAndExtent(...point(positions[0]), ...point(positions[1]));
			saved = positions;
		};
		const render = (positions = selection()) => {
			if (composing || rendering) return;
			const text = value.get.call(input);
			editor.dataset.empty = String(text.length === 0);
			const tokens = this.composerMathTokens(text);
			const active = positions ? tokens.filter(token => Math.max(...positions) >= token.start && Math.min(...positions) <= token.end) : [];
			const key = JSON.stringify([text, active.map(token => token.start)]);
			if (key === lastRender) return;
			lastRender = key;
			// Keep native text nodes and the caret while typing ordinary text or
			// editing raw math. Only rebuild when formula presentation changes.
			if (editor.firstChild && source(editor) === text && !editor.querySelector(".abstractin-composer-formula")
				&& tokens.length === active.length) return;
			rendering = true;
			editor.replaceChildren();
			let cursor = 0;
			for (const token of tokens) {
				editor.appendChild(doc.createTextNode(text.slice(cursor, token.start)));
				if (active.includes(token)) editor.appendChild(doc.createTextNode(token.source));
				else {
					const math = this.texToMathML(doc, token.tex, token.display);
					if (!math) editor.appendChild(doc.createTextNode(token.source));
					else {
						const node = this.el(doc, "span", "abstractin-composer-formula");
						node.dataset.mathSource = token.source;
						node.dataset.display = String(token.display);
						node.setAttribute("contenteditable", "false");
						node.setAttribute("aria-label", token.source);
						node.title = "Click to edit LaTeX";
						node.appendChild(math);
						node.addEventListener("click", () => {
							if (input.disabled) return;
							editor.focus();
							render([token.end, token.end]);
							place([token.end, token.end]);
						});
						editor.appendChild(node);
					}
				}
				cursor = token.end;
			}
			editor.appendChild(doc.createTextNode(text.slice(cursor)));
			if (positions) place(positions);
			rendering = false;
		};
		const notify = () => input.dispatchEvent(new win.Event("input", { bubbles: true }));
		const commit = (text, positions) => {
			if (text !== previous) { past.push({ text: previous, positions: saved }); future = []; previous = text; }
			value.set.call(input, text);
			saved = positions || saved;
			render(positions);
			notify();
		};
		const insert = text => {
			if (input.disabled) return;
			const positions = selection() || saved;
			const start = Math.min(...positions), end = Math.max(...positions);
			const current = value.get.call(input);
			commit(current.slice(0, start) + text + current.slice(end), [start + text.length, start + text.length]);
		};
		const remove = (forward, word = false) => {
			if (input.disabled) return;
			const positions = selection() || saved;
			let start = Math.min(...positions), end = Math.max(...positions);
			const current = input.value;
			if (start === end) {
				const segmenter = new win.Intl.Segmenter(undefined, { granularity: word ? "word" : "grapheme" });
				const segments = Array.from(segmenter.segment(current));
				if (forward) {
					for (const part of segments) {
						if (part.index + part.segment.length <= end) continue;
						end = part.index + part.segment.length;
						if (!word || part.isWordLike) break;
					}
				} else {
					for (const part of segments.reverse()) {
						if (part.index >= start) continue;
						start = part.index;
						if (!word || part.isWordLike) break;
					}
				}
			}
			commit(current.slice(0, start) + current.slice(end), [start, start]);
		};
		Object.defineProperty(input, "value", {
			get: () => value.get.call(input),
			set: text => {
				value.set.call(input, text);
				previous = value.get.call(input); past = []; future = [];
				saved = [previous.length, previous.length];
				render(doc.activeElement === editor ? saved : null);
			}, configurable: true,
		});
		for (const property of ["disabled", "placeholder"]) {
			const descriptor = Object.getOwnPropertyDescriptor(proto, property);
			const sync = () => {
				editor.tabIndex = input.disabled ? -1 : 0;
				editor.setAttribute("contenteditable", String(!input.disabled));
				editor.setAttribute("aria-disabled", String(input.disabled));
				editor.dataset.placeholder = input.placeholder;
			};
			Object.defineProperty(input, property, { get: () => descriptor.get.call(input), set: v => { descriptor.set.call(input, v); sync(); }, configurable: true });
			sync();
		}
		input.focus = () => { if (!input.disabled) { editor.focus(); render(saved); place(saved); } };
		input.setSelectionRange = (start, end = start) => {
			const length = input.value.length;
			saved = [Math.min(Math.max(start, 0), length), Math.min(Math.max(end, 0), length)];
			if (doc.activeElement === editor) { render(saved); place(saved); }
		};
		editor.addEventListener("input", () => { commit(source(editor), selection()); });
		editor.addEventListener("compositionstart", () => { composing = true; });
		editor.addEventListener("compositionend", () => { composing = false; commit(source(editor), selection()); });
		const undo = redo => {
			const from = redo ? future : past, to = redo ? past : future;
			if (!from.length) return;
			to.push({ text: input.value, positions: selection() || saved });
			const entry = from.pop(); previous = entry.text;
			value.set.call(input, entry.text); render(entry.positions); notify();
		};
		editor.addEventListener("keydown", event => {
			if (input.disabled || composing || event.isComposing || event.keyCode === 229) return;
			changed();
			if (event.key === "Backspace" || event.key === "Delete") {
				event.preventDefault(); event.stopPropagation();
				remove(event.key === "Delete", event.ctrlKey || (Zotero.isMac && event.altKey));
				return;
			}
			// Enter inside $$...$$ inserts a formula line, including while the
			// closing delimiter is still being typed. Modified Enter can send.
			if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
				const prefix = input.value.slice(0, Math.min(...(selection() || saved)));
				let display = false;
				for (let i = 0; i < prefix.length - 1; i++) {
					if (prefix.slice(i, i + 2) !== "$$") continue;
					let slashes = 0, before = i;
					while (before > 0 && prefix[--before] === "\\") slashes++;
					if (slashes % 2 === 0) { display = !display; i++; }
				}
				if (display) { event.preventDefault(); event.stopPropagation(); insert("\n"); return; }
			}
			if ((event.ctrlKey || event.metaKey) && !event.altKey && ["z", "y"].includes(event.key.toLowerCase())) {
				event.preventDefault(); event.stopPropagation(); undo(event.shiftKey || event.key.toLowerCase() === "y"); return;
			}
			event.stopPropagation();
			// Forward only plugin shortcuts. Synthetic ordinary keys targeted at
			// a hidden textarea can be cancelled by Zotero's window shortcuts.
			let handled = false;
			if (this.isSendKey(event) || event.key === "Escape" || (event.key === "ArrowUp" && !input.value) || event.altKey) {
				const forwarded = new win.KeyboardEvent("keydown", { key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true });
				input.dispatchEvent(forwarded);
				handled = forwarded.defaultPrevented;
			}
			if (handled) event.preventDefault();
			else if (event.key === "Enter") { event.preventDefault(); insert("\n"); }
		});
		editor.addEventListener("keypress", event => event.stopPropagation());
		editor.addEventListener("beforeinput", event => {
			if (input.disabled || composing || event.isComposing) return;
			if (/^delete(Content|Word)(Backward|Forward)$/.test(event.inputType)) {
				event.preventDefault();
				remove(event.inputType.endsWith("Forward"), event.inputType.includes("Word"));
			}
			if (["insertParagraph", "insertLineBreak"].includes(event.inputType)) { event.preventDefault(); insert("\n"); }
			if (["historyUndo", "historyRedo"].includes(event.inputType)) { event.preventDefault(); undo(event.inputType === "historyRedo"); }
		});
		editor.addEventListener("paste", event => {
			const forwarded = new win.Event("paste", { bubbles: true, cancelable: true });
			Object.defineProperty(forwarded, "clipboardData", { value: event.clipboardData });
			input.dispatchEvent(forwarded);
			event.preventDefault();
			if (!forwarded.defaultPrevented) insert(event.clipboardData?.getData("text/plain") || "");
		});
		editor.addEventListener("drop", event => {
			if (event.dataTransfer?.files.length) return; // Existing image attachment handler.
			event.preventDefault();
			insert(event.dataTransfer?.getData("text/plain") || "");
		});
		for (const type of ["copy", "cut"]) editor.addEventListener(type, event => {
			const positions = selection(); if (!positions || !event.clipboardData) return;
			event.preventDefault(); event.stopPropagation();
			event.clipboardData.setData("text/plain", input.value.slice(Math.min(...positions), Math.max(...positions)));
			if (type === "cut" && !input.disabled) insert("");
		});
		const changed = () => {
			if (doc.activeElement !== editor || composing || rendering) return;
			const positions = selection(); if (!positions) return;
			saved = positions; render(positions);
		};
		doc.addEventListener("selectionchange", changed);
		editor.addEventListener("keyup", changed);
		editor.addEventListener("mouseup", changed);
		editor.addEventListener("blur", () => render(null));
		render(null);
		return () => doc.removeEventListener("selectionchange", changed);
	},
});
