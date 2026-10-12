import test from "node:test";
import assert from "node:assert/strict";
import { loadPlugin } from "./load-plugin.mjs";

function composer(text = "") {
	const env = loadPlugin();
	const input = env.document.createElement("textarea");
	input.value = text;
	env.document.body.append(input);
	const dispose = env.plugin.installMathComposer(input);
	return { ...env, input, editor: input._mathEditor, dispose };
}
const key = (env, key, options = {}) => env.editor.dispatchEvent(new env.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));

test("composer recognizes inline and multiline math without treating escaped or unfinished delimiters as formulas", () => {
	const { plugin } = loadPlugin();
	const text = String.raw`Cost \$5; $x^2$ then $$\begin{aligned}a&=b\\
c&=d\end{aligned}$$ and $unfinished`;
	const tokens = plugin.composerMathTokens(text);
	assert.equal(tokens.length, 2);
	assert.equal(tokens[0].tex, "x^2");
	assert.equal(tokens[0].display, false);
	assert.equal(tokens[1].display, true);
	assert.match(tokens[1].tex, /\n/);
	for (const token of tokens) assert.equal(text.slice(token.start, token.end), token.source);
	assert.equal(plugin.composerMathTokens("$a\nb$").length, 0);
});

test("composer renders MathML and preserves exact LaTeX in the sending field", () => {
	const text = String.raw`Compare $x^2$ with $$\begin{aligned}x&=1\\y&=2\end{aligned}$$.`;
	const { input, editor } = composer(text);
	assert.equal(input.hidden, true);
	assert.equal(editor.querySelectorAll("math").length, 2);
	assert.equal(editor.querySelectorAll('[data-display="true"]').length, 1);
	assert.equal(input.value, text);
	assert.equal(editor.querySelector("math").namespaceURI, "http://www.w3.org/1998/Math/MathML");
});

test("caret after closing $$ opens source, moving away renders again", () => {
	const text = "Before $$x^2$$ after";
	const env = composer(text);
	env.input.focus();
	env.input.setSelectionRange(text.indexOf(" after"), text.indexOf(" after"));
	assert.equal(env.editor.querySelector("math"), null);
	assert.equal(env.editor.textContent, text);
	env.input.setSelectionRange(text.length, text.length);
	assert.ok(env.editor.querySelector("math"));
	assert.equal(env.input.value, text);
	// DOM selection changes (arrow keys / mouse) use the same automatic rule.
	const trailing = env.editor.lastChild;
	env.window.getSelection().setBaseAndExtent(trailing, 0, trailing, 0);
	env.document.dispatchEvent(new env.window.Event("selectionchange"));
	assert.equal(env.editor.querySelector("math"), null);
	assert.equal(env.input.value, text);
});

test("clicking a rendered formula starts editing at its closing delimiter", () => {
	const env = composer("$a+b$ tail");
	env.editor.querySelector(".abstractin-composer-formula").click();
	assert.equal(env.document.activeElement, env.editor);
	assert.equal(env.editor.querySelector("math"), null);
	const selection = env.window.getSelection();
	assert.equal(selection.anchorNode.textContent, "$a+b$");
	assert.equal(selection.anchorOffset, 5);
});

test("Enter inside a multiline formula inserts a line; outside forwards send shortcut", () => {
	const env = composer("$$a=b$$ tail");
	let sent;
	env.input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); sent = env.input.value; } });
	env.input.focus();
	env.input.setSelectionRange(5, 5);
	key(env, "Enter");
	assert.equal(env.input.value, "$$a=b\n$$ tail");
	assert.equal(sent, undefined);
	env.input.setSelectionRange(env.input.value.length, env.input.value.length);
	key(env, "Enter");
	assert.equal(sent, "$$a=b\n$$ tail");
});

test("plain-text paste retains formulas and rejects pasted HTML; undo and redo restore the draft", () => {
	const env = composer("Ask ");
	env.input.focus(); env.input.setSelectionRange(4, 4);
	let changed = 0;
	env.input.addEventListener("input", () => changed++);
	const event = new env.window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? "$x^2$?" : '<img src="bad"/>', files: [] } });
	env.editor.dispatchEvent(event);
	assert.equal(env.input.value, "Ask $x^2$?");
	assert.ok(env.editor.querySelector("math"));
	assert.equal(env.editor.querySelector("img"), null);
	assert.equal(changed, 1);
	key(env, "z", { ctrlKey: true });
	assert.equal(env.input.value, "Ask ");
	key(env, "z", { ctrlKey: true, shiftKey: true });
	assert.equal(env.input.value, "Ask $x^2$?");
});

test("image paste continues through the existing textarea attachment handler", () => {
	const env = composer();
	env.input.addEventListener("paste", event => { assert.equal(event.clipboardData.files.length, 1); event.preventDefault(); });
	const event = new env.window.Event("paste", { cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: { files: [{ type: "image/png" }], getData: () => "ignored" } });
	env.editor.dispatchEvent(event);
	assert.equal(env.input.value, "");
});

test("copy uses original LaTeX; invalid formulas stay editable plain text", () => {
	const env = composer(String.raw`$\notACommand{x}$ and $y$`);
	assert.equal(env.editor.querySelectorAll("math").length, 1);
	env.input.focus();
	env.input.setSelectionRange(0, env.input.value.length);
	let copied;
	const event = new env.window.Event("copy", { cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: { setData: (type, text) => { assert.equal(type, "text/plain"); copied = text; } } });
	env.editor.dispatchEvent(event);
	assert.equal(copied, env.input.value);
});

test("IME composition does not rerender source or forward Enter to send", () => {
	const env = composer("$x$");
	env.input.focus(); env.input.setSelectionRange(2, 2);
	let sent = false;
	env.input.addEventListener("keydown", () => { sent = true; });
	env.editor.dispatchEvent(new env.window.Event("compositionstart"));
	key(env, "Enter", { isComposing: true });
	assert.equal(sent, false);
	env.editor.textContent = "$中文$";
	env.editor.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.editor.textContent, "$中文$");
	assert.equal(env.input.value, "$中文$");
	env.editor.dispatchEvent(new env.window.Event("compositionend"));
});

test("programmatic drafts, placeholder and disabled state remain compatible", () => {
	const env = composer();
	env.input.placeholder = "Ask about this paper";
	assert.equal(env.editor.dataset.placeholder, env.input.placeholder);
	env.input.value = "$x$";
	assert.ok(env.editor.querySelector("math"));
	env.input.disabled = true;
	assert.equal(env.editor.getAttribute("contenteditable"), "false");
	key(env, "Backspace");
	assert.equal(env.input.value, "$x$", "disabled composer does not delete the draft");
	env.input.disabled = false;
	assert.equal(env.editor.getAttribute("contenteditable"), "true");
	env.input.value = "";
	assert.equal(env.editor.textContent, "");
	env.dispose();
});

test("Backspace and Delete edit the draft even when the host cancels keys on the hidden textarea", () => {
	const env = composer("hello world");
	let forwarded = 0, changed = 0;
	env.document.addEventListener("keydown", event => {
		if (event.target === env.input) { forwarded++; event.preventDefault(); }
	});
	env.input.addEventListener("input", () => changed++);
	env.input.focus(); env.input.setSelectionRange(5, 5);
	key(env, "Backspace");
	assert.equal(env.input.value, "hell world");
	key(env, "Delete");
	assert.equal(env.input.value, "hellworld");
	assert.equal(forwarded, 0);
	assert.equal(changed, 2);
	env.input.setSelectionRange(0, env.input.value.length);
	key(env, "Backspace");
	assert.equal(env.input.value, "");
	assert.equal(env.editor.dataset.empty, "true");
	key(env, "z", { ctrlKey: true });
	assert.equal(env.input.value, "hellworld");
});

test("deletion removes a whole Unicode grapheme and supports word deletion", () => {
	const env = composer("a👨‍👩‍👧‍👦e\u0301");
	env.input.focus(); env.input.setSelectionRange(env.input.value.length);
	key(env, "Backspace");
	assert.equal(env.input.value, "a👨‍👩‍👧‍👦");
	key(env, "Backspace");
	assert.equal(env.input.value, "a");
	env.input.value = "hello world";
	env.input.setSelectionRange(11);
	key(env, "Backspace", { ctrlKey: true });
	assert.equal(env.input.value, "hello ");
	env.input.setSelectionRange(0);
	key(env, "Delete", { ctrlKey: true });
	assert.equal(env.input.value, " ");
});

test("beforeinput deletion edits formula source and can clear the final character", () => {
	const env = composer("$x$ tail");
	env.input.focus(); env.input.setSelectionRange(2);
	const deletion = new env.window.InputEvent("beforeinput", { inputType: "deleteContentBackward", cancelable: true });
	env.editor.dispatchEvent(deletion);
	assert.equal(env.input.value, "$$ tail");
	env.input.value = "a"; env.input.setSelectionRange(1);
	key(env, "Backspace");
	assert.equal(env.input.value, "");
	env.editor.replaceChildren(env.document.createElement("br"));
	env.editor.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.input.value, "", "Gecko filler br is not a new line in the draft");
	assert.equal(env.editor.dataset.empty, "true");
});

test("ordinary text input keeps the native text node and updates placeholder state", () => {
	const env = composer();
	env.input.focus();
	const text = env.editor.firstChild;
	text.data = "hello";
	env.window.getSelection().setBaseAndExtent(text, 5, text, 5);
	env.editor.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.editor.firstChild, text, "typing does not rebuild plain-text DOM");
	assert.equal(env.input.value, "hello");
	assert.equal(env.editor.dataset.empty, "false");
});

test("caret inside a MathML glyph reveals visible source at the correct formula offset", () => {
	const text = "Before $$x^2$$ after";
	const env = composer(text);
	env.editor.focus();
	const glyph = env.editor.querySelector("mi").firstChild;
	env.window.getSelection().setBaseAndExtent(glyph, 1, glyph, 1);
	env.document.dispatchEvent(new env.window.Event("selectionchange"));
	assert.equal(env.input.value, text);
	const raw = env.editor.querySelector(".abstractin-composer-source");
	assert.equal(raw.textContent, "$$x^2$$");
	assert.equal(env.window.getSelection().anchorNode, raw.firstChild);
	assert.equal(env.window.getSelection().anchorOffset, raw.textContent.length);
	// Editing the shown source still preserves the rest of the sentence.
	raw.firstChild.data = "$$x^3$$";
	env.editor.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.input.value, "Before $$x^3$$ after");
});

for (const backwards of [false, true]) {
	test(`selecting an entire sentence across formulas preserves the ${backwards ? "backward" : "forward"} range and deletes it in one keypress`, () => {
		const text = "Compare $x^2$ and $$y^2$$ now.";
		const env = composer(text);
		env.editor.focus();
		const first = env.editor.firstChild, last = env.editor.lastChild;
		const formula = env.editor.querySelector(".abstractin-composer-formula");
		const selection = env.window.getSelection();
		selection.setBaseAndExtent(...(backwards ? [last, last.length, first, 0] : [first, 0, last, last.length]));
		env.document.dispatchEvent(new env.window.Event("selectionchange"));
		assert.equal(env.editor.querySelector(".abstractin-composer-formula"), formula, "selection must not rebuild the editor");
		formula.click();
		assert.equal(selection.isCollapsed, false, "formula click must not collapse a selected sentence");
		key(env, backwards ? "Delete" : "Backspace");
		assert.equal(env.input.value, "");
		key(env, "z", { ctrlKey: true });
		assert.equal(env.input.value, text);
	});
}

test("drag selection is not interrupted when the pointer crosses a formula", () => {
	const env = composer("Before $x$ after");
	env.editor.focus();
	const formula = env.editor.querySelector(".abstractin-composer-formula");
	const glyph = formula.querySelector("mi").firstChild;
	env.editor.dispatchEvent(new env.window.Event("pointerdown", { bubbles: true }));
	env.window.getSelection().setBaseAndExtent(glyph, 0, glyph, 0);
	env.document.dispatchEvent(new env.window.Event("selectionchange"));
	assert.equal(env.editor.querySelector(".abstractin-composer-formula"), formula);
	const first = env.editor.firstChild, last = env.editor.lastChild;
	env.window.getSelection().setBaseAndExtent(first, 0, last, last.length);
	env.document.dispatchEvent(new env.window.Event("pointerup"));
	assert.equal(env.window.getSelection().isCollapsed, false);
	key(env, "Backspace");
	assert.equal(env.input.value, "");
});

test("selection starting in MathML removes the whole source token and only the selected following text", () => {
	const env = composer("Before $x^2$ after. Keep this.");
	env.editor.focus();
	const glyph = env.editor.querySelector("mi").firstChild;
	const last = env.editor.lastChild;
	env.window.getSelection().setBaseAndExtent(glyph, 0, last, " after.".length);
	env.document.dispatchEvent(new env.window.Event("selectionchange"));
	key(env, "Delete");
	assert.equal(env.input.value, "Before  Keep this.");
});

test("host select-all endpoints surrounding the composer are clamped to the draft", () => {
	const env = composer("A whole sentence with $x$.");
	env.editor.focus();
	const body = env.document.body;
	env.window.getSelection().setBaseAndExtent(body, 0, body, body.childNodes.length);
	key(env, "Backspace");
	assert.equal(env.input.value, "");
});
