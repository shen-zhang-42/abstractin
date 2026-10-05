# Scientific-paper-reading report format

Read this file when creating or substantially reformatting a paper-reading report.

## Outputs

Create one canonical source file by default:

| File | Purpose |
|---|---|
| `.qmd` | Canonical editable source and persistent human-readable summary |

Do not create a duplicate `.md` file by default.

After the report is complete, ask whether the user also wants an HTML reading version.

| Optional file | Purpose |
|---|---|
| `.html` | Browser-ready rendered reading version |

If HTML is requested and Quarto is available, render the QMD locally.

If HTML is requested but Quarto is unavailable, generate a standalone HTML file with equivalent content and style.

The QMD should normally use:

```yaml
pagetitle: "Paper Summary"
format:
  html:
    embed-resources: true
    theme: none
    page-layout: article
    css: report-style.css
execute:
  enabled: false
```

Put the report content directly in the QMD. Never embed a previously generated HTML page through an iframe.

Write the title visibly in the report body so the kicker and title stay in the
intended order:

```markdown
::: {.kicker}
PAPER READ
:::

# Original paper title

Report content...
```

Use `pagetitle` for browser metadata rather than relying on Quarto's generated
title block. With `theme: none`, some render paths omit `main`; the stylesheet
therefore presents `body` as a centered reading region whose width, padding,
and outer gutters respond to the browser width. Tables remain inside that
region and wrap their cell content instead of introducing horizontal scrolling.

---

# Visual system

Use a restrained single-column research-editorial layout.

Use [report-style.css](report-style.css) as the stable visual stylesheet.

The report should prioritize:

- readable body text;
- strong heading hierarchy;
- wide evidence tables;
- restrained red accent;
- high contrast;
- generous whitespace;
- responsive tables that fit the reading region and wrap long cell content.

Do not use:

- decorative cards;
- gradients;
- emoji;
- heavy colored blocks;
- repeated boxed callouts;
- visually noisy dashboards.

---

# Header

Start with:

1. a compact kicker;
2. the paper title;
3. a short deck giving the paper's central question or contribution;
4. optional bibliographic metadata.

Recommended metadata:

| Field | Value |
|---|---|
| Authors | Original names |
| Year | Publication year |
| Venue | Original venue |
| DOI / identifier | Persistent identifier when available |

Do not translate original paper titles, author names, venue names, DOI, PMID, OpenAlex IDs, or URLs.

---

# Main report structure

Use exactly four major sections unless the user explicitly asks for another format.

## 1. Problem and theoretical framing

Prefer concise prose or a compact key-value table.

Cover:

- core problem;
- why it matters according to the authors;
- theoretical/conceptual framework;
- author-stated novelty or gap when relevant.

Do not independently validate field-level claims here unless an external verification workflow has been run.

---

## 2. Solution, experiments, and evidence

This is the dominant section.

Begin with a short paragraph describing the overall research strategy.

Then use a full-width fixed-layout table whose cells wrap within the reading region:

| Experiment / Analysis | Question | Procedure / Task flow | Method / Analysis | Result | Interpretation |
|---|---|---|---|---|---|

This table should aim for near-complete coverage of all substantive results.

### Procedure / Task flow cell

This cell should briefly state:

- what participants/systems did;
- chronological task order;
- what each major task/manipulation was for.

The user should be able to reconstruct the experimental logic from the table.

### Result cell

State the substantive finding, not merely significance.

### Interpretation cell

State what the result supports and where the inference stops.

Keep rows self-contained.

For large multi-experiment papers, allow the table to be long.

Do not shorten it merely for visual compactness.

---

## 3. Position in the field

Use concise prose or a small table.

Recommended structure:

| Field | Content |
|---|---|
| Prior framework | Relevant starting point |
| Claimed gap | What the paper says is missing |
| Contribution | What the paper adds |
| Positioning | One-sentence field position |

Make author-stated field claims visibly distinguishable from externally verified claims.

If external verification has been performed, label the result explicitly.

---

## 4. Limitations and future directions

Use a compact table:

| Type | Content |
|---|---|
| Authors' stated limitations | Explicitly acknowledged limitations |
| Additional limitations | Evidence-based interpretational constraints |
| Future directions | Natural next questions |

Do not add speculative criticism solely to fill the table.

---

# Language

Follow the user's requested language.

When the conversation is in Chinese and no different preference is stated:

- write the analytical report primarily in Chinese;
- keep technical terms in English when this improves precision;
- preserve original task/model names;
- do not force bilingual duplication unless the user requests it.

---

# Accessibility and responsive behavior

- Keep text contrast high.
- Use semantic headings.
- Use HTML tables with header cells.
- Keep every table within the reading region; wrap long text and identifiers rather than using horizontal scrolling.
- Preserve table headers when printing.
- Avoid splitting rows across printed pages when possible.
- Keep the layout readable on narrow screens.
