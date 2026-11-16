# Project handoff

Updated: 2026-11-16 (Europe/Berlin).

## Two independent projects

- This directory: AbstractIn, the existing Zotero plugin, with its existing Git history and GitHub automatic update channel.
- Sibling directory: ../air, a new independent Git repository for the planned Positron research extension. Open that directory to continue Air development.
- Do not move the existing plugin into Air or rename its technical identity as part of the split.

## AbstractIn status

- Release being prepared in this handoff: v0.2.168. Check GitHub and git status to confirm publication after reopening.
- Previous release: v0.2.167, with bottom-aligned standalone chat composers and independent per-window agent/model/effort selections.
- v0.2.168 replaces the old book-and-bubble mark with the approved Air bubble design, adapted to a scalable SVG without the wordmark.
- The displayed name remains AbstractIn. Airz (Air for Zotero) was proposed for a later rename; do not apply it yet.
- Preserve the plugin ID, preference prefix, data paths, note formats/tags, and update URL so installed users retain their data.
- Main repository: https://github.com/shen-zhang-42/abstractin

## Existing capabilities

Zotero-native reading, single-document and multi-document workspaces, scoped text/image retrieval, Markdown/math notes, independent chat windows, on-demand note and archived-turn searches, targeted agent note edits with confirm/discard review, and local CLI/API backends. All chats can access the current document/workspace sources and notes on demand; note-edit permissions follow user intent rather than a special chat role.

## Directory and component map

| Path | Purpose |
| --- | --- |
| src/manifest.json, src/bootstrap.js | Plugin identity, update channel, and lifecycle |
| src/content/abstractin.js, abstractin.css | Main controller, shared UI, composer, and settings |
| src/content/reading-layout*.js, reading-layout.css | Docking, floating surfaces, layouts, and host lifecycle |
| src/content/reader-panel.js, library-launcher.js | Zotero reader and library entry points |
| src/content/reading.js, reading-workflow.js, paper-guide.js | Reading context, retrieval, and guided figure discussion |
| src/content/source-images.js | Page and source image retrieval |
| src/content/note-editor.js, note-storage.js, reading-notes.js | Note editor, save logic, and source associations |
| src/content/editor/ | Bundled editor implementations and assets; inspect active editor wiring before changes |
| src/content/chats.js, chat-windows.js, scoped-chat.js | Conversations, additional windows, and shared scoped capabilities |
| src/content/chat-tools.js, chat-history-tools.js | Agent tools and searchable discussion turns |
| src/content/agents.js, cli-adapters.js, api-*.js | Per-view choices, engine adapters, API profiles, and setup |
| src/content/reading-export.js | Discussion summary/export selection |
| skills/ | Reading and extraction workflows bundled with the plugin |
| scripts/ | Asset generation, update metadata, and other build helpers |
| test/ | Focused tests, browser harnesses, and integration tooling |
| docs/ | Existing subsystem documentation |
| design/air/air-logo-approved.png | Approved logo concept, including the Air wordmark |
| src/content/icons/abstractin-mark.svg | Scalable bubble application mark |
| src/content/icon-assets.js, src/icons/icon16.svg, icon20.svg | Generated copies; regenerate with node scripts/bundle-icons.mjs |

## Air decisions to preserve

Air is the full product name. AI for Research and Abstract in Research are interpretations, not required expansions. Its icon uses floating bubbles and a central circle/square with opposing curved arrows, representing air, knowledge connections, transformation, and abstraction.

Use a lightweight custom interface around native agent engines. Keep engine selection separate from model provider selection. Preserve approval requests, user questions, interruption, streaming, tools, skills, and native session behavior instead of rebuilding execution loops. Do not promise complete native-extension parity without testing each client feature.

Keep Zotero authoritative for literature management, PDF attachments, annotations, notes, and sync. Maximize reuse of its reader and APIs; a small bridge fills missing interfaces. Never write the Zotero database directly.

Archive user questions, answers, references, and edit outcomes through application events, not optional model instructions. Keep engine-native session state and the searchable discussion archive separate but linked. Retrieve document text, images, notes, and archived turns on demand.

The user chose this custom lightweight wrapper over relying solely on native agent extension UIs because automatic archiving, custom UI, and unified agent/API management are requirements. Skills remain reusable workflows, not the entire application.

## Development and release notes

- Air currently contains documentation and assets only: no executable Positron extension, agent adapter, or Zotero bridge has been implemented.
- Implement components one at a time and validate one end-to-end prototype before broadening backend support.
- Read CONTRIBUTING.md and relevant docs before changing AbstractIn components. The user prefers focused checks and testing actual behavior themselves over an exhaustive UI test pass on every change.
- Never delete existing files/data without approval for the exact target. Preserve test/out, recovery files, and the pre-existing untracked test/initialization-test.log.
- Avoid UI Automation/computer-use inspection of Zotero: it previously activated accessibility and caused severe scrolling/window lag. Headless tests do not require attaching to Zotero.
- Current packaging fallback: test/out/package-library-launcher-final-20261028.ps1 -Version <version>, which verifies each archived file against source.
- Release helpers in ignored test/out contain no embedded credentials; credentials are obtained at execution time. Do not print credential output.
- Do not publish Air or create its remote repository without a separate user request.
