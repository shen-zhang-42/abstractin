<h1 align="center">AbstractIn</h1>

<p align="center"><a href="README.md">中文</a> | English</p>

<p align="center"><b>Read, ask, verify, and organize discussions in Zotero.</b><br>An AI reading assistant for books and scientific papers.</p>

<p align="center"><img src="src/content/companions/marmoset-idle.png" alt="AbstractIn marmoset reading companion" width="176"></p>

<p align="center">
  <a href="https://github.com/shen-zhang-42/abstractin/releases/latest"><img src="https://img.shields.io/github/v/release/shen-zhang-42/abstractin?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
</p>

AbstractIn brings Zotero's native PDF reader, reading discussion, Markdown notes, and note discussion into one reading workflow. Work with one document or add several papers and books to a shared workspace, organize discussions, and save editable Zotero notes.

Use local **Codex, Claude Code, Gemini CLI, or Antigravity**, or connect an **API** provided by your institution or another service. CLIs use your local installation and sign-in; APIs use your configured endpoint, authentication, and model. Model processing takes place through the selected service.

## Features at a glance

This guide covers the features available in **v0.2.154**.

| Feature | What it provides |
|---|---|
| Single- and multi-document reading | Start with one document, add sources later, and create a workspace beneath an existing Zotero collection. |
| Composable panels | Choose two panels, four panels, four columns, or a separate note window; rearrange and resize plugin panels. |
| Source verification | Search text within progressively wider scopes, read matching passages, and inspect relevant PDF page images. |
| Paper summaries and figure guides | Summarize with the paper-reading skill, or explain each subfigure's construction, analysis, and results. |
| NoteOut writing | Markdown live preview, tables, KaTeX, commutative diagrams, fonts, and formatting shortcuts. |
| Separate discussions | Keep reading and per-note histories separate, with explicit quotations of selected content. |
| Whole-book discussion organization | Select new knowledge, copy original answers in their original language, organize by contents, and resume incrementally. |
| CLI and API connections | Find local CLIs, check compatibility, discover models, or configure custom API profiles. |

## Getting started

1. Install **Zotero 10** and download **`abstractin.xpi`** from the [latest release](https://github.com/shen-zhang-42/abstractin/releases/latest).
2. In Zotero, open **Tools → Plugins → gear menu → Install Add-on From File**, select the XPI, and restart if prompted.
3. Configure an assistant. For a CLI, install and sign in locally, then use **Setup** or **Guided setup** to find and check it. For an API, enter its endpoint, key, and model, test the connection, and choose **Enable**. APIs do not require a local CLI.
4. Click the **AbstractIn icon** at the top of Zotero and choose a layout from the illustrated menu. From the library, select documents, then use **Add selected documents → Start Reading**. Starting with several documents opens source management to confirm the workspace name and location.
5. Confirm a new document's title, material type, and reading goal. Initialize book contents, or ask about a paper and request a summary or figure guide when needed. Previously saved reading state and discussions are restored when reopened.

The XPI does not require a source checkout, Codespace, or Node.js. Settings are available in Zotero's native **Settings → AbstractIn** pane and through the global settings icon at the top right of the workspace. Hover over icons for their descriptions.

Linked PDFs in Dropbox or another external folder use Zotero's resolved paths and do not need to move into Zotero storage. If direct access is temporarily unavailable, the plugin can use the same attachment already loaded in Zotero. Original PDFs and attachment links remain unchanged.

## Layouts, windows, and sources

The single AbstractIn launcher offers four presets, illustrated with different colors for the native reader and plugin panels:

| Layout | Arrangement |
|---|---|
| **Read literature** | Literature and reading discussion side by side; direct startup uses the same interface as switching back from four panels. |
| **Four panels** | Literature, a full-height note, and vertically stacked reading and note discussions on the right. |
| **Four columns** | Literature, reading discussion, note editor, and note discussion, from left to right. |
| **Separate note window** | Literature and reading discussion remain in the main window; the note and its discussion float together. |

Zotero's native reader stays in place. Drag the other panels, use **Move** to change their dock position, or move them into independent windows and combine them again. Dividers resize the panels. The note editor and its discussion are linked for showing, hiding, and detaching. **Hide notes / Show notes** restores their previous placement, sizes, and floating layout. Opening another native Zotero PDF window does not automatically relocate existing discussion or note panels.

Panel headers share a gray style and icon commands; secondary actions collapse when space is limited. Global settings, layout, and source management sit above the workspace. The header follows the native reader toolbar's height and background, and sidebar width respects the space needed by the native reader.

### One document or a shared workspace

- **One document:** notes belong beneath that document and reading discussions concern it alone. No additional workspace collection is created.
- **Two or more documents:** use **Manage sources**, or **+ Add documents** at the top of the source dropdown. Confirm a name to create a shared workspace collection at the library root or beneath an existing collection.
- **Shared sources:** the toolbar shows a mode icon, separator, and active source title. Use the dropdown to inspect or switch sources. Reading and notes use the same document set; changing sources updates the links on the workspace's notes.
- **Storage:** multi-document notes and workspace reading records belong in the workspace collection. Each linked document's NoteOut entry can open the same note. Adding collection membership preserves other existing collection memberships.
- **Multiple notes:** use **New note** after **Save** to create and name a note, and **Open note** to switch among notes in the current document or workspace. Each note retains its own text, draft, and discussion history.

Sources must be editable documents with readable PDFs in the same library. Source titles identify scope rather than supplying evidence; adding documents does not mean the model has read all of them. Reading and note discussion histories remain separate. Content crosses between them only when explicitly quoted or supplied.

## Reading and asking questions

### Separate workflows for books and papers

First-time book initialization prepares the contents without copying the PDF or extracting the entire book. It searches the first 24 pages, pages near the current location and contents bookmark destinations, then follows detected continuations. If no directory is found, open the actual contents pages and retry. Bookmarks are optional: TOC page numbers, actual chapter headings and printed page footers verify chapter starts; explicit PDF page labels are also supported. Only a bounded anchor-search window and candidate chapter heading pages are read. Unverified ranges are not used for automatic grouping; a chapter can be selected manually. Paper setup allows immediate questions, with summaries generated only on request.

Books can initialize a table of contents from the source and organize discussions by chapter or appendix. Initialization reads all detected contents pages, including continuations, and supplies their complete text to the agent in batches without file-tool calls. Flattened directory rows are split before checking; OCR spacing and wrapped titles are matched by their full text and page labels, duplicate entries are removed, and exact source quotations are retained. The agent restores readable word spacing in display titles; remaining letter fragments trigger an additional heading cleanup pass restricted to the original letters and digits. Unpaged chapter headings also accept OCR spacing corrections against verbatim source evidence; validation errors identify missing or rejected headings and the reason. Reinitialization retains IDs for matching chapters. Once a discussion belongs to a chapter, unmapped selections and current-page questions reuse that chapter instead of repeatedly prompting; verified locations can still route to another chapter. PDF bookmark matching tolerates OCR spacing and rejects ambiguous duplicate headings. Entries are checked against the source and missing entries trigger one corrective pass; an incomplete result preserves existing contents and reports a retryable error. **Initialize contents / Reinitialize contents** remains available in the reading header or **More reading actions**, including after reading has started. Successful initialization automatically groups unassigned chats and chats whose chapter no longer exists. Single-chapter chats keep their IDs; mixed chats split only at complete question/answer boundaries. Existing valid chapter assignments remain unchanged. Uncertain content stays Unassigned. The selected agent may classify questions against chapter headings, using its allowance. Original transcripts and citation IDs are retained subject to the document’s note saving policy. Summary-only chats are grouped as whole chats without inventing missing question turns. Scanned or unreadable contents require OCR. Papers focus on reading goals and topics, with options to summarize the source or ask directly. The composer placeholder reflects the material type.

Reading workflows use the bundled `book-reading` and `scientific-paper-reading` skills and their supporting resources. No local skill directory is required. The plugin always uses its bundled originals and automatically extracts them unchanged into its own cache so local CLIs can read them.

### Finding the source from the current page

When you send a question, the plugin records the page currently open in Zotero and attempts to read its PDF text. When source verification is needed, it expands the search in this order:

**Current page → four pages before and after → current chapter → entire document.**

Lookup prioritizes original theorem and definition statements and nearby proofs rather than earlier citations. Insufficient evidence can trigger whole-book lookup, using local text matching on keywords and numbers before reading only the matching passages. Follow-up questions can reuse earlier source clues.

Papers have no fixed retrieval-count limit. Additional book lookup rounds are limited to one per 100 physical PDF pages, rounded up with a minimum of one: a 700-page book allows seven rounds. A reached limit or failed lookup identifies missing evidence rather than establishing that the source lacks it.

### Three answer modes

The mode menu at the bottom of the composer offers three strategies. **Balanced**, shown with a scales icon, is the default. The setting is remembered. Codex retains the same chat session across mode or model changes, and visible history is preserved.

| Mode | Behavior |
|---|---|
| **Context only** | Explains only the text, images, and current discussion supplied by the user. Does not read or search the PDF or supplement context from saved notes. Asks the user to paste essential missing material. |
| **Balanced** | Answers directly when existing context and knowledge are sufficient without guessing. Automatically checks the PDF when essential evidence, such as a theorem statement, proof, or author's view, is missing. General knowledge should be distinguished from source conclusions. |
| **Source only** | Bases factual claims only on inspected source material or original passages supplied by the user, without adding external knowledge. If supporting passages cannot be found, reports that they were not found within the searched scope rather than claiming that the entire book lacks them. |

In Balanced mode, explicitly asking to check the original text triggers verification directly. Short selections consisting only of a theorem number also receive priority lookup. For other questions, the assistant first assesses whether the available evidence is sufficient. If it asks the user to paste missing source text or reports that it cannot access the PDF, the plugin performs further source lookup according to the retrieval policy and continues the answer instead of accepting that refusal as the final response. Verification does not change the selected mode.

Context only does not access the PDF even when a question requests source lookup; switch modes when verification is needed. An explicit instruction not to read or search the document for the current turn also restricts source access in Balanced and Source only. In that case, Source only can use only source material already supplied. Reading initialization still reads document structure regardless of the discussion mode.

Lookup follows **current page → four pages before and after → current chapter → entire document**. If location or text extraction fails, the plugin reports the gap instead of presenting guesses as the book's conclusions. Physical PDF page numbers and printed page numbers are handled separately, and page links are generated only for verified locations. Automatic verification requires an assistant that supports source reading; scanned PDFs need OCR or page images supplied by the user.

Source verification supports PDF page images for both books and papers. The plugin first matches figure labels, captions or relevant text locally, then supplies relevant page images. The assistant can also request specific physical page images, up to four per retrieval round. Images are capped at 2000 pixels on their longest edge and cached for reuse. Open the corresponding PDF in Zotero and choose an image-capable assistant. Unavailable images are marked explicitly; captions alone do not establish visual inspection. Context only and explicit requests to avoid source access never generate page images automatically.

The former Knowledge discussion setting maps to Balanced. Existing Source verification selections are retained as Source only.

### English vocabulary and usage tutoring

A fixed header and icon back control keep navigation clear. Chapter rows show discussion counts; discussion rows show topics, and results separate numbers, titles, and excerpts. Review and edit the quotation before inserting it; nothing is sent automatically. Note discussion can also select its own saved answers or explicitly browse linked reading discussion, while preserving both histories.

Questions about English word meanings, pronunciation, IPA, collocations, grammar, differences between expressions, or sentence naturalness automatically activate [`english-vocabulary-tutor`](skills/english-vocabulary-tutor/SKILL.md). No additional mode switch is needed. Sending a single English word can also generate a learning card.

The skill starts with an overview of common parts of speech and their meanings, lists common derived words and applicable grammatical forms (such as verb forms, noun plurals, and adjective comparisons), then explains the major senses separately, with American and British IPA, natural expressions, spoken and written examples, and short exercises. The target word, derived words, and each synonym and antonym receive explicit spoken/written usage labels, including when they are natural in both. Synonym and antonym comparisons focus on nuance, collocations, grammar, and whether substitution works in the target sense, illustrated with short paired examples. They do not expand unrelated senses of comparison words or recursively introduce more vocabulary. Questions about a specific passage prioritize its actual usage. As required by the skill, these answers are in English regardless of the ordinary answer-language setting. Scientific concepts and proof questions continue to use the regular reading workflow.

Vocabulary turns use the current question and selected sentence with general language knowledge, regardless of the document reading mode. They do not retrieve PDF pages or notes, append earlier chat messages, or run document-reading tools. If a sentence lacks necessary context, the assistant asks for it. A submitted English sentence after a vocabulary question continues language feedback; scientific questions return to reading. The bundled skill is supplied once per Codex session and refreshed after an update, without repeating it on every word. No local skill directory is required.

Each chat retains one Codex session across vocabulary, ordinary reading, source checks, and model or answer-mode changes. Resuming retains Codex's own conversation memory even though vocabulary requests do not append history again. Temporary connection failures retain the session. If it cannot be restored, a replacement is announced and recorded in the chat. Replacing or deleting messages resets the affected Codex context explicitly so removed content is not silently retained. New chats and restored/merged transcripts start their own context; configured Summary and Don't save lifetimes still apply.

Codex uses the local `app-server` protocol to display incremental text while generating the full answer, including when resuming threads created by the previous `exec` integration. Word-card requirements are unchanged. Stopping retains the displayed text; generation errors are not saved as completed answers. Debug logs record initialization, thread readiness, turn acceptance, first text and completion timings to distinguish startup waits from generation time. This does not change global Codex configuration or terminate other Codex processes. A CLI with `app-server` support is required.

Selection actions Explain language and Ask reuse the visible chat for the exact PDF, without opening another sidebar or switching to the document's last saved discussion. They open the reading panel only when no matching chat is visible. Different object wrappers for the same window document and PDF tab reuse the panel and composer draft.

### Quick questions, images, and formulas

- **Quick questions** and **Quote** sit at the upper left of both reading and note composers. Questions fill the input for editing before sending; quotations are reviewed before insertion. Narrow panels wrap or shorten controls, with full descriptions on hover.
- Book and paper quick questions can be edited separately in settings.
- Ask about selected PDF passages, attach the current PDF page image, upload an image, or paste or drag one into the composer. Image support depends on the selected assistant.
- The composer uses bundled CodeMirror 6 for inline `$…$` and display/multiline `$$…$$` formulas with KaTeX. Clicking a formula or entering its source reveals LaTeX; moving away restores rendering. Source highlighting distinguishes commands and delimiters, including unfinished formulas. Enter inside a display formula inserts a line, and sending preserves the LaTeX. The editor handles selections, undo, and IME input, with a native-textarea fallback if loading fails.
- Answers support Markdown, KaTeX mathematics, formal results such as theorems and definitions, and sanitized SVG. Ask for formulas, derivations, or diagrams directly in your question. Theorem and proposition colors follow the selected discussion accent while panel controls remain gray.
- Copy answers and formula TeX, or stop an answer while it is being generated.

### Paper summaries and subfigure guides

Paper **Quick questions** includes two additional workflows:

- **Summarize paper:** follow the bundled `scientific-paper-reading` skill to explain the research question, methods, evidence, results, and limitations, saving an editable paper-summary note. This summarizes the source, separately from organizing earlier discussions below.
- **Guide through the paper:** start at the first verifiable figure and explain each subfigure's construction, analysis, and findings. Read the current figure and relevant text on demand, loading the next figure when needed rather than preparing the whole paper first.

Ask follow-up questions after each panel. Choose **Next subfigure** or reply “next,” “no questions,” or “continue” to advance. **Exit guide**, or “stop guide,” ends the walkthrough; otherwise it can continue through all subfigures. Assistants with streaming support display output as it arrives. Missing image or source evidence is identified; captions alone are not presented as visual inspection.

## Chat management

**Note saving** in the toolbar below the chat input, beside reasoning effort, controls that document and all its chats/PDF attachments. Each saving mode has its own icon. Different documents have independent settings. All interface labels are English:

- **Full:** preserve the complete conversation and existing Zotero note behavior.
- **Summary:** after each answer, its agent updates the current conversation summary, merging repeated questions and retaining conclusions, equations and unresolved questions. Updates reuse the previous summary plus new messages; unchanged input reuses its result. Summaries use low reasoning effort when supported. This uses the agent's allowance. The open window keeps full messages; local history and Zotero sync notes contain only the summary. Reopening the reading panel or window shows the summary with a fresh CLI session.
- **Don’t save:** new conversation messages, CLI sessions and automatic reading notes stay in memory and are cleared when the reading panel or window closes. No new transcript or sync note is created.

Changing the setting processes only this document’s open chats and in-memory sessions, leaving other documents unchanged. Documents without an override inherit the previous installation’s default; fresh installations default to Full. Existing historical notes are not batch-deleted or converted; untouched full histories remain available under Full mode. Once the current conversation has been saved as a summary and closed, its full messages are not restored. Failed summaries produce a visible warning and preserve the previous summary; full messages remain only in the open window. Open this document’s **Note saving** menu and choose **Retry summary** before closing.

New reading setup shows the prefilled title, material type and optional goal together. Edit any field (and select the attachment when several PDFs exist), then click **Confirm** once.


**NoteIn** is a collapsed virtual group under each document. On startup, AbstractIn automatically organizes its existing reading notes and saved conversations; newly saved notes join the same group. Legacy plugin notes whose titles start with `AbstractIn — ` are also organized automatically, without a button. Original note IDs, content, parent items and storage locations remain unchanged, and ordinary Zotero notes stay in place. One small NoteIn index note provides the group entry rather than a real subfolder. Notes explicitly marked as belonging to another document are excluded, and read-only libraries receive no index changes.

Expand the document and then **NoteIn** to view the notes. Unfiled Items, tag filters, text searches and saved searches support grouping beneath documents. Search views group only notes already present in the result, without adding unmatched notes. Standalone note hits without a parent document row and trash retain Zotero's native layout. Disabling AbstractIn restores the flat note list.

### Browsing, search, and reading positions

**Chats** at the top right combines browsing, management, search, and navigation.

Initialization output belongs to the **Initialization** group, which contains one chat by default. Reinitialization or an updated paper summary reuses that chat. Ordinary questions and new discussions do not append to it. The Move discussion destination list includes Initialization; manually moved chats remain separate and can later be moved to another chapter. Initialization turns previously stored in Unassigned are organized automatically when the document opens. Ordinary questions and answers remain in their original chats, and the original records are backed up before migration.

- **Browse by chapter:** Collapse or expand chapter headings. Each chat shows a prominent `Discussion-01` number and a topic name.
- **Automatic naming:** Codex summarizes the topic from the chat's questions. You can rename a chat manually, and manual names are preserved.
- **New discussions:** The button below the composer creates an independent discussion in the current chapter.
- **Reading positions:** Each chat remembers its last viewing position. Reopening restores it; sending a follow-up moves to the latest content.
- **Jump to a turn:** Select **Turns** to preview questions and answers and jump to their location.
- **Search and navigate:** Search chat names and messages in the current document or across all documents, then select a result to jump to it. Search runs locally.
- **Delete and merge:** Delete individual or multiple chats, or merge selected chats with confirmation. Merged chats receive an automatically summarized name.
- **Delete a turn:** **Delete this turn** in an answer's more-actions menu removes the corresponding question and answer together.

Deleting or merging updates displayed chat numbers and result numbers within chats. Cross-chapter merges move to the unassigned group; merges within one chapter retain that chapter. Switching chats preserves unsent drafts, and each chat uses an independent assistant thread. Deleting a turn resets the thread so removed content is not reused as context.

Chat deletion primarily affects the history index and interface; local raw records may remain for recovery. Separately saved Zotero reading notes are not deleted when a turn is removed. Active answers and chat switching restrict conflicting operations.

Older chats can be imported through the migration entry in Chats and organized after their chapter assignments are confirmed. See [chapter discussions](docs/CHAPTER-DISCUSSIONS.md) for details.

## Organizing whole-book or whole-paper discussions

Use **Export reading summary** in the reading header, under **More reading actions** when narrow, or **Note saving → Summarize all book conversations**. Papers have the corresponding entry. This collects saved answers across the current document's chapters and chats, rather than rereading or summarizing the whole source.

The model classifies batches of answers as new knowledge or duplicates. Questions provide classification context and are not exported separately. New examples, corrections, and substantive additions can be retained. The plugin copies selected answers verbatim, preserving their language, equations, and code instead of asking the model to rewrite long responses.

Knowledge follows the initialized table of contents rather than blindly inheriting each chat's chapter. Uncertain assignments stay **Unassigned**. **Book content** and **Language** are separate by default; language-learning or language-research books can use one part, with manual control through **Organization**.

Each batch previews and saves `exports/summary-state.json` for decisions, provenance, and progress, and `exports/reading-summary.md` for readable output. Unchanged work is reused, new answers are processed incrementally, interrupted jobs resume, and changed history rebuilds from the affected position. Summary-only histories are identified when full answers are unavailable. Generation uses the assistant's allowance and can save a Markdown copy; original chats, notes, and PDFs remain unchanged.

## NoteOut: writing and AI discussion

A note can dock alongside the source or float with its discussion. Both arrangements use the same Markdown text and per-note history. The title and file commands share one row; **Save, New note, and Open note** have distinct icons, with additional actions under **More**.

### Live preview editor

The editor uses **CodeMirror 6 and t-shoot Live Preview**. Edit Markdown directly: the active syntax appears as source while other content stays rendered. Supported content includes headings, bold, italics, lists, blockquotes, links, code blocks, and tables. Edit table cells directly or switch to table Markdown. Blockquotes use the editor's default Markdown behavior.

Markdown source is the authoritative note body. The editor fills the remaining height, with an independently scrolling body and a fixed header. Text and titles save automatically, or use **Save / Ctrl/Cmd+S**. Save is black when unsaved and gray after saving. External-change conflicts preserve a local draft instead of overwriting existing content. Ordinary Zotero notes are not automatically converted.

The formatting icon opens font and formatting controls plus **?** shortcut help. Fonts include System, Arial, Georgia, Times New Roman, Consolas, Microsoft YaHei, and SimSun. Changes apply immediately to display without rewriting Markdown. Bold, italic, and strikethrough commands keep edge whitespace outside the formatting markers.

| Shortcut | Action |
|---|---|
| Ctrl+B / Ctrl+I | Bold / italic |
| Ctrl+Shift+X | Strikethrough |
| Ctrl+E / Ctrl+Shift+K | Inline code / code block |
| Ctrl+K | Link |
| Ctrl+Alt+1–6 / Ctrl+Alt+0 | Heading / plain paragraph |
| Ctrl+Shift+8 / Ctrl+Shift+7 | Bullet / numbered list |
| Ctrl+Shift+L / Ctrl+Shift+9 | Task list / blockquote |
| Ctrl+S / Ctrl+Z / Ctrl+Y | Save / undo / redo |

On macOS, use Cmd for Ctrl and Option for Alt; redo is Cmd+Shift+Z. Shortcut customization is not currently available.

### Mathematics and commutative diagrams

KaTeX supports `$…$`, `$$…$$`, and simple `CD` diagrams. Click a formula to edit its LaTeX and move away to render it again. More complex diagrams use bundled TikZJax in a `tikzcd` code block, for example:

```tikzcd
\begin{tikzcd}
A \arrow[r, "f"] \arrow[d, "g"'] & B \arrow[d, "h"] \\
C \arrow[r, "k"'] & D
\end{tikzcd}
```

Leaving the block compiles its diagram; **Edit source** returns to editing. The engine and fonts ship locally, and unchanged diagrams reuse cached results. Errors and timeouts preserve the source with a visible message. Formula rendering inside table cells is not currently supported.

### Discussing, quoting, and proposing edits

Note discussion uses the existing model settings and the same composer style as reading discussion. Choose **Answer questions** or **Edit note**, with either the full note or **Use editor selection only** as context. Sending captures that version of the note; later edits do not change previously submitted context.

**Quick questions** and **Quote** sit at the upper left of the composer. Note questions offer summarizing, explaining the reasoning, and suggesting improvements. Quote can select saved answers from this note or explicitly browse results from linked reading discussion. Review the excerpt before inserting it; nothing is sent automatically and the two histories remain separate.

**Edit note** produces a preview: **Apply edit** applies and saves it, while **Discard** rejects it. If the note changed during generation, an outdated proposal cannot overwrite it. **More → Append last answer** adds the latest answer to the note. Where available, **Use in document discussion** fills the reading composer with selected text or the full note for review before sending.

Each note's discussion is stored in its local working directory and does not currently synchronize across devices with the note body. Models can discuss supplied note text and quoted passages; linked document titles do not establish access to their full text.

### Independent note management and deletion

The library's **New Markdown note / Open selected Markdown note** actions also open the NoteOut manager: a file list on the left, editor in the middle, and discussion on the right. Both dividers resize independently and remember their widths.

In this manager, the **editor Source** filters the note list, while a note's **Source** controls its actual document links. These are maintained separately, and the list includes the union of notes linked to the selected sources. Single-document notes live beneath that document's **NoteOut**; a shared note has one body in the library with links from its documents. A docked reading workspace instead uses its shared top-level sources.

The red **×** shown on hovering over a note entry, or **More → Move to Trash**, moves the note to Zotero Trash after confirmation. An active note's draft is saved first. Linked documents, other notes, and local recovery files remain. Shared links are updated and can be rebuilt by reopening a restored note.

## Quoting earlier discussions

**Quote** at the upper left of both composers inserts selected context explicitly. Reading discussion offers three levels:

**Chapter → chat → theorem, definition, lemma, or other result.**

Review and edit the selected excerpt before inserting it into the current question. Insertion does not send the question automatically.

Discussion results use a separate **Chat** prefix and numbering style, for example:

- `Chat Theorem 1.1.1.1`
- `Chat Definition 1.1.1.2`
- `Chat Result 1.1.2.1`

The four components represent **chapter, chat, turn, and result number**, respectively. Different result types share the final counter; appendices use their appendix labels. These numbers remain distinct from the book's own labels, such as `Theorem A.78`, which are not rewritten.

Quotes are linked through stable result IDs. If deletion or merging changes the displayed numbers, existing quote labels update accordingly. Quoted assistant conclusions remain discussion content and do not replace verified source evidence.

## Reading records and synchronization

Single-document reading records are editable Zotero notes in the document’s **NoteIn** group; multi-document reading records belong in the workspace collection. Dedicated chat notes store complete reading transcripts, chapters, and result numbers, with long transcripts split into chunks. NoteOut Markdown bodies are also stored as native Zotero notes.

With Zotero data synchronization enabled, another computer running AbstractIn can restore chapter groups and complete discussions from synced notes. Complete synced chat notes restore the reading type, title and goal without repeating initialization; the PDF must still be available locally. Existing local caches also check for new synced turns and summaries. Opening Chats discovers discussions that arrived after the local index was created. Continuing a discussion on another computer preserves its origin record to avoid directly overwriting the other computer's chat.

If **Could not read this item** appears, click **Restore reading** to reload the document’s reading state and conversations. A damaged discussion index is backed up before reconstruction from local chats and Zotero notes. Original notes, transcripts and sessions are preserved.

Synchronization scope differs by data type:

| Data | Storage and synchronization |
|---|---|
| Reading notes, full reading transcripts, and metadata | Zotero notes under the document or in the workspace collection; synchronized through data sync. |
| NoteOut bodies and source links | Native Zotero notes and links; synchronized through data sync. |
| Per-note discussion history, layouts, and local drafts | Local only; not currently synchronized with note bodies. |
| PDF attachments | Availability depends on Zotero file sync or local attachments. |
| Plugin settings, assistant sign-in and thread IDs, extracted text cache, image attachments | Stored locally; not synchronized through chat notes. |

Image questions may require supplying the images again on another computer. If a note cannot be written, the plugin preserves the local chat and reports the save issue. **Save as note** in the answer menu manually saves a complete answer.

Multi-device synchronization has automated test coverage, but synchronization between two real Zotero installations still requires hands-on verification.

## Reading companions and settings

Choose a **marmoset, white wagtail, puffin, or None**. None hides the entire companion row to free discussion space.

The current marmoset uses a transparent looping animation generated from the supplied video, with its first frame as the still image. It animates continuously on the welcome screen and only during answer generation in the discussion view, remaining still otherwise. The system's reduced-motion setting disables animation.

Settings include colors, fonts, font size, spacing, button labels, answer language, send shortcuts, automatic scrolling, process display, and quick questions. Answers can follow the question's language or use a specified language.

## AI assistants, APIs, and model selection

### Model menu

The composer menu groups **Agent / API → models**. Hover or click to explore models without changing the assistant; choosing a model applies the selection. Configuration entries are grouped under **Setup → assistant or API**, with arrow-key navigation, back controls, and Escape to close. Narrow panels display the submenu at full width.

Codex and Claude Code offer **Refresh … models** to read their local CLI catalogs. ACP agents expose the models actually advertised by the installed CLI. Saving an API profile queries its model-list endpoint and displays **Available models**; use **Refresh models** to update it, or enter a model ID manually if discovery fails. Listed models may still require additional account permissions.

### Add a local CLI

Settings → Assistants → **Add agent (CLI)** supports built-in Codex, Claude Code, Gemini CLI, and Antigravity, plus custom **ACP v1, AbstractIn JSONL, or noninteractive text stdin/stdout** calls. Gemini CLI includes a `gemini --acp` preset. Install and sign in locally first. An arbitrary interactive command without a compatible invocation protocol is not guaranteed to work.

Setup accepts an executable or a directory to search recursively. On Windows, leaving it blank uses `C:\` as the search root, checking PATH, npm, WinGet, scoop, editor extensions, and common installation folders first, then other accessible folders while skipping system directories. Successful discovery saves the actual executable for later calls. Searches can be cancelled; timeouts request a narrower directory, and failures preserve the previous path.

The guide follows **Find CLI → complete sign-in → test connection and reading → choose model and Enable**. Tests use sample material and may consume provider allowance. Cancelled or failed setup does not enable the assistant. Images, streaming, model selection, session continuation, and source access depend on the protocol and validation results. Text CLIs return their answer after exit. Finite compatibility checks do not guarantee success on every task.

### Add an API, including institutional services

**Add API** configures the name, endpoint, authentication, model, and request parameters. Supported formats are **OpenAI-compatible Chat Completions, Anthropic Messages, Gemini GenerateContent, and Custom JSON**, with **GWDG SAIA and DeepSeek** presets. Enter your institution's endpoint, key, and model yourself; no CLI is required. See [assistant adapters](docs/agent-adapters.md) for custom paths, headers, and response mappings.

API keys and extra headers are stored in **Zotero's login manager**, outside chat history. Saving or refreshing models does not switch the active assistant; test and choose **Enable**. APIs and text CLIs can use source passages retrieved by the plugin without reading local files themselves. Image input requires provider/model support and explicit configuration.

The original DeepSeek connection remains available through **Setup → DeepSeek API** or **Guided setup** in Settings for configuration, testing, and key replacement. This built-in connection supports text and plugin-supplied source evidence. API requests may incur charges.

## Installation packages and updates

Each official release provides **`abstractin.xpi`** and **`updates.json`** under these fixed names:

- [Download the latest installation package](https://github.com/shen-zhang-42/abstractin/releases/latest/download/abstractin.xpi)
- [Read release notes](https://github.com/shen-zhang-42/abstractin/releases)

You can send the XPI to others for installation through Zotero's Install Add-on From File option. AbstractIn installations using this repository's plugin ID and update URL can check for updates in the plugin manager or upgrade according to Zotero's automatic-update settings.

These feature descriptions cover **v0.2.154**; see Releases for the latest package. The original Zusia uses a different plugin ID; its users must install AbstractIn manually once before receiving updates from this project.

## Data and privacy

Linked PDFs in user-managed folders such as Dropbox are supported, including relative paths resolved through Zotero’s linked attachment base directory. Original files and attachment links are preserved. If direct file access fails, AbstractIn can use the exact attachment already loaded in Zotero as a source snapshot; this does not establish that it is the latest cloud revision. Online-only files must be available locally or already loaded in the reader. Workspace write errors identify the separate workspace directory.

AbstractIn's local workspace lives in `abstractin/` under the Zotero data directory. It contains chat caches, document copies, extracted text, images, and reading state. The plugin reads copies and caches without modifying the original PDF attachments.

Questions, supplied document context and images, and source text read by the assistant are sent through the selected assistant to its model service. Using a local CLI does not mean document contents always remain on your computer. Zotero notes are also uploaded to your Zotero synchronization service when data sync is enabled.

Diagnostic logs are stored at `<Zotero data directory>/abstractin/debug.log` and may contain questions or context excerpts. Review their contents before sharing.

## Current limitations

- There is no built-in OCR. Scanned PDFs or PDFs without extractable text may require page images or selected text.
- Source location depends on readable pages, contents, and extracted text. Unverified locations do not receive guessed links.
- Local assistants require separate installation, sign-in, and model permissions. A model's presence in the plugin menu does not guarantee that your account can access it.
- Formulas inside NoteOut table cells are not currently supported. TikZJax uses its bundled TeX resources rather than a full desktop LaTeX installation.
- Workspace sources cannot span libraries; per-note discussion history is not yet synchronized across devices.
- This is a desktop Zotero plugin with no iPad version yet. QMD/HTML reading-report export is not currently available.

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
