# NoteOut editor

NoteOut uses the MIT-licensed t-shoot Markdown Live Preview Editor, built on CodeMirror 6. Markdown remains the saved source. Editing, preview boundaries, tables, headings and quotations are handled by the upstream editor. AbstractIn supplies Zotero storage, AI edit proposals, fixed Markdown shortcuts, font settings and mathematics.

The `?` button in the note header lists the fixed shortcuts. Ctrl/Cmd+S saves the note and commits an active table cell first. Bold, italic and inline-code commands place edge whitespace outside the Markdown markers, including when editing a table cell.

When editing a quotation, lines beginning with `>` continue the quotation. Unmarked prose remains an ordinary paragraph: if typing, pasting or deleting a separator would make it a lazy quote continuation, the editor keeps a blank line in the Markdown source. Backspace moves the caret onto that separator and then back to the preceding line, without absorbing the ordinary paragraph. Existing notes and AI edit proposals are not rewritten on load.

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
