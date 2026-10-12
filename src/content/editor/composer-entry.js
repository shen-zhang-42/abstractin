import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { latexSourceBlocks, latexHighlightRanges } from "./latex-highlights.js";

// This module runs in an HTML iframe, rather than Zotero's chrome document.
// CodeMirror owns the document, selection, history, clipboard and IME handling.
window.AbstractInComposer = {
	create(config) {
		const enabled = new Compartment(), hint = new Compartment();
		const focusChanged = StateEffect.define();
		let syncing = false, destroyed = false;
		class MathWidget extends WidgetType {
			constructor(token) { super(); this.token = token; }
			eq(other) { return this.token.source === other.token.source && this.token.start === other.token.start; }
			toDOM(view) {
				const doc = view.dom.ownerDocument;
				const node = doc.createElement("span");
				node.className = "composer-math";
				node.dataset.end = String(this.token.end);
				node.dataset.display = String(this.token.display);
				node.setAttribute("aria-label", this.token.source);
				node.title = "Click to edit LaTeX";
				try {
					const math = config.renderMath(doc, this.token.tex, this.token.display);
					if (math) node.appendChild(math);
					else node.textContent = this.token.source;
				} catch { node.textContent = this.token.source; }
				node.addEventListener("mousedown", event => {
					if (event.button !== 0 || view.state.facet(EditorState.readOnly)) return;
					event.preventDefault();
					view.dispatch({ selection: EditorSelection.cursor(this.token.end), scrollIntoView: true });
					view.focus();
				});
				return node;
			}
			ignoreEvent() { return true; }
		}
		const decorate = (state, focused) => {
			const decorations = [];
			const text = state.doc.toString();
			const rendered = new Map(config.tokens(text).map(token => [token.start, token]));
			for (const block of latexSourceBlocks(text)) {
				const token = rendered.get(block.start);
				const active = focused && state.selection.ranges.some(range => range.to >= block.start && range.from <= block.end);
				if (token && !active) {
					decorations.push(Decoration.replace({ widget: new MathWidget(token), block: token.display }).range(token.start, token.end));
				} else {
					decorations.push(Decoration.mark({ class: "composer-math-source" }).range(block.start, block.end));
					for (const range of latexHighlightRanges(text, block))
						decorations.push(Decoration.mark({ class: range.className }).range(range.from, range.to));
				}
			}
			return Decoration.set(decorations, true);
		};
		const math = StateField.define({
			create(state) { return { focused: false, decorations: decorate(state, false) }; },
			update(previous, transaction) {
				let focused = previous.focused;
				for (const effect of transaction.effects) if (effect.is(focusChanged)) focused = effect.value;
				return transaction.docChanged || transaction.selection || focused !== previous.focused
					? { focused, decorations: decorate(transaction.state, focused) } : previous;
			},
			provide: field => EditorView.decorations.from(field, value => value.decorations),
		});
		const insideDisplay = (state) => {
			const prefix = state.doc.sliceString(0, state.selection.main.from);
			let open = false;
			for (let i = 0; i < prefix.length - 1; i++) {
				if (prefix.slice(i, i + 2) !== "$$") continue;
				let slashes = 0, before = i;
				while (before > 0 && prefix[--before] === "\\") slashes++;
				if (!(slashes % 2)) { open = !open; i++; }
			}
			return open;
		};
		const extensions = [
			history(), keymap.of([...historyKeymap, ...defaultKeymap]), math,
			EditorView.lineWrapping,
			enabled.of([EditorState.readOnly.of(config.disabled), EditorView.editable.of(!config.disabled)]),
			hint.of(placeholder(config.placeholder || "")),
			EditorView.contentAttributes.of({ "aria-label": "Message", "aria-multiline": "true", spellcheck: "false" }),
			Prec.highest(EditorView.domEventHandlers({
				keydown(event, editor) {
					if (editor.state.facet(EditorState.readOnly)) return false;
					if (event.isComposing || editor.composing || event.keyCode === 229) return false;
					if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && insideDisplay(editor.state)) return false;
					return config.onKey(event);
				},
				paste(event) { return config.onPaste(event); },
				drop(event) { return config.onDrop(event); },
			})),
			EditorView.updateListener.of(update => {
				if (!syncing && (update.docChanged || update.selectionSet)) {
					const selection = update.state.selection.main;
					config.onChange(update.state.doc.toString(), selection.anchor, selection.head, update.docChanged);
				}
			}),
			EditorView.exceptionSink.of(error => config.onError(error)),
			EditorView.theme({
				"&": { color: "var(--editor-text)", backgroundColor: "transparent", font: "inherit" },
				".cm-scroller": { fontFamily: "inherit", lineHeight: "1.4", maxHeight: "180px", overflow: "auto" },
				".cm-content": { padding: "1px 0", minHeight: "2.8em", caretColor: "var(--editor-text)" },
				".cm-line": { padding: "0 1px" },
				"&.cm-focused": { outline: "none" },
				".cm-placeholder": { color: "var(--editor-faint)" },
				"&.cm-focused .cm-placeholder": { display: "none" },
				".composer-math-source": { backgroundColor: "var(--editor-hover)", borderRadius: "3px" },
				".composer-latex-content": { color: "color-mix(in srgb, var(--editor-text) 40%, #007bbf)" },
				".composer-latex-delimiter": { color: "color-mix(in srgb, var(--editor-text) 30%, #ce5579)", fontWeight: "600" },
				".composer-latex-command": { color: "color-mix(in srgb, var(--editor-text) 30%, #a05cc0)" },
				".composer-latex-bracket, .composer-latex-operator": { color: "color-mix(in srgb, var(--editor-text) 30%, #bc7828)" },
				".composer-latex-number": { color: "color-mix(in srgb, var(--editor-text) 30%, #168677)" },
				".composer-latex-comment": { color: "var(--editor-faint)", fontStyle: "italic" },
			}),
		];
		const view = new EditorView({
			parent: document.getElementById("editor"),
			state: EditorState.create({ doc: config.text, extensions }),
		});
		view.dom.addEventListener("focusin", () => view.dispatch({ effects: focusChanged.of(true) }));
		view.dom.addEventListener("focusout", () => view.dispatch({ effects: focusChanged.of(false) }));
		const size = new ResizeObserver(() => config.onHeight(Math.min(180, Math.max(40, view.dom.getBoundingClientRect().height))));
		size.observe(view.dom);
		return {
			sync(text, disabled, label) {
				if (destroyed) return;
				syncing = true;
				try {
					const effects = [enabled.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]), hint.reconfigure(placeholder(label || ""))];
					if (text !== view.state.doc.toString()) {
						// A recalled/new draft starts a new history, just as assigning textarea.value does.
						view.setState(EditorState.create({ doc: text, selection: { anchor: text.length }, extensions }));
					}
					view.dispatch({ effects: [...effects, focusChanged.of(view.hasFocus)], annotations: Transaction.addToHistory.of(false) });
				} finally { syncing = false; }
			},
			focus() { view.focus(); },
			select(anchor, head) { view.dispatch({ selection: EditorSelection.single(anchor, head), scrollIntoView: true }); },
			measure() { view.requestMeasure(); },
			destroy() { destroyed = true; size.disconnect(); view.destroy(); },
			view, // Exposes CodeMirror's public API for integration tests.
		};
	},
};
