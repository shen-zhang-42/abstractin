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
	env.input.disabled = false;
	assert.equal(env.editor.getAttribute("contenteditable"), "true");
	env.input.value = "";
	assert.equal(env.editor.textContent, "");
	env.dispose();
});
