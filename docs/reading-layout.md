# Reading and note layout

Click the single top-level AbstractIn icon to choose a layout before opening any panels. Every preset includes a graphical preview: blue represents Zotero's native reader and gray represents plugin panels. **Read literature** opens the native reader with reading discussion. **Four panels** adds a full-height note editor with reading discussion above note discussion on the right. **Four columns** places all four surfaces side by side. **Separate note window** keeps the note and its discussion in one floating window. The native PDF reader remains in place. Both discussions keep their own history and message draft.

Choose **None** under **Settings → Appearance → Reading companion** to hide the entire companion row and free vertical space in discussions, including floating panels. Choose a companion again to restore it.

The global toolbar contains icon buttons for sources, layout, reset, Hide/Show notes, and plugin settings at the upper right. Hover an icon to see its description. Each panel has one title row with its commands and a Move icon. The note's formatting icon opens the existing editor toolbar, including fonts and keyboard shortcut help, without reserving another header row. These controls work the same way in floating panels. Both discussions use the shared message composer without a duplicate source chip.

The mode icon describes the single-document or workspace scope on hover. A vertical separator precedes the current source title in the same toolbar row. Open that title's dropdown to switch sources; **Add documents** is always its first action and opens the same source manager as the source icon. The toolbar follows the native reader toolbar's height, background and bottom rule.

Each editor activates its own browsing context on a pointer press. Reloaded embedded editors rebuild from the current draft and selection when a panel is reparented. Clicking discussion text gives its message area keyboard focus so copying the selected text works after using another editor.

Headers adapt to each panel's width: titles truncate, icons retain consistent spacing, and secondary commands move into the actions menu. Embedded workspace width is limited by its actual native container, reserving Zotero's reader minimum width and right-side controls. Shrinking the main window does not allow the plugin to extend beyond that container. Hot updates refresh the layout styles rather than retaining a previous version's stylesheets.

Drag a panel header to an edge of another panel to split it there. A shaded target previews the placement. Drag outside the window to open a floating window, or use the panel's **Move → New window** menu. The Move menu also lists existing panel windows and **Dock in Zotero**. Note editor and note discussion are linked: moving or floating either one moves both, opening them shows both, and hiding notes hides both. They share a floating window and retain an adjustable divider. **Show notes** restores the last split ratios, sidebar width, floating positions and window sizes. Closing their floating window hides both while keeping their contents and history. Closing a floating reading discussion returns that discussion to Zotero. Splitters support dragging, arrow keys and Home to reset the ratio.

The four-column preset orders surfaces as **Reader | Reading discussion | Note | Note discussion**. Reset layout returns all three plugin panels to their default positions. Layout structure and floating window sizes are remembered. A native Zotero PDF window never automatically relocates these plugin panels. This version has one instance of each panel per reading scope, rather than duplicate editor or discussion windows.

## Multiple notes

The note toolbar provides **Save | New note | Open note**. New note saves the current edits, creates an empty note in the same document or workspace, and selects its editable title. Open note shows a searchable list restricted to the current document or workspace. Each note has its own Markdown and discussion directory. Switching restores that note's history and unsent question without replacing the reading discussion. Stop or finish an active note answer before switching notes.

Single-document notes remain separate children of that document. Workspace notes are separate standalone items in the same workspace collection, with one shared workspace identity and source list. Updating workspace sources updates every note in that workspace. The note toolbar has no separate source button; use the shared **Sources +** control.

## Source scope

**Sources +** searches books and papers in the same library. With one source, the note remains a child of that document and no workspace or collection is created. On adding a second source, choose a name and optionally an existing parent collection. AbstractIn creates a dedicated child collection with the original document items and the same canonical note, now a standalone item. Other notes and conversations under the original document stay in place.

Reading and note discussion use the same source list. Source chips switch the native reading target. Source changes wait for active answers to finish; removing the current source requires selecting another one first. Removing a source unlinks it from the workspace collection, preserving the Zotero item, PDF, past messages and citations. An established workspace retains its structure even when only one source remains.

The current reading conversation is copied into `workspaces/<libraryID>-<noteKey>/discussions/reading/`, preserving the original transcript. Further reading chats use the workspace discussion index. Note discussion stays at its existing stable note-key path. The note's hidden metadata contains the workspace identity and sources; a local `workspace.json` records the association. Workspace reading transcripts sync as standalone Zotero notes in the workspace collection and can reconstruct a missing local index. New reading messages record their active document and source membership at send time.

Reading currently retrieves evidence from the selected document using the existing reading tools. Adding sources does not preload their full text or automatically transfer discussion history to the other agent. Cross-discussion turn search and automatic routing of evidence queries between documents are later steps.

The older standalone NoteOut home remains available when no PDF is selected. Its source filter is separate from this new reading workspace UI.

## Maintenance

`reading-note.css` is generated from the standalone note stylesheet by `node scripts/reading-note-style.mjs`, which also runs during a normal build. Its root and hidden selectors are scoped to plugin surfaces so they cannot restyle Zotero's native window.
