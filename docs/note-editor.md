# NoteOut editor

NoteOut uses the MIT-licensed t-shoot Markdown Live Preview Editor, built on CodeMirror 6. Markdown remains the saved source. Editing, preview boundaries, tables, headings and quotations are handled by the upstream editor. AbstractIn supplies Zotero storage, AI edit proposals, fixed Markdown shortcuts, font settings and mathematics.

The font selector appears at the left of the editor formatting toolbar. Its `?` button lists the fixed shortcuts. Ctrl/Cmd+S saves the note and commits an active table cell first. Bold, italic and inline-code commands place edge whitespace outside the Markdown markers, including when editing a table cell.

The **Source** button beside **Save** manages the current note's source documents. Source names appear on separate compact rows; the remove button unlinks that source. The sidebar's **Source** button independently manages the editor's document filter. It shows the union of notes linked to those documents, listing a shared note only once. A shared note is available when any one of its linked documents is in the editor filter. Changing the editor filter does not relink an open note, and changing a note's source list does not change the editor filter. With no editor sources selected, the sidebar shows the library's notes. Source pickers support title search and adding documents selected in Zotero.

Quotations use the editor's default Markdown behavior. An unmarked line immediately after a quotation can continue that quotation; insert a blank line to start an ordinary paragraph. The editor does not add or protect quotation separators automatically.

Use `$...$` for inline mathematics and `$$...$$` for display mathematics. KaTeX supports rectangular commutative diagrams:

```latex
$$
\begin{CD}
A @>f>> B \\
@VgVV @VVhV \\
C @>k>> D
\end{CD}
$$
```

For diagonal or curved arrows, use a `tikzcd` code block:

````markdown
```tikzcd
\begin{tikzcd}
A \arrow[r, "f"] \arrow[d, "g"'] \arrow[dr, dashed] & B \\
C & D
\end{tikzcd}
```
````

The bundled TikZJax engine compiles locally in a Worker inside a disposable content frame. It loads only when a diagram is displayed, requires no CLI, network service or separate server in Zotero, and caches up to 32 compiled diagrams per note window. Click **Edit source** to edit the diagram, then move outside its code block to render again. Compilation errors leave the Markdown available for editing. The 60-second timeout limits a stuck compiler.

Mathematics inside table cells is not yet rendered by the KaTeX adapter. Native Mermaid and external draw.io file loading from the VS Code extension are not connected to Zotero. Ordinary reading and discussion inputs continue to use their separate lightweight editor.

Source revisions and licenses are recorded in `vendor/tshoot/SOURCE.json`, `src/content/editor/TSHOOT-LICENSE` and `src/content/editor/tikzjax/`.
