---
name: book-reading
description: Support question-driven study of mathematical and theoretical books. Initialize a workspace from the table of contents, restore reading context on Start Reading, answer from the current or specified passage using the book and existing knowledge, and save concise records at book, chapter, or section scope. Use scientific-paper-reading for research articles.
---

# Book Reading

## Purpose and boundaries

Do the minimum work needed for the user's current reading question. Initialize structure once; thereafter answer and record only in response to questions. Start Reading may restore position, ask the interaction language, and briefly recap existing records. Reader position updates are bookkeeping, not a reason to read or summarize content.

Use the book, existing reading records, and the model's existing knowledge. This first version does not invoke literature-review/search skills, browse external sources, retrieve external literature, or generate Bourbaki code. Do not verify historical priority from memory. When the available knowledge is insufficient, state what remains uncertain.

Reason internally in English. Interact and write reading notes in the user's selected English or Chinese, retaining original mathematical notation and useful source terminology.

## Reader context and navigation

Use whatever the reader or Zotero bridge actually supplies: book and attachment identity, edition, source file, table of contents, current PDF page, displayed page label, selected text, and saved reading position. Optional fields may be absent. Bind records to the book and its exact edition/attachment; do not merge different editions silently.

Navigation and live page tracking require reader/plugin capabilities. A skill file alone cannot operate a reader. When available, use those capabilities to obtain the current page, navigate, and save the reading position. If unavailable, ask for the missing page or passage when needed, provide the target location, and do not claim to have moved the reader.

Keep the reader's resume position separate from an assistant lookup destination. Before a lookup that moves the visible reader, retain the original position so the user can return. Do not replace the resume position with an assistant's temporary lookup page. Prefer source inspection without moving the visible reader when possible.

## Initialize from the table of contents

Initialize when the user starts a continuing book-reading project. Reuse an existing workspace. An isolated question does not require a new workspace unless the user requests one.

1. Inspect identity information and the actual contents pages or PDF outline. Establish the book's parts, chapters, sections, numbering, and source locations. Verify ambiguous outline entries against the contents or the relevant heading.
2. Create one book folder, an `index.md`, and chapter folders matching the verified contents. Preserve part grouping when present. Record section hierarchy in the index; create section folders and substantive notes only when needed.
3. Record source pointers and page mapping. Mark content as not yet recorded or not checked, rather than inferring the user's reading history.
4. Stop. Do not generate chapter summaries, inventories of every theorem, prerequisite plans, or empty question files.

If the contents are incomplete, initialize the verified portion and mark the gap. Keep the source book at its existing location.

### Page coordinates

Distinguish:
- PDF physical page number, recorded as one-based;
- printed page label, which may be Roman, Arabic, absent, or repeated;
- any zero-based page index used by the reader API.

Verify the API convention before translating a navigation target. Build page correspondences from observed printed labels and headings. A constant offset may hold only within a region; do not apply one offset to front matter, the main text, appendices, or a scan without verification. Record separate mapping anchors or ranges when necessary.

A bare user page number normally means the printed page. Resolve it using the mapping and heading context. If it has multiple plausible matches, ask which one. Recheck affected mappings when the source attachment or edition changes.

## Start Reading

On the user's Start Reading action:

1. Reuse or initialize the workspace and restore the saved resume position through the available reader capability. If no position exists, retain the current page.
2. Ask whether to discuss this session in Chinese or English, offering the previous choice as the default. Save the selected preference.
3. Give a brief recap in that language using only existing records: last reading location, the main topics actually discussed, and any unresolved question. With no prior records, say so; do not create a fresh content summary.
4. Wait for the user's question.

Position alone does not establish understanding or continuous reading coverage. Do not say the user has mastered or finished preceding pages because the reader is open at a later page.

## Resolve the question's target before expanding

An explicit location takes priority. If the user names a chapter, section, printed/PDF page, theorem, equation, or other identifiable passage, go directly to it using the index and source. Do not ask the user to repeat a location that is already clear.

For a contextual question such as "What does this mean?" or "Why does this step work?", inspect the current selection and current page first. Check immediately adjacent text only when needed to finish a sentence, formula, or proof continued across a page boundary.

If that inspection does not identify the referent reliably, ask which passage, theorem, or step the user means. Ask before searching unrelated chapters or guessing the intended problem. If no current-page context is available, ask for the page or quoted passage.

For explicit book-, chapter-, or section-wide questions, use that scope directly. Do not force them through a current-page lookup. Distinguish an unclear target, which needs clarification, from insufficient evidence about a clear target, which permits targeted expansion.

## Search progressively by scope

Start with existing records as a locating aid, then the following minimum source material:

| Question scope | Initial source inspection | Expand only when the answer needs it |
|---|---|---|
| Whole book | Contents, chapter structure, and each chapter's opening introductory paragraph | Relevant later introductory paragraphs, section openings, or specific statements that fill a named gap |
| Chapter | Chapter opening, section structure, and section opening paragraphs | The relevant section's statements, examples, or argument |
| Section | Section heading, opening paragraph, internal headings, and statements relevant to the question | Later paragraphs or proofs within the section; prerequisites elsewhere only as needed |
| Passage, formula, or proof step | Selected/current or explicitly specified passage and immediate context | The exact definitions, hypotheses, lemmas, or preceding steps it depends on |
| Cross-chapter concept or dependency | Index, existing records, and the concept's definition or cited result | Follow actual references to the locations needed for the comparison or dependency chain |

Do not automatically read every paragraph of a section or chapter. Before each expansion, identify what the initial inspection cannot answer, and retrieve the passage most likely to fill that gap. Stop when the question is adequately answered.

Breadth and depth are separate. A book overview is broad and coarse; a single proof step may need deep local reasoning. A request for a detailed chapter argument can justify deeper reading than a request for its main topic. Preserve the source coverage of the answer: a structure-based overview must not be presented as a full-text synthesis.

Use headings, statement numbers, distinctive phrases, and cross-references for targeted lookup. Inspect page images when extraction makes formulas, diagrams, or symbols ambiguous. If the relevant passage remains inaccessible or unreadable, state the limit and ask for that passage rather than filling it in from memory.

## Answer using the book and existing knowledge

Lead with a direct answer at the requested depth. Combine the author's treatment with existing mathematical knowledge when it helps explain motivation, intuition, examples, proof strategy, or connections.

For statements about this book, preserve its assumptions, quantifiers, notation, theorem numbering, and exact claim. Check precise source-dependent details in the original passage when existing notes do not already contain adequate verified support.

Make provenance clear in natural language:
- "The book's proof uses..." for the author's argument;
- "One way to understand this is..." for supplementary intuition;
- "An alternative argument is..." for an independent derivation.

For proof questions, explain the key move and necessary dependencies. Check that any proposed alternative proves the same conclusion under the same hypotheses. Label tentative ideas and unresolved steps; do not represent a sketch as a complete verified proof.

When useful, offer one short optional extension, such as asking whether the user wants another proof method. Expand only if the user accepts. Do not add a follow-up offer to every answer or record an undiscussed alternative as established knowledge.

## Record at the appropriate scope

Use the existing book workspace when one exists. Save a concise answer record after a substantive question, then stop. Keep records easy to locate:

```text
<book-folder>/
  index.md
  book-notes.md                         # created on a book-wide question
  chapters/
    01-<chapter-title>/
      notes.md                          # created on a chapter-wide question
      sections/
        01-<section-title>/
          notes.md                      # created on a section/local question
```

At initialization only `index.md` and chapter folders are required. Adapt the hierarchy to actual parts and numbering; keep stable directory identifiers even if a heading's wording is corrected.

`index.md` owns book identity, source pointer, contents, page mappings, resume position, language preference, and links to saved notes. Keep reading-position metadata small. Add links to material cross-chapter dependencies or unresolved questions only when they arise from discussion.

A note entry needs the question or topic, a concise useful answer, source locations, and any material dependency or unresolved point. Include enough proof reasoning to reconstruct the answer; do not save only a verdict or duplicate the entire chat. Add a scope/coverage qualification when the answer is based on structural sampling.

Place whole-book and cross-chapter questions in `book-notes.md`; place chapter and section/local questions at their respective levels. For a question spanning several sections, choose their narrowest shared scope and link to the relevant locations. Do not duplicate the answer in each chapter.

Merge follow-up questions, clarifications, and corrections into the same topic entry. Preserve a short correction note when an earlier conclusion changes. A summary is created or revised only when requested; previous question records need not be reorganized into a chapter summary after each turn.

If reference location is still unclear, clarify first rather than saving a guessed answer. Do not infer mastery from an answered question. Do not populate concept lists, theorem dependencies, open problems, or notes for content that has not arisen in the conversation.

## Zotero storage boundary

The same organization may be exposed through Zotero notes and stored attachments when a connected bridge supports it. Use that bridge's supported operations and stable item identities; do not write arbitrary files directly into Zotero's internal storage directories or assume file writes automatically become Zotero attachments.

Keep one authoritative editable record for each note. Treat any rendered copy as derived, and avoid independently editing both. If integration is unavailable, use the local workspace and report its location; do not claim that saving also synchronized it.
