<h1 align="center">AbstractIn</h1>

<p align="center"><a href="README.md">中文</a> | English</p>

<p align="center"><b>Read, ask, verify, and organize discussions in Zotero.</b><br>An AI reading assistant for books and scientific papers.</p>

<p align="center"><img src="src/content/companions/marmoset-idle.png" alt="AbstractIn marmoset reading companion" width="176"></p>

<p align="center">
  <a href="https://github.com/shen-zhang-42/abstractin/releases/latest"><img src="https://img.shields.io/github/v/release/shen-zhang-42/abstractin?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
</p>

AbstractIn adds a dedicated discussion panel to Zotero's PDF reader. Ask about the current page, a selected passage, a theorem, or a whole chapter; organize discussions by chapter, quote earlier results, and save reading records as editable Zotero notes.

The plugin works through an AI assistant CLI installed on your computer, with **Codex** as the default. Tools and reading workspaces run locally, while model processing uses the selected assistant's service. This is not offline inference.

## Getting started

1. Install and sign in to the local Codex CLI. Check that it can answer questions in your terminal.
2. Download **`abstractin.xpi`** from the [latest release](https://github.com/shen-zhang-42/abstractin/releases/latest).
3. In Zotero, open **Tools → Plugins → gear menu → Install Add-on From File**, select the XPI, and restart Zotero if prompted.
4. Open a book or paper PDF and click **AbstractIn** in the reader toolbar to open the panel on the right.
5. Click **`Let's start reading!`**, confirm the document, material type, and reading goal as prompted, then begin discussing it.

New documents require reading initialization before the composer and chat management become available. Previously confirmed documents restore their reading state and discussions when reopened. Installing the XPI does not require a Codespace, the project source code, or Node.js.

The plugin declares support for Zotero 7–10. Native interface behavior still needs installation testing across versions and operating systems.

The settings button checks Zotero's major version: Zotero 9 opens a separate AbstractIn settings window, while Zotero 10 keeps the native Settings → AbstractIn pane. Both use the same settings content and storage, so switching versions does not require reconfiguration.

The marmoset animation also selects its format by version: APNG on Zotero 9 and the existing animated WebP on Zotero 10, with identical frames, transparency, and timing.

## Reading and asking questions

### Separate workflows for books and papers

Books can initialize a table of contents from the source and organize discussions by chapter or appendix. Papers focus on reading goals and topics, with options to summarize the source or ask directly. The composer placeholder reflects the material type.

Reading workflows use the bundled `book-reading` and `scientific-paper-reading` skills and their supporting resources. Corresponding skills from a local skill directory can also be used.

### Finding the source from the current page

When you send a question, the plugin records the page currently open in Zotero and attempts to read its PDF text. When source verification is needed, it expands the search in this order:

**Current page → four pages before and after → current chapter → entire document.**

Lookup prioritizes theorem and definition headings and nearby proofs, so an earlier chapter's citation of a result is not mistaken for its original statement. Follow-up questions can reuse source references from the previous turn.

### Three answer modes

The mode menu at the bottom of the composer offers three strategies. **Balanced**, shown with a scales icon, is the default. Your selection is remembered; switching modes rebuilds the assistant thread while preserving the visible chat history.

| Mode | Behavior |
|---|---|
| **Context only** | Explains only the text, images, and current discussion supplied by the user. Does not read or search the PDF or supplement context from saved notes. Asks the user to paste essential missing material. |
| **Balanced** | Answers directly when existing context and knowledge are sufficient without guessing. Automatically checks the PDF when essential evidence, such as a theorem statement, proof, or author's view, is missing. General knowledge should be distinguished from source conclusions. |
| **Source only** | Bases factual claims only on inspected source material or original passages supplied by the user, without adding external knowledge. If supporting passages cannot be found, reports that they were not found within the searched scope rather than claiming that the entire book lacks them. |

In Balanced mode, explicitly asking to check the original text triggers verification directly. Short selections consisting only of a theorem number also receive priority lookup. For other questions, the assistant first assesses whether the available evidence is sufficient. If it asks the user to paste missing source text or reports that it cannot access the PDF, the plugin automatically performs one source lookup and retries the answer instead of accepting that refusal as the final response. Verification does not change the selected mode.

Context only does not access the PDF even when a question requests source lookup; switch modes when verification is needed. An explicit instruction not to read or search the document for the current turn also restricts source access in Balanced and Source only. In that case, Source only can use only source material already supplied. Reading initialization still reads document structure regardless of the discussion mode.

Lookup follows **current page → four pages before and after → current chapter → entire document**. If location or text extraction fails, the plugin reports the gap instead of presenting guesses as the book's conclusions. Physical PDF page numbers and printed page numbers are handled separately, and page links are generated only for verified locations. Automatic verification requires an assistant that supports source reading; scanned PDFs need OCR or page images supplied by the user.

The former Knowledge discussion setting maps to Balanced. Existing Source verification selections are retained as Source only.

### English vocabulary and usage tutoring

After selecting PDF text, **Ask Codex about this** remains the regular question interface. **Explain language** (formerly Explain this) directly activates language tutoring to explain the selection's English meaning, vocabulary, and grammar.

Questions about English word meanings, pronunciation, IPA, collocations, grammar, differences between expressions, or sentence naturalness automatically activate [`english-vocabulary-tutor`](skills/english-vocabulary-tutor/SKILL.md). No additional mode switch is needed. Sending a single English word can also generate a learning card.

The skill starts with an overview of common parts of speech and their meanings, lists common derived words and applicable grammatical forms (such as verb forms, noun plurals, and adjective comparisons), then explains the major senses separately, with American and British IPA, natural expressions, spoken and written examples, and short exercises. The target word, derived words, and each synonym and antonym receive explicit spoken/written usage labels, including when they are natural in both. Synonym and antonym comparisons focus on nuance, collocations, grammar, and whether substitution works in the target sense, illustrated with short paired examples. They do not expand unrelated senses of comparison words or recursively introduce more vocabulary. Questions about a specific passage prioritize its actual usage. As required by the skill, these answers are in English regardless of the ordinary answer-language setting. Scientific concepts and proof questions continue to use the regular reading workflow.

Vocabulary tutoring respects all three answer modes: Balanced can use language knowledge, while Context only and Source only do not add missing facts from external knowledge. When a textbook's specific usage requires source evidence, the plugin supplies the material; the vocabulary assistant itself does not execute tools or write files. The skill ships with the installation package and can be overridden by a folder with the same name in a custom skill directory.

### Quick questions, images, and formulas

- **Quick questions** appears at the top right of the composer. Selecting an option fills in a question that you can edit before sending; explanations appear on hover.
- Book and paper quick questions can be edited separately in settings.
- Ask about selected PDF passages, attach an image of the current PDF page, upload an image, or paste or drag one into the composer. Image support depends on the selected assistant.
- The composer uses a locally bundled CodeMirror 6 editor for inline `$…$` and display/multiline `$$…$$` formulas, rendered with the existing KaTeX. Clicking a formula or moving the caret into it or immediately after its closing delimiter reveals editable LaTeX source; moving away renders the formula again. Source highlighting distinguishes formula contents, commands, brackets, numbers, and `$` / `$$` delimiters, including unfinished formulas. Inline formulas align with the prose baseline. Enter inside `$$…$$` inserts a line; sending preserves the original LaTeX. CodeMirror handles selections, whole-sentence deletion, undo and IME input. Loading or runtime failure restores the native textarea with a separate formula preview.
- Answers support Markdown, KaTeX mathematics, formal results such as theorems and definitions, and sanitized SVG. Ask for formulas, derivations, or diagrams directly in your question.
- Copy answers and formula TeX, or stop an answer while it is being generated.

## Chat management

**Chats** at the top right combines browsing, management, search, and navigation.

Initialization output belongs to the **Initialization** group, which contains one chat by default. Reinitialization or an updated paper summary reuses that chat. Ordinary questions and new discussions do not append to it. The Move discussion destination list includes Initialization; manually moved chats remain separate and can later be moved to another chapter. Initialization turns previously stored in Unassigned are organized automatically when the document opens. Ordinary questions and answers remain in their original chats, and the original records are backed up before migration.

- **Browse by chapter:** Collapse or expand chapter headings. Each chat shows a prominent `Discussion-01` number and a topic name.
- **Automatic naming:** Codex summarizes the topic from the chat's questions. You can rename a chat manually, and manual names are preserved.
- **New discussions:** The button below the composer creates an independent discussion in the current chapter.
- **Jump to a turn:** Select **Turns** to preview questions and answers and jump to their location.
- **Search and navigate:** Search chat names and messages in the current document or across all documents, then select a result to jump to it. Search runs locally.
- **Delete and merge:** Delete individual or multiple chats, or merge selected chats with confirmation. Merged chats receive an automatically summarized name.
- **Delete a turn:** **Delete this turn** in an answer's more-actions menu removes the corresponding question and answer together.

Deleting or merging updates displayed chat numbers and result numbers within chats. Cross-chapter merges move to the unassigned group; merges within one chapter retain that chapter. Switching chats preserves unsent drafts, and each chat uses an independent assistant thread. Deleting a turn resets the thread so removed content is not reused as context.

Chat deletion primarily affects the history index and interface; local raw records may remain for recovery. Separately saved Zotero reading notes are not deleted when a turn is removed. Active answers and chat switching restrict conflicting operations.

Older chats can be imported through the migration entry in Chats and organized after their chapter assignments are confirmed. See [chapter discussions](docs/CHAPTER-DISCUSSIONS.md) for details.

## Quoting earlier discussions

**Quote** at the top right of the composer provides three levels of selection:

**Chapter → chat → theorem, definition, lemma, or other result.**

Review and edit the selected excerpt before inserting it into the current question. Insertion does not send the question automatically.

Discussion results use a separate **Chat** prefix and numbering style, for example:

- `Chat Theorem 1.1.1.1`
- `Chat Definition 1.1.1.2`
- `Chat Result 1.1.2.1`

The four components represent **chapter, chat, turn, and result number**, respectively. Different result types share the final counter; appendices use their appendix labels. These numbers remain distinct from the book's own labels, such as `Theorem A.78`, which are not rewritten.

Quotes are linked through stable result IDs. If deletion or merging changes the displayed numbers, existing quote labels update accordingly. Quoted assistant conclusions remain discussion content and do not replace verified source evidence.

## Reading records and synchronization

Reading records are saved as **editable Zotero child notes** under the document item. Full chat text and metadata, including chapters and result numbers, are also stored in dedicated chat notes. Long chats are split into chunks.

With Zotero data synchronization enabled, another computer running AbstractIn can restore chapter groups and complete discussions from synced notes. The new computer still needs Start Reading initialization for that document, and its PDF must be available locally. Continuing a discussion on another computer preserves its origin record to avoid directly overwriting the other computer's chat.

Synchronization scope differs by data type:

| Data | Storage and synchronization |
|---|---|
| Reading notes, full chat text and formulas, chat metadata | Zotero child notes, synchronized through Zotero data sync. |
| PDF attachments | Availability depends on Zotero file sync or local attachments. |
| Plugin settings, assistant sign-in and thread IDs, extracted text cache, image attachments | Stored locally; not synchronized through chat notes. |

Image questions may require supplying the images again on another computer. If a note cannot be written, the plugin preserves the local chat and reports the save issue. **Save as note** in the answer menu manually saves a complete answer.

Multi-device synchronization has automated test coverage, but synchronization between two real Zotero installations still requires hands-on verification.

## Reading companions and settings

Choose a **marmoset, white wagtail, or puffin** as your reading companion.

The current marmoset uses a transparent looping animation generated from the supplied video, with its first frame as the still image. It animates continuously on the welcome screen and only during answer generation in the discussion view, remaining still otherwise. The system's reduced-motion setting disables animation.

Settings include colors, fonts, font size, spacing, button labels, answer language, send shortcuts, automatic scrolling, process display, and quick questions. Answers can follow the question's language or use a specified language.

Codex is the default assistant. The plugin also retains built-in Claude Code and Antigravity adapters and supports configurable ACP v1 or AbstractIn JSONL assistants. Custom assistants must pass compatibility checks before use for reading. Source access, images, models, and reasoning options are enabled according to actual capabilities. Passing compatibility checks does not guarantee success on every task.

Choosing Claude or another unconfigured assistant in the model menu opens a four-step local CLI guide: find the installation, sign in through the official CLI in your terminal, test connection and reading support, then choose a model and enable. **Guided setup** in Settings reopens the guide. Claude and Codex both offer **Refresh … models** in the model menu to read the supported model catalog from the local CLI. Claude also offers refresh in Settings and the final setup step. Refresh sends no reading question and preserves the previous list and current selection on failure. AbstractIn never collects passwords. Tests send sample prompts to the provider and may use plan allowance; the current paper is not sent. Failed or cancelled setup does not enable the new assistant. See [assistant adapters](docs/agent-adapters.md) for configuration.

## Installation packages and updates

Each official release provides **`abstractin.xpi`** and **`updates.json`** under these fixed names:

- [Download the latest installation package](https://github.com/shen-zhang-42/abstractin/releases/latest/download/abstractin.xpi)
- [Read release notes](https://github.com/shen-zhang-42/abstractin/releases)

You can send the XPI to others for installation through Zotero's Install Add-on From File option. AbstractIn installations using this repository's plugin ID and update URL can check for updates in the plugin manager or upgrade according to Zotero's automatic-update settings.

The current version is **0.2.62**. The original Zusia uses a different plugin ID; its users must install AbstractIn manually once before receiving updates from this project.

## Data and privacy

AbstractIn's local workspace lives in `abstractin/` under the Zotero data directory. It contains chat caches, document copies, extracted text, images, and reading state. The plugin reads copies and caches without modifying the original PDF attachments.

Questions, supplied document context and images, and source text read by the assistant are sent through the selected assistant to its model service. Using a local CLI does not mean document contents always remain on your computer. Zotero notes are also uploaded to your Zotero synchronization service when data sync is enabled.

Diagnostic logs are stored at `<Zotero data directory>/abstractin/debug.log` and may contain questions or context excerpts. Review their contents before sharing.

## Current limitations

- There is no built-in OCR. Scanned PDFs or PDFs without extractable text may require page images or selected text.
- Source location depends on readable pages, contents, and extracted text. Unverified locations do not receive guessed links.
- Local assistants require separate installation, sign-in, and model permissions. A model's presence in the plugin menu does not guarantee that your account can access it.
- QMD/HTML reading-report export is not currently available.

## Development and validation

```sh
npm ci
npm run build        # Outputs abstractin.xpi in the project root
npm test             # Automated tests
npm run source:path  # Prints the absolute path to the local source directory
```

Choose native interface checks appropriate to your environment:

```sh
npm run shots        # Requires Firefox; generates interface screenshots
npm run test:zotero  # Linux Zotero integration checks; requires a suitable environment
ZOTERO_BIN=/path/to/zotero bash test/integration/composer.sh  # Input and formulas in an isolated empty library
ZOTERO_BIN=/path/to/zotero bash test/integration/appearance.sh
ZOTERO_BIN=/path/to/zotero bash test/integration/restart.sh
```

Automated tests cover reading workflows, chats, quotes, source location, settings, rendering, adapters, and related logic. They do not replace checks in real Zotero for the interface, animation, model access, or two-computer synchronization. See [Windows testing](docs/WINDOWS-TESTING.md) for installation and diagnostics. Historical validation entries there help investigate older issues; this README describes the current interface.

Keep versions consistent in `package.json`, `package-lock.json`, and `src/manifest.json` when publishing. The repository has a tag-triggered Release workflow that builds the XPI and update manifest. Manual releases must also upload both files:

```sh
npm run build
node scripts/updates.mjs
```

An official release must have a higher version than the installed version for Zotero to offer an update. Pushing documentation or code to `main` alone does not update existing installations.

## Origins and license

AbstractIn is based on **[Zusia](https://github.com/firekern/zusia)**, originally created by **[Andrea Porcelli (firekern)](https://github.com/firekern)**. This project is independently maintained and builds on that work with book and paper reading workflows, chapter-based chats, source lookup, discussion quoting, reading-record synchronization, and reading companions.

This project uses the **MIT license** and retains the original author's copyright notice and full license text. See [LICENSE](LICENSE). Third-party components and licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the corresponding license files ship with the installation package.

### DeepSeek API

Choose **Set up DeepSeek API…** in the model menu, or **Guided setup** under Settings → Assistants → DeepSeek API. The guide opens the official API key page, saves your key and refreshes available models, runs small connection and reading checks, then enables the assistant. API requests may incur charges. Keys stay in Zotero’s login manager, outside plugin preferences and chat history, and can be replaced or removed in the guide.

No local CLI is required. This integration supports text chat and Context only reading of selected or pasted text, without image input or local file tools. Changing the key or model requires another compatibility check.
