# AbstractIn: Windows installation and verification

## Install this build

1. Download `abstractin.xpi` from this checkout. It is the AbstractIn build; the existing `zusia.xpi` is the preserved upstream artifact.
2. Install and sign in to local Codex. Confirm `codex --version` and a normal Codex session work from your Windows terminal.
3. In Zotero, open **Tools → Plugins → gear → Install Plugin From File…**, select `abstractin.xpi`, and restart Zotero if requested.
4. Open a PDF attached to a regular Zotero book or paper item. Click the book icon in the reader's top toolbar (**Toggle AbstractIn panel**), alongside **Toggle Context Pane**, to open its dedicated right-side panel. The library view retains the AbstractIn item section.
5. Click **Start Reading**. Confirm the exact PDF and choose **Book** or **Scientific paper**. Unknown item types require a manual choice. Reading answers follow the plugin's existing **Answer language** setting; **Same as my question** follows the language of your question. There is no separate reading language selector as of version 0.1.3, and changing the shared setting applies to subsequent questions in an existing reading session.
6. Leave the skills folder empty for automatic local discovery with bundled originals as fallback. To use your existing installation explicitly, enter `C:\Users\SZhang\.codex\skills`. A configured folder must contain the original skills; an invalid explicit path is reported rather than silently replaced.

The book skill is named `book-reading` in its front matter. Both `book-reading/SKILL.md` and `scientific-book-reading/SKILL.md` are accepted. Paper reading also requires `scientific-information-extraction/SKILL.md`. The XPI bundles the supplied originals and their supporting files unchanged.

## Verify the dedicated reader panel (0.2.1)

1. Fully exit and restart Zotero after installing this XPI. Open a PDF tab and find **Toggle AbstractIn panel** in the top toolbar. Click it: the chat should occupy its own right-side panel, outside the metadata sections, with Start Reading at the top and the composer at the bottom.
2. Open the native context pane first, then open AbstractIn. Only AbstractIn should remain visible. Click its icon again or its Close button: the previous native pane should return. While AbstractIn is open, **Toggle Context Pane** should switch back to native metadata/notes.
3. Enter an unsent question, close/reopen AbstractIn and verify the draft remains. During a running answer, close/reopen the panel and check that the same request continues.
4. Switch between two PDF tabs. The displayed chat and draft must correspond to each exact attachment. An unloaded PDF must show loading rather than another attachment's conversation. Switch to the library: the dedicated reader panel should hide.
5. Select text and use **Ask Codex about this** or **Explain this**. The dedicated panel should open with the exact passage and physical page location. Test the same entry in a detached PDF window.
6. Drag the panel divider to resize it, and check long formulas, tables, light/dark themes and a small window. Disable/re-enable the plugin: injected controls and panels must be cleaned up. Restart or reopen the PDF if its toolbar was already loaded when the plugin was re-enabled.

The toolbar entry uses Zotero's public `renderToolbar` hook. Panel mounting uses a small adapter for the main/detached reader window layouts; unfamiliar layouts report a diagnostic and retain the item-section fallback. These tests still need real Windows Zotero verification.

## Verify the minimal reading loop

Version 0.2.0 keeps **Start Reading** visible as a single full-width button, without an enclosing tinted card or a repeated empty-chat Start Reading prompt. The document type and language appear below it; clicking it during a reading session reopens the document and reading settings.

Choose **Codex → GPT-6 Sol** beneath the composer to request `gpt-6-sol` explicitly. **Choose another model…** lets you enter and save the exact model ID listed by your local Codex `/model` command. The Start Reading dialog also has an editable model field. Changing models starts a new Codex thread while retaining the reading chat history and Zotero notes. These options use your existing local Codex sign-in; account availability must be checked in Codex. See the [official model selection documentation](https://learn.chatgpt.com/docs/models).

If a chosen Codex model is explicitly rejected as unsupported or unavailable, AbstractIn clears that model selection and retries once in a fresh session using the local Codex defaults (no model or effort overrides). A successful retry shows a confirmation below the answer. This uses your local Codex configuration; if its default model is also unavailable, the retry error is shown. Select an available model in your local Codex configuration before trying again.

1. Select one passage in the PDF and choose **Ask Codex about this**; enter a narrow question and send it. **Explain this** submits the selected passage directly after reading has started.
2. Check that the answer appears in the selected language and mathematical expressions render correctly.
3. Check the save confirmation below the answer. Under the original Zotero item, verify a child note headed **AbstractIn — …** with the `AbstractIn` tag.
4. Open the note and check its concise discussion, original question, quoted passage, item/attachment keys, printed page label and zero-based PDF index when supplied by the reader. **Open source PDF** should open the matching attachment at the captured physical PDF page. A printed label is never converted using an assumed fixed offset.
5. Repeat with a scientific paper, then another PDF under the same item. Their reading chat caches must remain separate and each note must identify the correct attachment.
6. Restart Zotero and verify the notes remain. Click **Start Reading** again to resume questioning; the saved physical reading position should be restored and the workspace should show previous discussions and open questions.
7. If Zotero synchronization is enabled, synchronize and inspect the note on another Zotero client. Record this result separately from local persistence. No synchronization claim has been verified in Codespaces.
8. Use **Stop** during an answer: partial answers should remain available, but incomplete answers should not create automatic reading records.

## Verify the reading workspace (0.2.0)

1. Start a new book session. It should extract the actual contents, save one **Book contents** Zotero child note and create structural chapter folders. It must not generate chapter summaries. Use **Contents & records** to view or update the structure. Unknown chapter locations remain unavailable; verified locations have an **Open …** button.
2. Start a paper session. Choose **Summarize paper** or **Go to questions**. Summary generation requires a click. After generation, **Summary & records** offers **View summary** and **Update summary**; updating should retain the same note key. Check inline and display equations in the saved-summary viewer.
3. Navigate to a genuine reading page. Allow two seconds for position saving, then use a verified contents/source link to jump elsewhere. **Return to reading** should restore the original page. **Resume here** accepts the reference page as the new reading position. Restart and use **Start Reading** to check restoration and the discussion recap. This records location, not mastery.
4. Ask two follow-up questions on the same topic and verified chapter/section. When Codex supplies the same scope/topic identifier, the concise discussion should update one note instead of creating duplicates. Edit a conclusion or open question in Zotero and ask again; current notes should be included in the derived reading context.
5. Check the source-status line and debug log for PDF extraction. Test another attachment, a missing linked file and an image-only PDF. Missing/unextractable sources should report an actionable error before a general request is sent. An explicitly selected passage or attached image may still be discussed, with a source-coverage warning.
6. Check that source links use physical PDF pages. Printed labels are stored separately and must never be converted with a guessed fixed offset. Partially extracted text must not be presented as complete; unverifiable page boundaries must not produce guessed links. **page links unverified** means text extraction succeeded but physical page boundaries could not be established. A saved contents note with null pageIndex values is usable structure; its Open buttons verify destinations on demand. A destination that cannot be verified reports the gap instead of guessing.

Extraction uses Zotero's native PDF worker. No separate Python/PDF dependency is required. Scanned pages need OCR or an explicitly attached page image. This build does not automatically read book chapters, perform external literature research or export QMD/HTML reports. Unit tests simulate Zotero APIs; Windows reader behavior and note synchronization still require these manual checks.

## Verify resilient saving and contents initialization (0.2.6)

1. Use a PDF whose source status says **page links unverified**. Ask a question: the concise discussion must still save as a Zotero child note. A verified excerpt may be retained without a page link; an excerpt absent from the actual text is omitted with an informational notice. The reader's own selected-passage page location remains usable independently.
2. Initialize a book whose model output reformats dot leaders or omits an identifier. The plugin should recover an exact contents excerpt, assign a safe identifier and save the verified entries. An unverified entry must be omitted and the saved directory clearly marked incomplete. Unknown chapter locations must remain null; no guessed links are generated.
3. If initialization cannot save any verified entries, click **Start Reading** again and restart Zotero. It should offer **Initialize contents** and **Go to questions**, without automatically repeating the scan. An explicit initialization click retries. A successfully saved contents note is reused.
4. Inspect the saved contents note and its viewer: they must show the validated directory entries. Initialization should start from the bounded `contents-source.md` excerpt and inspect only additional contents pages if needed, rather than locating every chapter in the book.
5. If a Zotero note saves but its derived cache cannot refresh, the sidebar should say the note saved and report the cache issue separately. A real `saveTx()` failure must still show a save error.

Previous failed answers remain in chat history. **More → Save as note** saves an existing full answer without another model request. These fixes avoid unnecessary repeated work, but response time still depends on local PDF extraction and Codex.

## Verify current-page discussion and chapter navigation (0.2.6)

1. Open a book with a blank cover or unverified global page boundaries. Go to a text page and ask “Explain this equation on the current page.” Inspect `<Zotero data directory>/abstractin/<library>-<item>/reading-<attachment>/current-page.md`: it must show that physical page's text and zero-based index. Change the displayed page while the request prepares; the answer must use the send-time page. Repeat on another page. Current-page questions should use the supplied text before searching the full book; model latency still varies.
2. Ask for an exact quotation from that page. A matching record source must generate a physical PDF page link even if global boundaries remain unverified. A quotation assigned to the wrong physical page must not generate a link. Discussion saving remains available.
3. For PDFs whose only lost boundaries were blank first/last pages, check the log for **Recovered PDF page mapping**. Recovery requires native page count and edge text agreement; other discrepancies remain unverified. Native page extraction is cached per loaded PDF.
4. Open **Reading workspace → View contents → Open <chapter>**. The plugin verifies a unique bookmark destination, a printed label plus matching heading, or an exact heading in verified mapped text. Missing/ambiguous destinations must report an error without navigating. **Return to reading** should restore your original page. Initialization still does not scan all chapters.
5. Open the same attachment in another reader window at a different page. Each panel must read its own reader's page, with no other-window context leakage.

The automated tests exercise these behaviors with mocked Zotero readers. Actual Windows/Zotero performance, private PDF reader access and panel layout still require the above manual checks.

## If Codex cannot start

In Zotero's configuration editor, set `extensions.abstractin.codexPath` to the full path of the working native `codex.exe`. Restart Zotero after installing or changing CLI paths. If the only command on PATH is an npm `.cmd` wrapper, point at the packaged native executable instead. The plugin launches the executable through Zotero's subprocess API with a read-only sandbox; it does not run a remote service or bypass sandbox restrictions.

Codex supports native Windows sandboxing; keep the sandbox configured normally. See the [official Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox) and [non-interactive CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli). AbstractIn retains `exec --json --sandbox read-only` and session continuation. Skill resources are copied unchanged into the question workspace so the agent can read them without requiring broader access to your original skill directory.

Record the Zotero version, Codex version, executable path and exact sidebar error. Plugin diagnostics are in `<Zotero data directory>/abstractin/debug.log`; logs can contain excerpts of prompts, so inspect them before sharing.

## Verify formula resources after upgrading

Version 0.1.4 registers plugin resources through Zotero's runtime chrome registration and loads the bundled KaTeX renderer at startup. Install the new XPI, fully exit Zotero, and reopen it before checking formulas. In `<Zotero data directory>/abstractin/debug.log`, confirm `init() version 0.2.8` and `KaTeX 0.16.22 loaded`. Reopen a previous answer to check inline math and numbered equations; no new model request is needed. A `getKatex` input-stream error means the renderer file could not be read, before TeX parsing. No separate LaTeX installation is required. If the error remains, provide the new startup log and Zotero version.

## Source directory and development loading

The source directory is **this project's `src/`**, resolved relative to this checkout. In the current Codespace it is `/workspaces/abstractin/src/`. Run:

```sh
npm run source:path
npm run build
```

On Windows, clone/download this project locally and run `npm run source:path` there to obtain the actual Windows source path. For Zotero's development extension loading, the extension pointer file is named `abstractin@shen-zhang-42.github.io` and contains that local checkout's absolute `src` path. Do not point a Windows Zotero profile at `/workspaces/abstractin/src`, an upstream Zusia checkout or the Codespace URL. Use a separate test profile when loading source directly.

Normal installation from the XPI requires no extension pointer, Node, source checkout or running Codespace. Bundled skills are derived into a versioned local cache; the original editable sources remain under this repository's `skills/` directory.

## Persistence boundary

Zotero child notes are the authoritative editable reading records. The local `abstractin/<libraryID>-<itemKey>/reading-<attachmentKey>/` directory contains chat/session caches, reading preferences, `source.pdf`, `source-text.md`, `source-manifest.json`, a derived `workspace.md`, and structural chapter folders. The source PDF is copied; the original attachment is unchanged. Contents, summaries, genuine reading positions and concise discussions are stored in Zotero child notes. These local files do not synchronize automatically. Later questions reuse a derived snapshot of the current Zotero reading notes; users may edit those notes in Zotero.

If Codex omits or returns an invalid record block, or Zotero cannot save the note, the answer remains available and the sidebar reports the save failure. **More → Save as note** is a manual fallback that saves the full answer rather than a concise reading record.

## Verify entry visibility (0.2.6)

Install with a PDF already open, and test again after restarting Zotero. Look for **AbstractIn** in the PDF top toolbar near the context-pane controls. The right-side item navigation must retain its AbstractIn entry; opening that section in a supported reader shows **Open AbstractIn panel**. Both buttons should open the independent chat panel. Test closing/reopening a PDF and enabling/disabling the plugin while a PDF loads; entries must not duplicate or reappear after disabling. Zotero 10.0.3 entry visibility requires a real Windows check; the automated tests simulate these lifecycle events.

## Verify panel controls and neutral theme (0.2.6)

In the dedicated panel, confirm the header has clarifications, search, history, new chat, settings and close controls. At the bottom, confirm attachment, mode, model, reasoning and send controls, plus the input area; resize the panel and scroll a long answer to verify the composer remains visible. Test opening settings, choosing a model and sending a question. The panel should stay plain gray without decorative patterns, a glow or a background image, even with old colorful appearance preferences. Start Reading should be compact and aligned to the left. Verify the toolbar AbstractIn button is centered with and without its book icon. These changes require a real Zotero visual check; the automated tests cover HTML namespaces, resource loading and control presence.

## Verify knowledge discussion, chat switching and recap math (0.2.6)

Choose **Knowledge discussion** from the icon dropdown beside AbstractIn. Ordinary follow-ups should show “using saved discussion context” and neither extract the full PDF nor read a new page. Ask about “theorem 1.1”: it should automatically show “verifying the requested passage”, inspect the actual statement and preserve the Knowledge discussion preference afterward. A missing author-specific detail can trigger one automatic verification pass. If the passage cannot be located, it must report that instead of guessing. Asking explicitly not to read/search the PDF must prevent automatic lookup and new current-page extraction. Current-page questions without that prohibition may read only the selected page. Ordinary knowledge requests disable Codex shell/unified execution, apps and web search; automatic verification enables local source access. CLI response latency still varies and real installed-Codex enforcement needs verification. Select a reply containing inline/display formulas and press Ctrl+C; paste into an editor and check there is one TeX representation per formula, without duplicated MathML annotations or “Copy TeX” labels. Verify multiline math, bare array environments and a formula using `\ThetaSpace`; this undefined name stays a named symbol until a real definition is supplied.

Switch to **Source verification** to check exact source details; contents initialization and explicit paper summaries must still inspect their sources, regardless of the discussion preference. Save a note containing inline and display math and open the reading workspace: recap formulas and open questions should render with KaTeX.

Use **New chat**, then **Previous chats**: the selected attachment, contents, summary, saved notes and mode remain available. Agent sessions reset and the chosen transcript is replayed on the next request. Sending or switching chats during a pending answer/transition must not mix histories. Opening the same attachment in another window should display the same changed chat after a transition.

## Verify full conversation sync (0.2.11)

On computer A, ask several questions in one PDF and use New chat to start a second conversation. Confirm the parent item has AbstractIn:Chat notes holding full message text/LaTeX; long conversations use multiple parts. After Zotero data sync, open the same item on computer B with AbstractIn installed and PDF file downloads set to As needed. Download/open only this PDF and select Start Reading. In a fresh workspace the latest complete chat should restore and Previous chats should include earlier conversations. Existing local chats remain selected; remote conversations appear in Previous chats. Plugin settings and Codex thread identifiers must remain local.

Continue on computer B, sync both computers, and confirm the original transcript remains available. Try Retry and confirm the replaced conversation remains archived. Interrupt synchronization of a multi-part transcript: the plugin must not restore a truncated chat or overwrite local text. Image files are not stored in transcript notes; image-only questions need the image supplied again. In a read-only library, a failed transcript-note write should display a warning while preserving chat.json and the answer. This workflow needs an actual two-computer Zotero verification; unit tests simulate note transfer.

## Verify the single marmoset companion (0.2.13)

Install and restart. The PDF toolbar entry and native item-pane entry should use the red marmoset avatar, while Start Reading keeps its book icon. Empty chat and onboarding show the matching red marmoset with ear tufts, a ringed tail and a book. Appearance has no Buddy selector and onboarding offers only the backdrop pattern at its corresponding step. Existing cat/owl/robot/none preferences must fall back to the same marmoset. Verify red artwork remains visible in both light and dark themes.


## Verify icon and menu rendering (0.2.14)

After installing the new XPI, confirm version 0.2.14 in Zotero's add-on manager and restart. The PDF toolbar and chat header should show the red marmoset avatar; Start Reading should show a separate book. The empty chat should show the red book-reading marmoset. Open the reading mode menu at narrow and wide panel widths: the checkmark and mode symbol must sit beside the label, with the description below it and each mode in its own row. Updates register a fresh resource address, and marmoset artwork is inserted synchronously without an external resource request.

For the native visual regression checks in an isolated profile, run `ZOTERO_BIN=/path/to/zotero bash test/integration/appearance.sh`. Results and screenshots are written to `test/integration/out/appearance/`.


## Verify the simplified app icon and companion motion (0.2.15)

The toolbar, chat header and native item entry use the same minimal gray marmoset outline, without a colored background or decorative detail. The red book-reading companion gently rises six pixels and returns over a four-second loop, in both the empty chat and onboarding. The float is applied to the SVG so it runs independently of the onboarding entrance transition. The system's reduced-motion preference disables floating and twinkling. The native appearance checks sample the animation at the start, midpoint and end, and verify reduced-motion behavior.
