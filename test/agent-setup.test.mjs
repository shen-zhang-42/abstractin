import test from "node:test";
import assert from "node:assert/strict";
import { loadPlugin } from "./load-plugin.mjs";

function setup(id = "claude", options = {}) {
 const env = loadPlugin();
 const { plugin, document, window } = env;
 const root = document.createElement("div"); root.className = "abstractin-root"; document.body.append(root);
 window.Zotero.File = { createDirectoryIfMissingAsync: async () => {} };
 plugin.getDataDir = () => "/tmp/agent-test";
 plugin.findBinary = async () => "/local/" + id;
 plugin.queryAgentCapabilities = async () => ({ version: "test 1.0" });
 plugin.runAgentProcess = async () => ({ exitCode: 0, stdout: '{"loggedIn":true}', stderr: "" });
 plugin.setPref("backend", "codex"); plugin.setPref("readingAgent", "codex");
 plugin.testAndAdaptAgent = async (_, progress) => {
  progress("Checking sample evidence…");
  const result = { configKey: plugin.agentConfigKey(id), discussion: true, source: true };
  plugin.setPref("agentValidation", JSON.stringify({ [id]: result })); return result;
 };
 if (id.startsWith("custom-")) plugin.saveAgent({ id, name: "Local custom agent", command: "adapter", protocol: "acp" });
 const open = () => plugin.openAgentSetup(root, id, options);
 open();
 const click = async label => {
  const node = [...root.querySelectorAll("button")].find(node => node.textContent === label);
  assert.ok(node, "button exists: " + label); assert.equal(node.disabled, false, "button enabled: " + label);
  node.click(); await new Promise(resolve => setImmediate(resolve));
 };
 return { ...env, root, click, open };
}

async function throughSignIn(env) {
 await env.click("Find CLI"); await env.click("Continue");
 await env.click("Check sign-in"); await env.click("Continue");
}

test("Claude setup verifies executable and sign-in, tests and enables only at the end", async () => {
 const env = setup("claude", { reading: true, model: "sonnet" });
 const { plugin, root, click } = env;
 assert.equal(root.querySelector("input").type, "text");
 assert.equal([...root.querySelectorAll("button")].find(n => n.textContent === "Continue").disabled, true);
 const calls = [];
 plugin.runAgentProcess = async (command, args) => { calls.push([command, [...args]]); return { exitCode: 0, stdout: '{"loggedIn":true}' }; };
 await throughSignIn(env);
 assert.deepEqual(calls, [["/local/claude", ["auth", "status"]]]);
 assert.match(root.textContent, /Your paper is not sent/);
 assert.equal(plugin.readingAgent(), "codex");
 await click("Run connection & reading test"); await click("Continue");
 assert.equal(plugin.readingAgent(), "codex");
 await click("Enable Claude");
 assert.equal(plugin.readingAgent(), "claude"); assert.equal(plugin.getModel("claude"), "sonnet");
 assert.equal(root.querySelector(".abstractin-agent-setup"), null);
});

test("missing local CLI stays at first step and can be retried", async () => {
 const { plugin, click, root } = setup();
 plugin.findBinary = async () => { throw new Error("CLI is not installed"); };
 await click("Find CLI"); assert.match(root.textContent, /CLI is not installed/);
 assert.equal([...root.querySelectorAll("button")].find(n => n.textContent === "Continue").disabled, true);
 plugin.findBinary = async () => "/fixed/claude";
 await click("Find CLI"); await click("Continue"); assert.match(root.textContent, /Sign in with your provider/);
});

test("Claude not logged in cannot advance and never exposes auth output", async () => {
 const { plugin, click, root } = setup();
 plugin.runAgentProcess = async () => ({ exitCode: 1, stdout: '{"loggedIn":false,"token":"secret"}' });
 await click("Find CLI"); await click("Continue"); await click("Check sign-in");
 assert.match(root.textContent, /not signed in/); assert.doesNotMatch(root.textContent, /secret/);
 assert.equal([...root.querySelectorAll("button")].find(n => n.textContent === "Continue").disabled, true);
});

test("Codex uses its own login status command and preserves native selection until enable", async () => {
 const env = setup("codex"); const { plugin, click } = env;
 const calls = [];
 plugin.runAgentProcess = async (_, args) => { calls.push([...args]); return { exitCode: 0, stdout: "Logged in using ChatGPT" }; };
 await throughSignIn(env); assert.deepEqual(calls, [["login", "status"]]);
 await click("Run connection & reading test"); await click("Continue"); await click("Enable Codex");
 assert.equal(plugin.getBackend(), "codex");
});

test("custom adapters explain manual sign-in and require actual compatibility testing", async () => {
 const { plugin, root, click } = setup("custom-local", { reading: true });
 let authCalls = 0; plugin.runAgentProcess = async () => { authCalls++; throw new Error("Should not run invented login commands"); };
 await click("Find CLI"); await click("Continue"); assert.match(root.textContent, /cannot be checked automatically/);
 await click("I have signed in"); await click("Continue");
 assert.equal(authCalls, 0); assert.equal(plugin.readingAgent(), "codex");
 await click("Run connection & reading test"); await click("Continue"); await click("Enable Local custom agent");
 assert.equal(plugin.readingAgent(), "custom-local");
});

test("discussion-only agents enable context mode and explain source limitation", async () => {
 const env = setup("claude", { reading: true }); const { plugin, root, click } = env;
 plugin.testAndAdaptAgent = async () => {
  const result = { configKey: plugin.agentConfigKey("claude"), discussion: true, source: false };
  plugin.setPref("agentValidation", JSON.stringify({ claude: result })); return result;
 };
 await throughSignIn(env); await click("Run connection & reading test");
 assert.match(root.textContent, /Context only/); await click("Continue"); await click("Enable Claude");
 assert.equal(plugin.getPref("readingEvidenceMode"), "context");
});

test("failed compatibility test stays actionable and leaves selection unchanged", async () => {
 const env = setup(); const { plugin, click, root } = env;
 plugin.testAndAdaptAgent = async () => { throw new Error("Provider request failed"); };
 await throughSignIn(env); await click("Run connection & reading test");
 assert.match(root.textContent, /Provider request failed/); assert.equal(plugin.getBackend(), "codex");
 assert.equal([...root.querySelectorAll("button")].find(n => n.textContent === "Continue").disabled, true);
 await click("Back"); assert.match(root.textContent, /Sign in with your provider/);
});

test("closing during a check prevents late activation or dialog resurrection", async () => {
 const env = setup(); const { plugin, root, click } = env;
 let resolve; plugin.testAndAdaptAgent = () => new Promise(done => { resolve = done; });
 await throughSignIn(env); await click("Run connection & reading test"); await click("Close");
 resolve({ discussion: true, source: true }); await new Promise(done => setImmediate(done));
 assert.equal(root.querySelector(".abstractin-agent-setup"), null); assert.equal(plugin.getBackend(), "codex");
});

test("changing configuration after test blocks activation", async () => {
 const env = setup(); const { plugin, root, click } = env;
 await throughSignIn(env); await click("Run connection & reading test"); await click("Continue");
 plugin.setPref("claudePath", "/different/claude"); await click("Enable Claude");
 assert.match(root.textContent, /Configuration changed/); assert.equal(plugin.getBackend(), "codex");
});

test("CLI paths are copied as shell literals including spaces and apostrophes", async () => {
 for (const windows of [false, true]) {
  const { plugin, root, window, click } = setup();
  window.Zotero.isWin = windows; plugin.findBinary = async () => "/a user's tools/claude";
  let copied; window.Zotero.Utilities.Internal.copyTextToClipboard = text => { copied = text; };
  await click("Find CLI"); await click("Continue"); await click("Copy sign-in command");
  assert.equal(copied, windows ? "& '/a user''s tools/claude' auth login" : "'/a user'\\''s tools/claude' auth login");
  assert.equal(root.querySelectorAll('input[type="password"]').length, 0);
 }
});

test("Escape closes setup and returns keyboard focus", () => {
 const { plugin, root, document, window } = setup();
 const trigger = document.createElement("button"); root.append(trigger); trigger.focus();
 plugin.openAgentSetup(root, "claude");
 root.querySelector(".abstractin-agent-setup").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
 assert.equal(document.activeElement, trigger); assert.equal(root.querySelector(".abstractin-agent-setup"), null);
});
