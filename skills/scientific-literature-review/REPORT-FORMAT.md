# Literature-review report format

Read this file when creating or substantially reformatting a literature-review report.

## Outputs

Create one canonical source file by default:

| File | Purpose |
|---|---|
| `.qmd` | Canonical editable source and persistent living-review state |

Do not create a duplicate `.md` file by default.

After the report is complete, ask whether the user also wants an HTML reading version.

If requested, render the QMD locally with Quarto when available; otherwise generate a content-equivalent standalone HTML.

The QMD should normally use `format: html`, `embed-resources: true`, `theme: none`, `page-layout: article`, disabled execution, and `report-style.css`.

---

# Visual system

Use the provided `report-style.css` and preserve the restrained single-column research-editorial layout.

Use:

- readable body text;
- strong heading hierarchy;
- restrained red accent;
- high contrast;
- generous whitespace;
- fixed-layout tables whose cells wrap inside the reading region.

Do not use decorative dashboards, gradients, emoji, or repeated cards.

---

# Header and Summary

Start with:

1. a compact kicker;
2. a strong review title;
3. a one- or two-sentence deck describing the review question.

Put scope, timing, methods, coverage, and progress inside one `Summary / 摘要` section.

Use a key-value table for:

- review question;
- review mode and question-conditioned conceptual resolution;
- scope and important exclusions;
- created date and last-search date;
- databases and sources;
- citation-count source and retrieval date;
- search routes used and structural-challenge status;
- conceptual saturation status and residual structural uncertainty;
- paper exhaustibility status when assessed;
- concept, paper, and synthesis-unit counts;
- important search limitations.

Follow with a synthesis matrix:

| ID | Synthesis unit | Type | Evidence / basis | Conflict / alternatives | Confidence note |
|---|---|---|---|---|---|

For empirical units, `Evidence / basis` should show E0–E4.

For non-empirical units, use `N/A` for E-level when needed and summarize the source/formal basis instead.

When the report is an update, add a compact delta table for:

- new papers;
- new Core papers;
- new synthesis units;
- evidence-level changes;
- new conflicts;
- new branches / boundary conditions;
- whether the main synthesis materially changed.

---

# Conceptual structure

Before the synthesis records, present a compact map of review-relevant concepts when useful.

Use the five concept classes:

- Question
- Entity / phenomenon
- Theory / explanation
- Method
- Relation / boundary

A concept table may use:

| Concept | Type | Parent / related concept | Role in review | First / key source | Status |
|---|---|---|---|---|---|

Do not treat synonyms, search aliases, author groups, or database keywords as conceptual nodes.

When useful, include a conceptual-discovery table:

| Search round / route | New questions | New entities / phenomena | New theories / explanations | New methods | New relations / boundaries |
|---|---:|---:|---:|---:|---:|

Report conceptual saturation as `Low`, `Moderate`, or `High`, with a short evidence note and residual uncertainty.

---

# Main body: Current synthesis

Organize by theme when useful.

Every major synthesis unit is a self-contained record.

Recommended order:

1. one-third-width thick red rule;
2. eyebrow such as `S1 · EMPIRICAL · E2 · CONFLICT: MILD` or `S4 · MODEL CHARACTERIZATION`;
3. concise synthesis-unit heading;
4. basic assessment table;
5. synthesis table;
6. relevant-literature table;
7. conflicting / alternative literature table when applicable;
8. generous whitespace before the next unit.

## Basic assessment table

Use stable fields:

| Field | Value |
|---|---|
| Type | Empirical / Theoretical-formal / Method-model / Comparative / Boundary / Other |
| Review relevance | Why this unit matters |
| Evidence level | E0–E4 for empirical claims; otherwise N/A |
| Conflict / alternatives | None / Mild / Major for empirical claims, or direct description for non-empirical units |
| Original-team replication | When applicable |
| Independent replication | When applicable |
| Source depth | Important source-depth status |
| Boundary conditions | Population, paradigm, method, assumptions, or condition |

## Synthesis table

Use separate rows for:

- `Summary`;
- `Basis / why supported`;
- `Boundary conditions`;
- `Unresolved questions`.

Do not collapse them into one paragraph.

## Literature table

Include stable columns such as:

| Paper | Year / venue | Role | Review-relevant contribution | Source depth | Importance | Identifier |
|---|---|---|---|---|---|---|

Add citation counts with source/date when used.

For empirical synthesis units, make independent replications and contradictions visible without requiring the reader to inspect every paper entry.

---

# Cross-cutting unresolved issues

Use only when an issue affects multiple synthesis units.

Recommended columns:

| Issue | Affected units | Consequence | Needed evidence |
|---|---|---|---|

---

# Search coverage and method

Separate **conceptual coverage** from **paper coverage**.

## Conceptual coverage

Report:

- concept classes searched;
- search routes used;
- concept novelty by round when useful;
- cross-route convergence;
- challenge-search results;
- conceptual saturation (`Low / Moderate / High`);
- residual structural uncertainty.

## Retrieval profile

Report separately:

- concepts and search aliases;
- databases / indexes;
- citation expansion;
- researchers / groups;
- successful routes;
- limited routes;
- source-depth limitations;
- likely remaining search gaps.

Do not mix search terminology with the conceptual map.

## Paper exhaustibility

When paper-level near-exhaustiveness was requested or assessed, report:

- status: `Feasible / Uncertain / Not feasible`;
- scope boundedness;
- terminology stability;
- estimated corpus size;
- indexability;
- marginal new-paper yield;
- cross-route overlap;
- citation-boundary stability;
- corpus-growth / plateau evidence;
- residual paper-search uncertainty.

If near-exhaustive search was not requested, say so rather than implying paper completeness.

For living reviews, explicitly state whether the current run was:

- `review`;
- `refresh`;
- `add-paper`;
- `rebuild`.

For `refresh`, record the date boundary used and any older papers added because new seeds exposed missed branches.

---

# Full literature list

Use a full-width fixed-layout table.

Retain when useful:

- authors;
- year;
- original title;
- journal / venue;
- DOI or persistent identifier;
- citation count, source, and retrieval date;
- role;
- importance dimensions;
- synthesis units supported / defined / qualified / challenged;
- concise review-relevant contribution;
- discovery provenance.

Do not translate original titles, names, venue names, DOI, PMID, OpenAlex IDs, or URLs.

---

# Language

Follow the user's requested language.

When the conversation is in Chinese and no different preference is stated, analytical content may be Chinese with English technical terms preserved when more precise.

Do not force bilingual duplication unless requested.

---

# Accessibility

- Keep text contrast high.
- Use semantic headings and table header cells.
- Keep tables within the reading region and wrap long identifiers.
- Preserve table headers when printing.
- Avoid splitting rows across printed pages when possible.
