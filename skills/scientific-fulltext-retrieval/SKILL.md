---
name: scientific-fulltext-retrieval
description: Retrieve and prepare lawful accessible full-text sources for already identified scientific papers without semantically reading or summarizing them. Resolve versions, verify paper identity, record access provenance and file/source availability, and hand the source to downstream targeted information extraction only when a specific query requires it.
---

# Scientific Full-Text Retrieval

## Goal

Given an already identified scientific paper, find the best lawful accessible full-text source and prepare it for later use.

The core rule is:

**Full-text acquisition is not full-text reading.**

This skill retrieves, verifies, records, and optionally saves a source. It does not summarize, interpret, or semantically read the paper during acquisition.

The normal workflow is:

**paper identity → search accessible versions → verify match/version → record/save source → stop**

Only a downstream task with a specific information need should trigger semantic reading.

---

# 1. Scope

Use this skill when:

- a paper is already known from a literature review, bibliography, DOI, title, PMID, or other identifier;
- only metadata/abstract is currently available;
- a downstream task may need methods, results, tables, figures, supplement, or numerical values;
- the goal is to upgrade source availability, not yet to answer a scientific question.

Typical requests:

- find an accessible full text for a Core paper;
- upgrade an abstract-only paper in a literature review;
- locate the supplement for a paper;
- find a repository or accepted-manuscript version;
- prepare papers needed for later data synthesis.

Do not use this skill to:

- discover the literature from scratch;
- summarize a paper;
- verify a scientific claim by reading the whole paper;
- extract a specific result or number;
- synthesize across papers.

Those belong to `scientific-literature-review`, `scientific-information-extraction`, `scientific-paper-reading`, or `scientific-data-synthesis`.

---

# 2. Hard token-efficiency rule

**Do not semantically read, summarize, interpret, or analyze retrieved full text during acquisition.**

Permitted during retrieval:

- inspect bibliographic metadata;
- inspect landing-page metadata needed to identify the paper;
- inspect filenames, repository records, version labels, access status, and file format;
- verify that a candidate source corresponds to the target paper;
- download or record a lawful accessible file/source.

Not permitted by default:

- reading Introduction/Methods/Results/Discussion for scientific content;
- extracting results;
- summarizing experiments;
- reconstructing arguments;
- generating a paper summary merely because a PDF was found.

When a later query asks for specific information:

**retrieved source → `scientific-information-extraction` → targeted sections/chunks only**

---

# 3. Retrieval priority

Prefer reliable, lawful, stable sources.

A useful default order is:

1. publisher open-access full text;
2. PubMed Central / Europe PMC or another trusted full-text archive;
3. official preprint server;
4. institutional repository / author-accepted manuscript;
5. author or laboratory repository;
6. Google Scholar full-text links / All versions as a discovery route;
7. institutionally accessible publisher copy through the user's own authenticated library/VPN/browser session;
8. user-provided PDF or full-text file.

Do not assume that the publisher version is always preferable if another lawful version is easier to retrieve and scientifically equivalent for the downstream question.

---

# 4. Identity verification

Before accepting a candidate source, match it to the target paper using as many of the following as available:

- DOI or PMID;
- exact or near-exact title;
- authors;
- year;
- venue;
- volume/issue/pages;
- repository metadata.

Use:

- `exact` when the identity is unambiguous;
- `probable` when the source is very likely the target but one or more metadata fields are incomplete;
- reject a source when the identity is materially inconsistent.

Never attach an uncertain PDF to a paper merely because the title is similar.

---

# 5. Version handling

Multiple accessible files may represent the same scholarly work.

Recognize, when possible:

- version of record / publisher version;
- accepted author manuscript;
- preprint;
- conference version;
- repository copy;
- supplementary material;
- corrected or updated version.

Do not count these as separate papers merely because they have separate URLs.

Record the relationship between versions.

Prefer a source that is sufficiently complete for downstream extraction.

If a preprint and final article differ materially, keep both version records and mark that downstream extraction should prefer the final version unless the user asks otherwise.

---

# 6. FullTextRecord

For every retrieval attempt, maintain a compact record:

```text
FullTextRecord
- paper_id
- title
- doi_or_identifier
- availability
- version
- source_provider
- source_url_or_file
- format
- access_type
- match_confidence
- supplement_available
- retrieval_date
- notes
```

Recommended values:

### availability
- `full-text`
- `partial-text`
- `abstract-only`
- `unavailable`

### version
- `version-of-record`
- `accepted-manuscript`
- `preprint`
- `repository-copy`
- `conference-version`
- `supplement`
- `unknown`

### format
- `pdf`
- `html`
- `xml`
- `text`
- `other`

### access_type
- `open-access`
- `institutional-access`
- `user-provided`
- `public-repository`
- `unknown`

The record describes source availability, not evidence strength.

---

# 7. Saving and indexing

When a downloadable lawful file is available, save it in a stable location associated with the parent review when possible.

Recommended review structure:

```text
<review-folder>/
├── literature-review.qmd
├── fulltext/
│   ├── <paper-id-or-short-name>.pdf
│   └── ...
└── source-index.csv   [optional]
```

Do not create duplicate copies when the same file is already available.

If the source cannot be downloaded but is accessible by URL, record the URL and access type.

The purpose is to make future targeted extraction cheap and direct.

---

# 8. Batch upgrade of a literature review

Support a review-oriented mode such as `upgrade-review`.

Default priority:

1. Core papers with abstract-only status;
2. papers supporting or challenging major synthesis units where the claim cannot be verified from the abstract;
3. papers required for `scientific-data-synthesis`;
4. important conflicting/null/replication papers;
5. user-selected papers.

Do not automatically retrieve every paper in a large review if downstream use is unlikely.

Retrieval is cheap relative to deep reading, but source discovery can still be noisy and should remain purpose-driven.

---

# 9. Institutional access

Institutional subscriptions may expose full text that is unavailable publicly.

This skill may use a source that the user can lawfully access through their institution, but it must not request, store, or transmit the user's password.

Preferred patterns:

- the user authenticates in their own browser/VPN/library proxy;
- the user supplies the resulting accessible article/PDF;
- the user supplies a lawful authenticated download result;
- a connected institutional/library tool provides authorized access without revealing credentials.

Never ask the user to paste institutional passwords, VPN passwords, library-proxy passwords, cookies, session tokens, or other reusable authentication secrets into chat.

---

# 10. Failure handling

If no full text is found:

- preserve the best available source;
- set availability appropriately;
- record attempted source classes when useful;
- do not invent access;
- do not infer paper content from title/abstract beyond what those sources support.

A failed retrieval does not make the paper invalid.

It means downstream extraction must remain limited to the available source depth.

---

# 11. Interaction with downstream skills

## With `scientific-information-extraction`

This is the normal downstream path.

```text
specific question
→ check FullTextRecord
→ if full text available, inspect only relevant sections/chunks
→ extract one information unit or one-step local inference
```

## With `scientific-paper-reading`

Use retrieved full text only when the user explicitly wants a whole-paper understanding or a multi-step argument reconstruction.

## With `scientific-data-synthesis`

Use retrieval to upgrade papers whose required numerical values are not available in metadata/abstract.

Do not extract the numbers during retrieval itself.

---

# 12. Final mental model

This skill answers:

> "Can I obtain and prepare a trustworthy full-text source for this already identified paper?"

It does not answer:

> "What does this paper say?"

That second question requires a downstream reading or extraction task.
