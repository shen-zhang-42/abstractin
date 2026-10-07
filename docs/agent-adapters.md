# Reading agents

Settings → Assistants keeps the three built-in adapters and adds **Add agent** and **Import adapter…**. Agent configuration is declarative JSON, not executable JavaScript. Imports open an editable preview and do not launch a command. Executables and argument arrays are passed directly to the subprocess API; no shell interpolation is performed. Authentication remains with the agent's own local installation. Custom adapters inherit the local process environment, including locally configured credentials; those values are not stored in imported adapter JSON.

A newly added agent cannot be selected for reading until **Test & adapt skills** passes the discussion checks. These are finite compatibility samples, not proof of universal correctness. Source access is tested separately. An agent that passes discussion but cannot read files is restricted to Knowledge discussion; contents initialization, summaries and source verification require source access.

Original skill files and supporting resources are not translated or rewritten. AbstractIn asks the agent for a restricted tool mapping, rejects invented operations/tools, supplies canonical skill content, and generates its own adaptation instructions. Overlays and results live in the plugin data folder under `agent-adaptations/`, outside original skill directories. SHA-256 fingerprints cover all original skill resources. Configuration, plugin version, reported agent version and skill-resource changes invalidate compatibility. Agents should report a version; unreported version changes cannot be detected automatically.

The selected reading agent is shared between Settings and the chat's agent/model menu. A request captures that selection when it starts. Models, reasoning options and images are displayed according to supported capabilities. Native Codex remains available without re-running the new compatibility samples because its existing reading integration is retained.

## ACP v1

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
