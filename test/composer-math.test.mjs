import test from "node:test";
import assert from "node:assert/strict";
import { loadPlugin } from "./load-plugin.mjs";

function composer(text = "", disabled = false) {
	const env = loadPlugin();
	const input = env.document.createElement("textarea");
	input.value = text;
	input.disabled = disabled;
	env.document.body.append(input);
	const nativeFocus = input.focus, nativeSelection = input.setSelectionRange;
	const dispose = env.plugin.installMathComposer(input);
	return { ...env, input, preview: input.parentElement.querySelector(".abstractin-math-preview"), nativeFocus, nativeSelection, dispose };
}

test("ordinary discussion frames never load the rich NoteOut entry", () => {
	const env = composer();
	assert.match(env.document.querySelector("iframe").src, /\/editor\/composer\.html$/);
	env.dispose();
	const input = env.document.createElement("textarea"); env.document.body.append(input);
	const dispose = env.plugin.installMathComposer(input, { note: true });
	assert.match(env.document.querySelector("iframe").src, /\/editor\/note\.html$/);
	dispose(); env.window.close();
});
const key = (env, key, options = {}) => {
	const event = new env.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
	env.input.dispatchEvent(event);
	return event;
};

test("font longhands refresh the live iframe even when Gecko cannot serialize a font shorthand", () => {
	const env = loadPlugin(), input = env.document.createElement("textarea");env.document.body.append(input);
	input.style.fontFamily = "Georgia, serif";
	const original = env.window.getComputedStyle.bind(env.window);
	env.window.getComputedStyle = node => node === input ? {font:"",fontFamily:input.style.fontFamily,fontSize:"15px",fontWeight:"400",fontStyle:"normal",fontStretch:"normal",lineHeight:"27px",getPropertyValue:()=>""} : original(node);
	let measured=0,finished=0;
	const dispose=env.plugin.installMathComposer(input,{note:true}), frame=env.document.querySelector("iframe");
	frame.contentWindow.AbstractInComposer={create:()=>({sync(){},select(){},measure(){measured++;},finishSourceEditing(){finished++;},destroy(){}})};
	frame.dispatchEvent(new env.window.Event("load"));
	assert.equal(frame.contentDocument.body.style.fontFamily,"Georgia, serif");
	input.style.fontFamily="Arial, sans-serif";input._refreshMathPreview();
	assert.equal(frame.contentDocument.body.style.fontFamily,"Arial, sans-serif");assert.ok(measured>=2);
	const button=env.document.createElement("button");env.document.body.append(button);button.dispatchEvent(new env.window.MouseEvent("mousedown",{bubbles:true,button:0}));assert.equal(finished,0,'source boundaries belong to the native note editor');
	dispose();button.dispatchEvent(new env.window.MouseEvent("mousedown",{bubbles:true,button:0}));assert.equal(finished,0);env.window.close();
});

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

test('NoteOut supports asynchronous native-editor initialization and disposal before it finishes',async()=>{
 const env=loadPlugin(),input=env.document.createElement('textarea');env.document.body.append(input);
 let resolve,disposed=0;
 const dispose=env.plugin.installMathComposer(input,{note:true}),frame=env.document.querySelector('iframe');
 frame.contentWindow.AbstractInComposer={create:()=>new Promise(done=>{resolve=done;})};
 frame.dispatchEvent(new env.window.Event('load'));assert.equal(input.hidden,false);
 dispose();resolve({destroy(){disposed++;}});await new Promise(done=>setTimeout(done,0));
 assert.equal(disposed,1);assert.equal(input.hidden,false);assert.equal(input._composerEditor,undefined);env.window.close();
});


test("native editing host stays visible and its DOM API is never replaced", () => {
	const env = composer("Compare $x^2$ and $$y^2$$.");
	assert.equal(env.input.hidden, false);
	assert.equal(env.input.focus, env.nativeFocus);
	assert.equal(env.input.setSelectionRange, env.nativeSelection);
	for (const property of ["value", "disabled", "placeholder", "focus", "setSelectionRange"])
		assert.equal(Object.hasOwn(env.input, property), false, property);
	assert.equal(env.preview.querySelectorAll("math").length, 2);
	assert.equal(env.document.querySelector("[contenteditable]"), null);
});

test("ordinary typing, deletion, select-all, paste and undo are not intercepted", () => {
	const env = composer("Hello $x$.");
	for (const [name, options] of [["a", {}], ["Backspace", {}], ["Delete", {}], ["a", { ctrlKey: true }], ["z", { ctrlKey: true }]]) {
		const event = key(env, name, options);
		assert.equal(event.defaultPrevented, false);
		assert.equal(event.cancelBubble, false);
	}
	for (const type of ["beforeinput", "paste", "copy", "cut"]) {
		const event = new env.window.Event(type, { cancelable: true });
		env.input.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false);
	}
});

test("caret at closing $$ marks editing without changing value, focus or selected text", () => {
	const text = "Before $$x^2$$ after";
	const env = composer(text);
	env.input.focus();
	env.input.setSelectionRange(text.indexOf(" after"), text.indexOf(" after"));
	env.input.dispatchEvent(new env.window.Event("select"));
	assert.equal(env.preview.querySelector("button").dataset.active, "true");
	assert.equal(env.document.activeElement, env.input);
	assert.equal(env.input.value, text);
	assert.equal(env.preview.querySelectorAll("math").length, 1, "formula never disappears while editing");
	env.input.setSelectionRange(0, text.length, "backward");
	env.input.dispatchEvent(new env.window.Event("select"));
	assert.equal(env.input.selectionStart, 0);
	assert.equal(env.input.selectionEnd, text.length);
	assert.equal(env.input.selectionDirection, "backward");
	assert.equal(env.preview.querySelector("button").dataset.active, "false");
});

test("clicking preview focuses native input at closing delimiter", () => {
	const env = composer("$a+b$ tail");
	env.preview.querySelector("button").click();
	assert.equal(env.document.activeElement, env.input);
	assert.equal(env.input.selectionStart, 5);
	assert.equal(env.input.selectionEnd, 5);
	assert.equal(env.input.value, "$a+b$ tail");
});

test("initially disabled input can be enabled through property or attribute without replacing input", async () => {
	const env = composer("$x$", true);
	assert.equal(env.preview.querySelector("button").disabled, true);
	env.input.disabled = false;
	await Promise.resolve();
	assert.equal(env.preview.querySelector("button").disabled, false);
	env.input.focus();
	assert.equal(env.document.activeElement, env.input);
	env.input.setAttribute("disabled", "");
	await Promise.resolve();
	assert.equal(env.preview.querySelector("button").disabled, true);
	env.input.removeAttribute("disabled");
	await Promise.resolve();
	assert.equal(env.preview.querySelector("button").disabled, false);
});

test("input events and programmatic draft resizing refresh only the preview", () => {
	const env = composer();
	assert.equal(env.preview.hidden, true);
	env.input.value = "$x$";
	env.plugin.autoGrow(env.input);
	assert.equal(env.preview.querySelectorAll("math").length, 1);
	assert.notEqual(env.input.style.height, "", "native textarea sizing is restored");
	env.input.value = "";
	env.input.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.preview.hidden, true);
});

test("renderer failure leaves native input usable with its draft and selection intact", () => {
	const env = composer("$$x$$ tail");
	env.input.focus(); env.input.setSelectionRange(0, 6);
	env.plugin.texToMathML = () => { throw new Error("renderer unavailable"); };
	env.input.value = "$$y$$ tail"; env.input.setSelectionRange(0, 6);
	env.input.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.preview.hidden, true);
	assert.equal(env.input.hidden, false);
	assert.equal(env.input.disabled, false);
	assert.equal(env.input.value, "$$y$$ tail");
	assert.equal(env.input.selectionStart, 0);
	assert.equal(env.input.selectionEnd, 6);
	assert.equal(key(env, "Backspace").defaultPrevented, false);
});

test("Enter inside open display math keeps native newline; outside reaches sending handler", () => {
	const env = composer("$$a=b$$ tail");
	let sent = 0;
	env.input.addEventListener("keydown", event => { if (event.key === "Enter") { sent++; event.preventDefault(); } });
	env.input.setSelectionRange(5, 5);
	assert.equal(key(env, "Enter").defaultPrevented, false);
	assert.equal(sent, 0);
	env.input.setSelectionRange(env.input.value.length, env.input.value.length);
	assert.equal(key(env, "Enter").defaultPrevented, true);
	assert.equal(sent, 1);
	env.input.value = "$$unfinished";
	env.input.setSelectionRange(env.input.value.length, env.input.value.length);
	assert.equal(key(env, "Enter").defaultPrevented, false);
	assert.equal(sent, 1);
	key(env, "Enter", { ctrlKey: true });
	assert.equal(sent, 2);
});

test("IME confirmation is not forwarded to sending and composition does not rebuild preview", () => {
	const env = composer("$x$");
	let sent = 0;
	env.input.addEventListener("keydown", () => sent++);
	const formula = env.preview.firstChild;
	env.input.dispatchEvent(new env.window.Event("compositionstart"));
	env.input.value = "$中文$";
	env.input.dispatchEvent(new env.window.Event("input"));
	assert.equal(env.preview.firstChild, formula);
	assert.equal(key(env, "Enter", { isComposing: true }).defaultPrevented, false);
	assert.equal(sent, 0);
	env.input.dispatchEvent(new env.window.Event("compositionend"));
	assert.equal(env.input.value, "$中文$");
	assert.notEqual(env.preview.firstChild, formula);
});

test("invalid math stays in editable source and dispose removes preview and hooks", () => {
	const env = composer(String.raw`$\unknownCommand{x}$ and $y$`);
	assert.equal(env.preview.querySelectorAll("math").length, 1);
	const original = env.input.value;
	env.dispose();
	assert.equal(env.input._refreshMathPreview, undefined);
	assert.equal(env.preview.isConnected, false);
	assert.equal(env.input.value, original);
	assert.equal(env.input.hidden, false);
});


test("CodeMirror initialization failure retains the native draft, selection and editing methods", () => {
	const env = composer("A draft with $x$.");
	env.input.focus(); env.input.setSelectionRange(0, env.input.value.length, "backward");
	const frame = env.document.querySelector("iframe");
	frame.contentWindow.AbstractInComposer = { create() { throw new Error("editor initialization failed"); } };
	frame.dispatchEvent(new env.window.Event("load"));
	assert.equal(env.input.hidden, false);
	assert.equal(env.input.focus, env.nativeFocus);
	assert.equal(env.input.setSelectionRange, env.nativeSelection);
	assert.equal(env.input.value, "A draft with $x$.");
	assert.equal(env.input.selectionStart, 0);
	assert.equal(env.input.selectionEnd, env.input.value.length);
	assert.equal(env.input.selectionDirection, "backward");
	assert.equal(env.input._composerEditor, undefined);
	assert.equal(env.document.querySelectorAll(".abstractin-math-preview").length, 1);
	assert.equal(key(env, "Backspace").defaultPrevented, false);
	env.dispose();
});
