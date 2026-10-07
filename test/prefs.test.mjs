import test from "node:test";
import assert from "node:assert/strict";
import { loadPlugin } from "./load-plugin.mjs";

const PREFIX = "extensions.abstractin.";

function pane(prefs = {}) {
	const env = loadPlugin({ prefs });
	const container = env.document.createElement("div");
	env.document.body.appendChild(container);
	env.plugin.renderPrefsPane(env.document, container);
	return { ...env, container };
}
const card = (container, title) => [...container.querySelectorAll(".abstractin-card")]
	.find(c => c.querySelector(".abstractin-card-title").textContent === title);
const change = (window, el, value) => {
	el.value = value;
	el.dispatchEvent(new window.Event("change"));
};

test("settings pane renders its cards", () => {
	const { container } = pane();
	assert.deepEqual([...container.querySelectorAll(".abstractin-card-title")].map(h => h.textContent),
		["Assistants", "Chat", "Appearance", "Behaviour"]);
	assert.equal(container.querySelectorAll(".abstractin-agent").length, 3);
});

test("reading agent selection requires checks; native models and efforts remain configurable", () => {
	const { container, prefs, window, plugin } = pane();
	let assistants = card(container, "Assistants");
	change(window, assistants.querySelector(".abstractin-select"), "agy");
	assert.equal(plugin.readingAgent(), "codex");
	assert.match(assistants.querySelector(".abstractin-notice").textContent, /Test this agent/);
	prefs[PREFIX + "agentValidation"] = JSON.stringify({ agy: { configKey: plugin.agentConfigKey("agy"), discussion: true } });
	plugin.renderPrefsPane(window.document, container);
	assistants = card(container, "Assistants");
	change(window, assistants.querySelector(".abstractin-select"), "agy");
	assert.equal(prefs[PREFIX + "readingAgent"], "agy");
	const claude = assistants.querySelector('[data-backend="claude"]');
	const [model, effort] = claude.querySelectorAll(".abstractin-select");
	change(window, model, "opus");
	change(window, effort, "max");
	assert.equal(prefs[PREFIX + "claude.model"], "opus");
	assert.equal(prefs[PREFIX + "claude.effort"], "max");
});

test("extra Codex models appear in its model list", () => {
	const { container, window, plugin } = pane();
	const codex = card(container, "Assistants").querySelector('[data-backend="codex"]');
	change(window, codex.querySelector('input[type="text"]'), "gpt-5.5, gpt-5.5-mini");
	assert.deepEqual([...card(container, "Assistants").querySelector('[data-backend="codex"] .abstractin-select').options].map(o => o.value), ["", "gpt-5.5", "gpt-5.5-mini"]);
	assert.deepEqual([...plugin.getModels("codex").map(m => m.id)], ["", "gpt-5.5", "gpt-5.5-mini"]);
});

test("Claude user-settings switch toggles the pref", () => {
	const { container, prefs } = pane();
	const toggle = card(container, "Assistants").querySelector('[data-backend="claude"] .abstractin-switch');
	toggle.click();
	assert.equal(prefs[PREFIX + "useClaudeUserSettings"], true);
	assert.equal(toggle.getAttribute("aria-checked"), "true");
});

const rowControl = (cardEl, label) => [...cardEl.querySelectorAll(".abstractin-row")]
	.find(r => r.querySelector(".abstractin-row-label").textContent === label);
const choose = (cardEl, label, option) => [...rowControl(cardEl, label).querySelectorAll(".abstractin-segmented button")]
	.find(b => b.textContent === option).click();

test("accent, text size, spacing and font are saved", () => {
	const { container, prefs } = pane();
	const appearance = card(container, "Appearance");
	appearance.querySelector('.abstractin-swatch[aria-label="Violet"]').click();
	choose(appearance, "Text size", "Large");
	choose(appearance, "Spacing", "Compact");
	choose(appearance, "Font", "Serif");
	assert.deepEqual(JSON.parse(prefs[PREFIX + "appearance"]), {
		accent: "#6d4fd6", size: "large", density: "compact", font: "serif",
		mascot: "marmoset", labels: "icons",
	});
	assert.equal(container.querySelector(".abstractin-prefs").style.getPropertyValue("--abstractin-accent"), "#6d4fd6");
	assert.equal(appearance.querySelector('.abstractin-swatch[aria-label="Violet"]').getAttribute("aria-checked"), "true");
	appearance.querySelector('.abstractin-swatch[aria-label="Zotero"]').click();
	assert.equal(JSON.parse(prefs[PREFIX + "appearance"]).accent, "");
});

test("retired decorations and troubleshooting are absent and old preferences have no visual effect", () => {
	const { container, plugin, document, prefs } = pane({ [PREFIX + "appearance"]: JSON.stringify({
		style: "glass", background: "background-1700000000000.png", pattern: "stars", corners: "square",
		glow: true, glassOpacity: 80, glassBlur: 30, accent: "#6d4fd6", font: "comic",
	}) });
	const appearance = card(container, "Appearance");
	assert.deepEqual([...appearance.querySelectorAll(".abstractin-row-label")].map(el => el.textContent),
		["Reading companion", "Button labels", "Accent colour", "Spacing", "Font", "Text size"]);
	assert.ok(!card(container, "Troubleshooting"));
	const root = document.createElement("div");
	root.innerHTML = '<div class="abstractin-backdrop"><div class="abstractin-backdrop-image" style="background-image:url(old.png)"></div></div>';
	root.style.setProperty("--abstractin-blur", "30px");
	plugin.applyAppearance(root);
	assert.equal(root.dataset.style, "flat");
	assert.equal(root.dataset.corners, "rounded");
	assert.equal(root.dataset.pattern, "none");
	assert.equal(root.dataset.bg, undefined);
	assert.equal(root.querySelector(".abstractin-backdrop-image").style.backgroundImage, "");
	assert.equal(root.style.getPropertyValue("--abstractin-blur"), "");
	assert.equal(root.style.getPropertyValue("--abstractin-accent"), "#6d4fd6");
	assert.equal(root.dataset.font, "zotero");
	assert.ok(!("background" in JSON.parse(prefs[PREFIX + "appearance"])));
});

test("book and paper prompts are edited, ordered, removed and reset independently", () => {
	const { container, prefs, window, plugin } = pane();
	const chat = card(container, "Chat");
	const paper = chat.querySelector('.abstractin-prompt-editor[data-material-type="paper"]');
	const book = chat.querySelector('.abstractin-prompt-editor[data-material-type="book"]');
	assert.ok(book.textContent.includes("Book quick prompts"));
	assert.ok(paper.textContent.includes("Paper quick prompts"));
	const saved = () => JSON.parse(prefs[PREFIX + "prompts.paper"]);
	[...paper.querySelectorAll("button")].find(b => b.textContent === "Add prompt").click();
	let rows = paper.querySelectorAll(".abstractin-prompt-row");
	assert.equal(rows.length, 5);
	const last = rows[4];
	last.querySelector("input").value = "Datasets";
	last.querySelector("input").dispatchEvent(new window.Event("input"));
	last.querySelector("textarea").value = "Which datasets are used?";
	last.querySelector("textarea").dispatchEvent(new window.Event("input"));
	assert.deepEqual(saved()[4], { label: "Datasets", prompt: "Which datasets are used?" });
	last.querySelector('[title="Move up"]').click();
	assert.equal(saved()[3].label, "Datasets");
	paper.querySelectorAll(".abstractin-prompt-row")[0].querySelector('[title="Remove"]').click();
	assert.deepEqual(saved().map(p => p.label), ["Core method", "Evidence for conclusions", "Datasets", "Assumptions and limitations"]);
	assert.equal(prefs[PREFIX + "prompts.book"], undefined);
	[...book.querySelectorAll("button")].find(b => b.textContent === "Restore defaults").click();
	assert.equal(plugin.getPrompts("book")[0].label, "Explain this passage");
	assert.equal(saved()[2].label, "Datasets", "resetting books leaves the paper list intact");
	assert.ok(!chat.textContent.includes("Explain better"));
});

test("legacy custom prompts are preserved without linking the two new lists", () => {
	const legacy = [{ label: "My question", prompt: "A custom question" }];
	const { plugin, prefs } = pane({ [PREFIX + "prompts"]: JSON.stringify(legacy) });
	assert.equal(plugin.getPrompts("book")[0].prompt, "A custom question");
	assert.equal(plugin.getPrompts("paper")[0].prompt, "A custom question");
	plugin.savePrompts([{ label: "Book only", prompt: "A book question" }], "book");
	assert.equal(plugin.getPrompts("book")[0].prompt, "A book question");
	assert.equal(plugin.getPrompts("paper")[0].prompt, "A custom question");
	assert.deepEqual(JSON.parse(prefs[PREFIX + "prompts"]), legacy);
});

test("chat settings omit retired drawing and LaTeX mode controls", () => {
	const { container } = pane({ [PREFIX + "modeButtons"]: JSON.stringify({ drawing: true, latex: true }) });
	const chat = card(container, "Chat");
	assert.ok(!chat.textContent.includes('“Drawing” button'));
	assert.ok(!chat.textContent.includes('“LaTeX” button'));
});

test("answer language: saved from Chat settings and used in every prompt", () => {
	const { container, prefs, window, plugin } = pane();
	const chat = card(container, "Chat");
	const select = rowControl(chat, "Answer language").querySelector("select");
	assert.equal(select.value, "");
	assert.match(plugin.systemPrompt(), /Reply in the language the user writes in\./);
	change(window, select, "Italiano");
	assert.equal(prefs[PREFIX + "language"], "Italiano");
	assert.match(plugin.systemPrompt(), /Always reply in Italiano, whatever language the user writes in\./);
	assert.match(plugin.formattingReminder(), /Always reply in Italiano, whatever language the user writes in\.\)$/);
	assert.match(plugin.buildAntigravityPrompt({ files: { metadata: "# T\n", annotations: "" }, question: "Why?", history: [], session: null }), /Always reply in Italiano/);
	prefs[PREFIX + "language"] = "Klingon";
	assert.equal(plugin.getLanguage(), "", "unknown values fall back to the question's language");
});

test("tiles: a visual radio group of icon cards", () => {
	const { plugin, document } = pane();
	let picked = null;
	const tiles = plugin.tiles(document, [
		{ value: "math", icon: "patternMath", label: "Maths" },
		{ value: "stars", icon: "sparkle", label: "Stars" },
	], "math", v => (picked = v));
	assert.equal(tiles.getAttribute("role"), "radiogroup");
	const [cat, owl] = tiles.querySelectorAll(".abstractin-tile");
	assert.equal(cat.getAttribute("aria-checked"), "true");
	assert.equal(owl.title, "Stars");
	assert.ok(owl.querySelector(".abstractin-i[data-icon='sparkle']"));
	owl.click();
	assert.equal(picked, "stars");
	assert.equal(owl.getAttribute("aria-checked"), "true");
	assert.equal(cat.getAttribute("aria-checked"), "false");
});

test("appearance: reading companion selection persists alongside labels", () => {
	const { container, prefs } = pane();
	const appearance = card(container, "Appearance");
	const tile = (label, title) => [...rowControl(appearance, label).querySelectorAll(".abstractin-tile")].find(t => t.title === title);
	assert.ok(!appearance.querySelector('.abstractin-tile[title="Cat"], .abstractin-tile[title="Owl"], .abstractin-tile[title="Robot"]'));
	assert.equal(tile("Reading companion", "Marmoset").getAttribute("aria-checked"), "true");
	tile("Reading companion", "White wagtail").click();
	assert.equal(JSON.parse(prefs[PREFIX + "appearance"]).mascot, "wagtail");
	tile("Reading companion", "Puffin").click();
	choose(appearance, "Button labels", "Icons + text");
	const saved = JSON.parse(prefs[PREFIX + "appearance"]);
	assert.equal(saved.mascot, "puffin");
	assert.equal(saved.labels, "text");
	const reopened = card(pane({ [PREFIX + "appearance"]: JSON.stringify(saved) }).container, "Appearance");
	assert.equal(rowControl(reopened, "Reading companion").querySelector('[data-value="puffin"]').getAttribute("aria-checked"), "true");
});

test("retired answer preferences do not reach agents; old instructions become explicit editable prompts", () => {
	const { plugin, prefs, container } = pane({ [PREFIX + "behaviour"]: JSON.stringify({
		length: "short", level: "expert", tone: "friendly", custom: "Use SI units.", sendKey: "mod-enter", autoScroll: false,
	}) });
	assert.deepEqual({ ...plugin.getBehaviour() }, { sendKey: "mod-enter", autoScroll: false, showSteps: true, showQuick: true });
	const reading = { reading: { type: "book" } };
	for (const text of [plugin.systemPrompt(), plugin.systemPrompt(reading), plugin.buildAntigravityPrompt({ files: { metadata: "# T", annotations: "" }, question: "Q", history: [], session: null })]) {
		assert.ok(!text.includes("Use SI units."));
		assert.ok(!text.includes("Keep answers short"));
		assert.ok(!text.includes("Write for an expert"));
		assert.ok(!text.includes("warm, encouraging"));
	}
	for (const type of ["book", "paper"]) {
		assert.equal(plugin.getPrompts(type).filter(entry => entry.prompt === "Use SI units.").length, 1);
		const editor = container.querySelector('.abstractin-prompt-editor[data-material-type="' + type + '"]');
		assert.ok([...editor.querySelectorAll("textarea")].some(node => node.value === "Use SI units."));
	}
	plugin.savePrompts([], "book");
	assert.equal(plugin.getPrompts("book").length, 0, "deleting the migrated instruction does not recreate it");
	assert.ok(plugin.getPrompts("paper").some(entry => entry.prompt === "Use SI units."));
	plugin.saveBehaviour({ ...plugin.getBehaviour(), length: "short", custom: "Hidden text" });
	assert.equal(JSON.parse(prefs[PREFIX + "behaviour"]).custom, undefined);
	assert.match(plugin.formattingGuide(), /rather than assigning a fixed learner level/);
});

test("behaviour card retains only interaction controls", () => {
	const { container, prefs } = pane();
	const behaviour = card(container, "Behaviour");
	assert.deepEqual([...behaviour.querySelectorAll(".abstractin-row-label")].map(node => node.textContent),
		["Send with", "Follow the answer", "Thinking steps", "Quick prompts"]);
	assert.equal(behaviour.querySelector("textarea"), null);
	choose(behaviour, "Send with", "⌘/Ctrl + Enter");
	rowControl(behaviour, "Follow the answer").querySelector(".abstractin-switch").click();
	rowControl(behaviour, "Thinking steps").querySelector(".abstractin-switch").click();
	rowControl(behaviour, "Quick prompts").querySelector(".abstractin-switch").click();
	assert.deepEqual(JSON.parse(prefs[PREFIX + "behaviour"]), {
		sendKey: "mod-enter", autoScroll: false, showSteps: false, showQuick: false,
	});
});

test("clarifications file: records are appended to clarifications.json in the paper folder", async () => {
	const { plugin, window } = pane();
	const files = {};
	window.Zotero.File = {
		getContentsAsync: async path => files[path],
		putContentsAsync: async (path, text) => { files[path] = text; },
	};
	window.OS = { Path: { join: (...p) => p.join("/") }, File: { exists: async path => path in files } };
	assert.deepEqual([...await plugin.loadClarifications("/d")], []);
	await plugin.appendClarification("/d", { id: "a", passage: "one" });
	await plugin.appendClarification("/d", { id: "b", passage: "two" });
	assert.deepEqual(JSON.parse(files["/d/clarifications.json"]).map(r => r.id), ["a", "b"]);
	files["/d/clarifications.json"] = "{broken";
	assert.deepEqual([...await plugin.loadClarifications("/d")], [], "a damaged file does not break the panel");
});
