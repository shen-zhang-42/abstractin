# Reading agents

Settings → Assistants has two creation entries: **Add agent (CLI)** and **Add API**. Existing Codex, Claude Code, Antigravity, DeepSeek credentials, selections and conversation identities are retained. Gemini CLI is a built-in ACP preset (`gemini --acp`). **Import adapter…** remains available for CLI configurations. Configuration is declarative data, not executable JavaScript. Imports open an editable preview and do not launch a command. Executables and argument arrays go directly to the subprocess API, without shell interpolation. CLI authentication remains with the local installation; custom CLIs inherit its environment.

Use **Set up …** in the model menu or **Guided setup** in Settings for a four-step guide. Unconfigured agents remain visible in the reading menu; choosing a model opens setup before changing the selected agent. The guide detects the executable, provides a copyable official sign-in command for Claude or Codex, checks local auth status, then runs the compatibility samples before enabling. Other adapters use their provider’s terminal sign-in flow and verify the connection through the compatibility request; the guide does not invent login commands. CLI installation and interactive login remain outside Zotero. On Windows the copied command targets PowerShell; a WSL-only installation cannot be used by native Windows Zotero. No passwords are entered in the plugin.

The CLI setup accepts an optional **CLI executable or search folder**, with an executable picker and a folder picker. A chosen executable is used directly after its file type is checked (`.exe` only for Claude Code and Antigravity on Windows). **Find CLI** searches that directory and its readable subdirectories. Leaving it blank starts at `C:\` on Windows (the home directory on other systems). Launcher folders within that root are checked first, then likely installation folders (editor extensions, `AppData\Local\Programs`, `Program Files`, the user folder) are searched completely, followed by the rest of the root without system folders such as `C:\Windows`; explicit directory searches do not fall back outside the selected root. Symlink directories and inaccessible folders are skipped. Closing setup cancels the search; a two-minute timeout reports incomplete coverage and asks for the executable itself or a narrower folder. The search directory is retained separately from the resolved executable. Only a successful lookup replaces the executable path, which is then reused for ordinary requests without another recursive scan. Existing manual executable paths remain available in Settings, and passive startup probes continue using those paths/normal executable discovery without a full-drive scan.

Compatibility samples send original reading skills and synthetic passages to the provider, may consume plan allowance, and never send the current paper. Discussion-only agents enable **Context only**. Failed or cancelled setup leaves the new agent disabled. Native Codex keeps its existing direct-selection behavior; its guide is available for troubleshooting.

A newly added assistant cannot be selected for reading until compatibility checks pass. These are finite samples, not proof of universal correctness. Local file access is tested separately for ACP/JSONL agents. API and text-CLI assistants can verify original sources using passages supplied by the plugin, without local file tools. Context only and explicit no-source requests still prohibit document retrieval. File-reading verification and plugin-supplied evidence are recorded separately.

Original skill files and supporting resources are not translated or rewritten. AbstractIn asks the agent for a restricted tool mapping, rejects invented operations/tools, supplies canonical skill content, and generates adaptation instructions. Overlays and results live under `agent-adaptations/`, outside skill directories. SHA-256 fingerprints cover all original skill resources. Configuration, reported agent version and skill-resource changes invalidate compatibility. Existing compatible configurations survive plugin updates. Agents should report a version; unreported version changes cannot be detected automatically.

The selected reading agent is shared between Settings and the chat's agent/model menu. A request captures that selection when it starts. Models, reasoning options and images are displayed according to supported capabilities. Native Codex remains available without re-running the new compatibility samples because its existing reading integration is retained.

## ACP v1

Gemini CLI uses the bundled `gemini --acp` preset. Install and sign in to the CLI outside Zotero, then use its Guided setup. Model lists, image input and session loading depend on the capabilities actually advertised by the installed CLI. No Gemini account is used by setup until the user runs connection/reading checks.

Example configuration:

```json
{
  "id": "custom-example",
  "name": "My ACP agent",
  "command": "/absolute/path/to/agent",
  "args": ["--acp"],
  "protocol": "acp"
}
```

The command and arguments must match the agent's documented ACP invocation. AbstractIn implements ACP protocol version 1 over newline-delimited JSON-RPC on standard input/output: initialize, new/load session when supported, prompt streaming, model selection when advertised, and process cancellation. Other protocol versions are rejected explicitly. The user must complete local agent sign-in before connecting; interactive authentication inside Zotero is not implemented.

The client advertises only read-only text-file access inside the current reading workspace. Traversal and symbolic links are rejected. File writes, terminal operations and permission requests are not granted. During Knowledge discussion, file reading is unavailable. These restrictions govern the client bridge; an independently running agent may also have its own tools, whose permissions remain under its own configuration.

Images are sent as ACP image content when advertised. Available session models are discovered during the compatibility run. ACP reasoning-effort configuration is not currently implemented and is not shown as a supported capability. Sessions use loading when advertised; otherwise a new session receives the plugin's chat transcript. Session IDs are namespaced by agent in the existing conversation storage.

Protocol references: [initialization](https://agentclientprotocol.com/protocol/v1/initialization), [sessions](https://agentclientprotocol.com/protocol/v1/session-setup), [prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn).

## AbstractIn JSONL adapter v1

For a CLI that does not speak ACP, provide a wrapper implementing the following contract and import its configuration:

```json
{
  "id": "custom-wrapper",
  "name": "Wrapped agent",
  "command": "/absolute/path/to/wrapper",
  "args": [],
  "protocol": "abstractin-jsonl"
}
```

The wrapper receives one JSON object on stdin followed by a newline and EOF. It must exit after processing the request. All diagnostics belong on stderr.

Capability request:

```json
{"protocol":"abstractin-jsonl/1","method":"capabilities","cwd":"/workspace", "prompt":""}
```

Return one plain JSON object on stdout:

```json
{
  "protocol": "abstractin-jsonl/1",
  "version": "1.0.0",
  "files": true,
  "images": false,
  "models": [{"id":"example-model","label":"Example model"}],
  "efforts": ["low","high"]
}
```

Prompt request fields: `protocol`, `method: "prompt"`, `prompt`, `instructions`, `context` (metadata and annotations), `history`, `sessionId`, `model`, `effort`, `images` (local staged image paths) and `cwd`. The wrapper must implement those features before advertising them. A `files: true` declaration is insufficient by itself: the compatibility test asks it to read an independently generated code from a local source fixture. The adapter's validated mapping name for local reading is `adapter-file-read`.

Streaming and final output:

```jsonl
{"type":"delta","text":"First part "}
{"type":"delta","text":"of the answer."}
{"type":"result","text":"Complete answer.","sessionId":"optional-session-id"}
```

A final `result` is required, and a nonzero exit status is a failure. Wrappers may reuse their own sessions or use the provided history. Stop terminates the wrapper process. AbstractIn does not install wrappers, execute imported JavaScript, or guess undocumented CLI protocols.

The compatibility prompts require normal AbstractIn reading-record output (`<abstractin-record>JSON</abstractin-record>`) and verify supplied passages, distinct physical/printed page coordinates, missing evidence, and optional source reading. Agents do not save notes directly: the existing plugin validation and Zotero note persistence remain authoritative.

## Text CLI

Choose **Text CLI (stdin / stdout)** for a noninteractive CLI that accepts plain text and returns a final answer. Configure the executable and its argument array. The plugin sends the prompt, instructions and relevant history on stdin. Arguments may contain `{model}` or `{prompt}` placeholders; when `{prompt}` is present, stdin is omitted. Prefer stdin for long prompts, especially on Windows. The CLI must support `--version` for compatibility checks. Use literal model arguments when it does not advertise a model list.

Text CLI has no portable image, streaming or session protocol. It uses plugin-supplied text evidence and returns stdout only after successful exit. Choose ACP/JSONL for structured streaming, images and sessions. On Windows, recognized npm `.cmd`/`.ps1` shims are resolved to their JS entry point and launched with Node directly. Other shell wrappers require a native executable or an explicitly configured Node executable/entry argument; no shell commands are synthesized.

## API providers

**Add API** supports OpenAI-compatible Chat Completions, Anthropic Messages, Gemini GenerateContent, and Custom JSON. Presets include GWDG SAIA and DeepSeek. The original DeepSeek setup and credential vault identity remain available without migration.

Configure a name, base URL, model ID and authentication (Bearer, named key header, or none). Advanced settings include relative chat/model-list paths, GET/POST model discovery, streaming, maximum output tokens, timeout, extra request parameters and image-capable model IDs. Models can be refreshed or entered manually. The SAIA preset uses `https://chat-ai.academiccloud.de/v1` and POST model discovery. Check the provider's current catalogue and mark only models that support image input. Model/key/configuration changes require another compatibility check before activation.

**Save API** automatically queries the configured model-list endpoint and displays an **Available models** picker beside the model settings. This uses the service's returned IDs and names, rather than a fixed SAIA model list. A preset model absent from that response is cleared in the form so the user can choose an available model. Selecting it fills the model ID; testing and enabling remain separate steps. Previously discovered choices remain visible when reopening setup; **Refresh models** obtains a fresh list. Failed discovery preserves the saved configuration and supports manual model IDs. Model discovery does not infer image support from model names.

Keys and extra headers are stored in Zotero's login manager, separately for each API profile. They are not included in preference JSON, transcripts or validation keys. Extra headers cannot replace the separately configured authentication or content-type header. No credentials are collected by importing CLI configuration. The plugin sends questions and bounded evidence to the configured service; model requests never require a CLI. Internal reasoning fields are not displayed. Failed, interrupted or output-truncated responses are reported explicitly.

OpenAI-compatible, Anthropic and Gemini protocols support streaming and inline Base64 page images for explicitly configured image-capable models. They receive existing reading skills and can request more plugin evidence using the same source-needed protocol. APIs do not receive local file or shell tools. The legacy DeepSeek connection remains text-only but can now use plugin-supplied source evidence.

Custom JSON supports non-streaming POST requests and textual answers. Supply a JSON body template with `{{model}}`, `{{prompt}}`, `{{system}}` and `{{messages}}` placeholders. An exact placeholder preserves its value type, so `"messages":"{{messages}}"` becomes an array. Use a dot-separated response path such as `output.0.text`. Custom JSON does not run scripts or support image input. APIs requiring other authentication/protocol behaviour need an adapter; a URL and model name alone cannot describe an arbitrary protocol.

References: [Gemini CLI ACP](https://geminicli.com/docs/cli/acp-mode/), [GWDG SAIA API](https://docs.hpc.gwdg.de/services/ai-services/saia/index.html).
