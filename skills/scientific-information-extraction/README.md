# scientific-information-extraction

A low-cost scientific-paper primitive for answering one bounded question from one paper.

## Core boundary

The skill supports:

- one source-grounded information unit (`A`), or
- one local inferential operation (`A + B + ... → C`).

It does not build multi-step argument chains, whole-paper summaries, or cross-paper syntheses.

## Standard output

- `answer`
- `evidence[]`
- `source_locations[]`
- `source_depth`
- `inference`
- `limitations`

`source_depth` is one of:

- `metadata`
- `abstract`
- `partial-text`
- `full-text`

## Intended callers

- `scientific-paper-reading`: for local questions that the current summary cannot answer.
- `scientific-literature-review`: for targeted extraction of review-relevant information from one paper when metadata/abstract are insufficient.

The skill deliberately has no report format or stylesheet because it produces a compact structured extraction result rather than a standalone report.
