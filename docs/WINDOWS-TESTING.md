# AbstractIn: Windows installation and verification

## Install this build

1. Download `abstractin.xpi` from this checkout. It is the AbstractIn build; the existing `zusia.xpi` is the preserved upstream artifact.
2. Install and sign in to local Codex. Confirm `codex --version` and a normal Codex session work from your Windows terminal.
3. In Zotero, open **Tools → Plugins → gear → Install Plugin From File…**, select `abstractin.xpi`, and restart Zotero if requested.
4. Open a PDF attached to a regular Zotero book or paper item. Use the **AbstractIn** sidebar section.
5. Click **Start Reading**. Confirm the exact PDF and choose **Book** or **Scientific paper**. Unknown item types require a manual choice. Reading answers follow the plugin's existing **Answer language** setting; **Same as my question** follows the language of your question. There is no separate reading language selector as of version 0.1.3, and changing the shared setting applies to subsequent questions in an existing reading session.
6. Leave the skills folder empty for automatic local discovery with bundled originals as fallback. To use your existing installation explicitly, enter `C:\Users\SZhang\.codex\skills`. A configured folder must contain the original skills; an invalid explicit path is reported rather than silently replaced.

The book skill is named `book-reading` in its front matter. Both `book-reading/SKILL.md` and `scientific-book-reading/SKILL.md` are accepted. Paper reading also requires `scientific-information-extraction/SKILL.md`. The XPI bundles the supplied originals and their supporting files unchanged.

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
6. Check that source links use physical PDF pages. Printed labels are stored separately and must never be converted with a guessed fixed offset. Partially extracted text must not be presented as complete; unverifiable page boundaries must not produce guessed links.

Extraction uses Zotero's native PDF worker. No separate Python/PDF dependency is required. Scanned pages need OCR or an explicitly attached page image. This build does not automatically read book chapters, perform external literature research or export QMD/HTML reports. Unit tests simulate Zotero APIs; Windows reader behavior and note synchronization still require these manual checks.

## If Codex cannot start

In Zotero's configuration editor, set `extensions.abstractin.codexPath` to the full path of the working native `codex.exe`. Restart Zotero after installing or changing CLI paths. If the only command on PATH is an npm `.cmd` wrapper, point at the packaged native executable instead. The plugin launches the executable through Zotero's subprocess API with a read-only sandbox; it does not run a remote service or bypass sandbox restrictions.

Codex supports native Windows sandboxing; keep the sandbox configured normally. See the [official Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox) and [non-interactive CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli). AbstractIn retains `exec --json --sandbox read-only` and session continuation. Skill resources are copied unchanged into the question workspace so the agent can read them without requiring broader access to your original skill directory.

Record the Zotero version, Codex version, executable path and exact sidebar error. Plugin diagnostics are in `<Zotero data directory>/abstractin/debug.log`; logs can contain excerpts of prompts, so inspect them before sharing.

## Verify formula resources after upgrading

Version 0.1.4 registers plugin resources through Zotero's runtime chrome registration and loads the bundled KaTeX renderer at startup. Install the new XPI, fully exit Zotero, and reopen it before checking formulas. In `<Zotero data directory>/abstractin/debug.log`, confirm `init() version 0.2.0` and `KaTeX 0.16.22 loaded`. Reopen a previous answer to check inline math and numbered equations; no new model request is needed. A `getKatex` input-stream error means the renderer file could not be read, before TeX parsing. No separate LaTeX installation is required. If the error remains, provide the new startup log and Zotero version.

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
