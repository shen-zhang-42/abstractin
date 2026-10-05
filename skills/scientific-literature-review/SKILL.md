---
name: scientific-literature-review
description: Iteratively review scientific literature around a topic, question, researcher, or research group. Build a question-conditioned conceptual structure, track new concepts across five concept classes, search until conceptual saturation is high, optionally assess whether near-exhaustive paper retrieval is feasible within the current resource budget, then synthesize review-relevant units with progressive source acquisition, targeted information extraction, evidence assessment, and living-review maintenance.
---

# Scientific Literature Review

## Goal

Construct the current state of knowledge relevant to a scientific review question.

The review is **question-conditioned**, not paper-conditioned.

A paper contributes whatever information is relevant to the current review question. That contribution may be:

- one of the paper's main conclusions;
- a method or model used inside the paper;
- a formal or theoretical claim;
- an experimental result;
- a boundary condition;
- a model-comparison result;
- a methodological limitation;
- a replication, null result, or contradiction;
- another source-grounded fact that matters for the review.

Do not assume that a paper's headline conclusion is the relevant unit merely because it is the paper's main conclusion.

The primary output is:

**Review question → synthesis units → supporting basis / evidence → uncertainty or conflict → literature**

Do not organize the review primarily as a paper-by-paper summary.

---

# 1. Define the review

Before the main search, determine:

- the scientific review question;
- important scope restrictions;
- review mode when relevant (`topic`, `researcher`, or `group`);
- whether the user requires ordinary conceptual coverage or explicitly requests near-exhaustive paper coverage;
- the kinds of information that must eventually be synthesized.

The review question is the main control variable.

Do not assign a fixed global granularity level such as G0–G3.

Instead, use **question-conditioned conceptual resolution**:

> Expand the conceptual structure only to the level at which further subdivision no longer materially improves the answer to the current review question.

A broad question therefore usually induces a coarser useful structure, while a narrower question naturally requires deeper structural resolution.

The same topic may therefore be represented at different depths in different reviews.

## Review modes

### Topic
Review a scientific topic or question.

### Researcher
Review the research of one researcher.

### Group
Review the research of a laboratory, research group, or closely related research lineage.

Review mode does not determine what kinds of concepts or synthesis units are allowed.

---

# 2. Conceptual structure

Every review should first aim for **conceptual exhaustiveness**, not paper-count exhaustiveness.

Conceptual exhaustiveness means:

> The search has recovered the major review-relevant concepts needed to answer the current review question, and additional independent search routes are no longer producing materially new concepts.

Track five concept classes:

1. **Question** — a new research question, subquestion, or scientific objective.
2. **Entity / phenomenon** — a new object, variable, phenomenon, mechanism, behavioral pattern, empirical regularity, or scientifically meaningful target.
3. **Theory / explanation** — a new explanatory framework, mechanism, theory, conceptual model, or interpretation.
4. **Method** — a new experimental paradigm, measurement, analytical method, computational model, technical approach, or solution strategy.
5. **Relation / boundary** — a new relation among known concepts, dependency, moderation, boundary condition, applicability condition, or limiting case.

A new result is not automatically a new concept. Treat a result as conceptually new only when it introduces or materially changes one of the five classes above.

Alternative terminology is not a conceptual branch unless it corresponds to a scientifically meaningful distinction.

Search aliases, spelling variants, database keywords, author groups, and citation clusters belong to the retrieval profile rather than the conceptual structure.

## Concept-bearing vs concept-filling papers

A paper may be:

- **concept-bearing** — introduces at least one new review-relevant concept;
- **concept-filling** — adds evidence, examples, replication, detail, or qualification within concepts already represented.

A paper may do both.

Concept-bearing papers are especially important during early and middle search because they modify the conceptual structure.

Concept-filling papers remain important for evidence synthesis even when they do not change the structure.

## Recursive structural refinement

For every conceptual node ask:

> Would subdividing this node materially improve the answer to the current review question?

Continue subdivision when it:

- introduces a distinct scientific question;
- requires a distinct explanatory framework;
- separates substantively different phenomena or mechanisms;
- requires a distinct method or paradigm for interpretation;
- exposes a relation or boundary that changes the synthesis.

Stop subdividing when additional distinctions merely add detail without changing the explanatory structure of the review.

Do not subdivide a scientific concept merely because it is difficult to search.

Search difficulty and conceptual structure are separate.

---

# 3. Concept discovery and conceptual saturation

The primary early objective is **new-concept discovery**.

For every newly relevant paper ask:

> Does this paper introduce a new review-relevant question, entity/phenomenon, theory/explanation, method, or relation/boundary?

Maintain a concept inventory and record which papers introduced or materially developed each concept.

## Search routes for concept discovery

### Route A — Terminology search

Search main topic terms, synonyms, related constructs, method/model names, and recent terminology.

Primary discovery sources:

- Google Scholar for broad discovery;
- Semantic Scholar for structured discovery and related-paper expansion.

### Route B — Review-guided search

Use reviews, meta-analyses, perspectives, theory papers, and handbook-style syntheses when appropriate.

Primary purpose:

- identify established questions;
- theories;
- major methods;
- known relations and boundaries;
- terminology families.

Reviews guide structure but do not replace primary evidence.

### Route C — Citation-network expansion

From concept-bearing and Core papers, use backward and forward citation.

Backward citation is especially useful for conceptual origins, precursor theories, foundational methods, and earlier terminology.

Forward citation is especially useful for extensions, competing explanations, replications, boundary conditions, new methods, and recent developments.

Semantic Scholar and OpenAlex are preferred structured sources for this stage.

### Route D — Researcher / group expansion

Expand from authors, laboratories, and research lineages that repeatedly introduce or develop important concepts.

Use this route to recover conceptual development, follow-up questions, new methods, and emerging directions before they form a large citation cluster.

### Route E — Challenge search

When the structure appears stable, deliberately search outside dominant terminology and citation routes.

Use:

- alternative terminology;
- recent papers;
- unusual paradigms;
- contradictory findings;
- neighboring disciplines;
- independent research groups;
- papers outside dominant citation clusters.

Primary purpose:

> Find a relevant paper that cannot be naturally represented by the current conceptual structure.

Challenge search is required before declaring high conceptual saturation.

## Search-engine roles

Use engines by function:

- **Google Scholar** — broad discovery, unusual terminology, older/cross-disciplinary work, coverage challenge, version discovery.
- **Semantic Scholar** — structured keyword search, related papers, citation expansion, author expansion.
- **OpenAlex** — citation-network cross-checking, author/group expansion, coverage auditing.
- **Europe PMC** — biomedical/neuroscience search, citation cross-checking, full-text discovery.
- **Crossref** — bibliographic identity and DOI/metadata verification, not primary discovery.

Do not run every engine for every query.

Prefer:

**Discover → Scholar + Semantic Scholar  
Expand → Semantic Scholar (+ Europe PMC when domain-relevant)  
Challenge coverage → Scholar + OpenAlex  
Verify → Crossref / domain index / publisher  
Acquire full text → `scientific-fulltext-retrieval`**

Database count is not a proxy for coverage.

## Concept-novelty tracking

After each search round record:

```text
new questions: N
new entities / phenomena: N
new theories / explanations: N
new methods: N
new relations / boundaries: N
```

Also record which discovery route produced each new concept.

Do not treat additional papers as structural novelty when they only populate existing concepts.

## Conceptual saturation

Conceptual saturation is a probabilistic search judgment, not a proof of completeness.

Use three kinds of evidence:

### Novelty decline
Newly screened relevant papers increasingly map onto existing concepts rather than creating new ones.

### Cross-route convergence
Independent discovery routes increasingly recover papers that fit the same conceptual structure.

### Challenge failure
Deliberate challenge searches fail to reveal materially new review-relevant concepts.

Use:

- `Low` — new concepts still appear frequently;
- `Moderate` — major structure is visible, but some routes still add concepts;
- `High` — multiple independent routes converge and challenge search produces little or no conceptual novelty.

Never label conceptual coverage as absolutely complete.

Always preserve residual structural uncertainty when relevant.

---

# 4. Paper exhaustibility and optional near-exhaustive search

Conceptual exhaustiveness is the default objective of every review.

Paper-level near-exhaustiveness is an optional objective.

Only pursue it when:

- the user explicitly asks for all or nearly all directly relevant papers; or
- the review task clearly requires near-exhaustive paper retrieval.

Before doing so, assess:

> Is near-exhaustive paper retrieval feasible within the current resource budget?

Call this **paper exhaustibility under current resources**.

## Preliminary factors

Consider:

- scope boundedness;
- terminology concentration;
- estimated corpus size;
- indexability of the literature.

These factors provide only a provisional judgment.

## Pilot multi-route search

Use several independent discovery routes and record:

- total candidates;
- in-scope papers;
- new unique in-scope papers;
- already-known papers;
- new terminology discovered.

Evaluate:

### Marginal paper yield
How many new unique in-scope papers are found by each additional route or search round?

### Cross-route overlap
Do different search routes increasingly recover the same papers?

### Terminology stability
Does the search continue to discover new productive terminology families?

### Citation-boundary stability
Does citation expansion keep opening new independent clusters, or does it increasingly return to the known paper set?

### Corpus growth
Does cumulative unique in-scope paper count begin to plateau with added search effort?

## Exhaustibility decision

Use three states:

### `Feasible`
Near-exhaustive retrieval appears realistic within the available search budget.

Proceed to near-exhaustive paper search.

### `Uncertain`
The search is beginning to converge but meaningful uncertainty remains.

Run targeted challenge searches and reassess.

### `Not feasible`
Near-exhaustive retrieval is not realistic within the current resource budget.

If the user requires paper-level near-exhaustiveness, recommend narrowing the review question or scope.

Do not pretend that an infeasible search is exhaustive.

## Near-exhaustive search

When `Feasible`, continue multi-route retrieval until:

- independent routes produce very few new in-scope papers;
- terminology is stable;
- citation expansion largely returns known papers;
- cumulative corpus growth is near a plateau;
- targeted challenge searches add little.

Report residual uncertainty rather than claiming logical completeness.

---

# 5. Review-relevant synthesis units

The primary unit of synthesis is a **review-relevant synthesis unit**, not necessarily a paper's own scientific conclusion.

For every candidate unit ask:

> What does this paper provide to the current review question?

A synthesis unit may be:

1. **Empirical claim**
2. **Theoretical or formal claim**
3. **Method / model characterization**
4. **Comparative result**
5. **Boundary / limitation**
6. **Other review-relevant information**

Maintain:

- `Paper set`
- `Core-paper set`
- `Concept set`
- `Synthesis-unit set`

A paper may contribute to multiple concepts and synthesis units.

A synthesis unit may be supported, defined, qualified, or challenged by multiple papers.

---

# 6. Scientific-information-extraction dependency

Use `scientific-information-extraction` as the default low-level retrieval primitive when a paper must provide one local information unit or one local one-step inference.

Examples:

- What model did this paper use for risky choice?
- Which parameters were estimated?
- How was the model compared with an alternative?
- What result did the comparison produce?
- What boundary condition was reported?
- Result A + control B → what local interpretation is supported?

The extraction skill may return:

- direct information (`A`);
- one-step local inference (`A -> C`, `A + B + ... -> C`).

Do not use it to construct a paper's complete multi-step argument.

Do not use `scientific-paper-reading` by default for every paper in a literature review. Full paper-reading is substantially more expensive and should be reserved for papers whose global argument is itself important to the review or whose local evidence cannot be understood without a whole-paper representation.

---

# 7. Scientific-fulltext-retrieval dependency

Use `scientific-fulltext-retrieval` when a paper is already identified but the currently available source depth is insufficient for a likely downstream need.

Its job is to:

- find lawful accessible full-text versions;
- resolve publisher / accepted-manuscript / preprint / repository versions;
- verify that the source matches the target paper;
- record access provenance and source availability;
- optionally save the file with the review.

**Retrieval must not trigger semantic reading.**

Finding or downloading a PDF is not permission to summarize or inspect the whole paper.

The normal chain is:

**paper identified → full-text retrieval → source recorded/saved → stop**

Later, when a specific query requires deeper information:

**specific question → `scientific-information-extraction` → inspect only the relevant sections/chunks**

This separation is required for token efficiency.

For a large review, prioritize retrieval for:

1. Core papers;
2. papers supporting or challenging important synthesis units that cannot be verified from abstracts;
3. papers needed for `scientific-data-synthesis`;
4. important conflicting, null, or replication papers;
5. papers explicitly selected by the user.

Do not automatically semantically process retrieved full text.

## Institutional access

Institutional subscriptions may provide full text that public search cannot access.

The user should authenticate through their own browser, VPN, library proxy, or other authorized institutional route.

Do not ask the user to provide passwords, session cookies, access tokens, or other reusable authentication secrets.

If the user can lawfully access the paper, they may provide the resulting PDF/file or an accessible source to the workflow.

---

# 8. Progressive information acquisition

Use the **lowest sufficient source depth** for each review-relevant information need.

Source depth:

1. `metadata`
2. `abstract`
3. `partial-text`
4. `full-text`

## Metadata / abstract first

Use bibliographic metadata and abstracts for screening, terminology discovery, rough relevance, and claims that are explicitly supported at that depth.

Do not infer unavailable methodological or result details from an abstract.

## Targeted text extraction

When the abstract is insufficient and full text is accessible, use `scientific-information-extraction` to inspect only the relevant sections, figures, tables, or supplement.

Having full text does **not** imply reading the full paper deeply.

## Deep paper reading

Use `scientific-paper-reading` only when:

- the paper's global argument is itself central to the review;
- multiple linked experiments must be reconstructed as a chain;
- interpretation depends on multi-step reasoning across the whole paper;
- targeted extraction repeatedly leaves an important ambiguity unresolved.

## No full text

If full text is unavailable:

- look for lawful accessible versions when useful;
- use the best available metadata, abstract, or partial text;
- record the source depth;
- state what cannot be verified;
- do not guess.

Source depth describes **how deeply the paper was checked**. It is not the same as evidence strength.

## Source-access state

For important papers, maintain source-access status separately from evidence status.

Recommended values:

- `abstract-only`
- `partial-text available`
- `full-text available`
- `full-text saved`
- `retrieval attempted / unavailable`

When a paper is upgraded from abstract-only to full-text available, do not automatically re-read it.

Only re-extract information when:

- an existing synthesis unit needs verification;
- a new review question requires deeper detail;
- `scientific-data-synthesis` requests a specific statistic or observation;
- the user explicitly asks a paper-level question.


---

# 9. Search execution policy

The conceptual-discovery framework in Sections 2–4 replaces the old fixed four-loop search model.

Search behavior is adaptive:

1. **Structure-building phase**
   - maximize discovery of new review-relevant concepts;
   - prioritize concept-bearing papers;
   - use terminology, review-guided, citation, and researcher routes.

2. **Structure-challenge phase**
   - deliberately test whether the current conceptual map is missing important directions;
   - use recent, alternative-terminology, neighboring-field, independent-group, and outside-cluster searches.

3. **Conceptually saturated phase**
   - stop expanding structure when conceptual saturation is High;
   - continue paper search only as needed for evidence synthesis or explicit paper-level exhaustiveness.

4. **Near-exhaustive paper phase**
   - enter only after paper exhaustibility is assessed as `Feasible`;
   - search until marginal unique-paper yield is very low across independent routes.

Search effort is controlled by the current review state, not by a fixed number of loops or citation hops.

---

---

# 10. Paper importance and provenance

Paper importance is relative to the current review question.

Read and apply [EVIDENCE-ASSESSMENT.md](EVIDENCE-ASSESSMENT.md) when classifying papers or synthesis units.

Track discovery provenance where useful:

- `seed-search`
- `backward-citation`
- `forward-citation`
- `researcher-expansion`
- `gap-search`
- `user-provided`

User-provided papers are **user-provided seeds**, not automatically Core papers.

Do not equate user emphasis, journal prestige, or citation count with evidential importance.

---

# 11. User interaction

Interact with the user at three main stages.

## Interaction 1 — Scope

Present:

- proposed review question;
- review mode;
- question-conditioned conceptual resolution;
- important scope choices;
- proposed synthesis dimensions when useful.

## Interaction 2 — Preliminary synthesis

Present:

- current conceptual structure and concept inventory;
- conceptual saturation status;
- current synthesis units;
- current Core papers;
- empirical evidence strength where applicable;
- important conflicts or alternatives;
- likely missing directions;
- recommended next searches.

Ask which directions deserve further emphasis.

## Interaction 3 — Near saturation

Present:

- stable conceptual structure;
- conceptual saturation status;
- stable synthesis units;
- unresolved conflicts;
- likely scientific gaps;
- remaining search uncertainty.

The user can stop or request another targeted search.

Avoid unnecessary interaction between these stages.

---

# 12. Evidence synthesis and assessment

Before rating evidence, replication, conflict, or paper roles, read [EVIDENCE-ASSESSMENT.md](EVIDENCE-ASSESSMENT.md).

Required invariants:

- synthesis units are conditioned on the review question;
- paper importance is relative to the review question;
- source depth is separate from evidence strength;
- E0–E4 is used for empirical claims when replication-based evidence strength is meaningful;
- descriptive method/model facts and formal definitions are not forced into E0–E4;
- independent replication outweighs repeated results from one research lineage;
- credible null, failed-replication, and opposite results must be sought actively for empirical claims;
- boundary conditions and unresolved questions remain explicit.

---

# 13. Living-review state

The report is persistent state, not a one-shot document.

Record at minimum:

- `created_at`
- `last_search_date`
- current review question and scope;
- Paper set;
- Core-paper set;
- Concept set;
- Synthesis-unit set;
- discovery provenance where useful;
- source depth for important extracted information;
- conceptual saturation status and residual structural uncertainty;
- paper exhaustibility status when assessed;
- major unresolved search gaps.

## `refresh`

Default operation when the user asks to run an existing review again.

Search primarily for literature published or updated **after `last_search_date`**.

Process only new or newly relevant information.

New discoveries may legitimately lead backward to older papers when:

- a new paper cites an important older work that was previously missed;
- a new conceptual branch reveals an old coverage gap;
- a user-provided seed exposes an older lineage.

Thus:

> Routine refresh is date-bounded; citation expansion from genuinely new seeds may reach older literature.

Do not automatically rebuild the entire review.

## `add-paper`

When the user manually supplies a paper:

1. identify it using title / DOI / authors / year when possible;
2. deduplicate against the current Paper set;
3. determine whether it is:
   - genuinely new;
   - an already-known paper with richer/full text;
   - a duplicate with no new information;
   - outside the current scope;
4. if new, treat it as a user-provided seed and evaluate relevance;
5. use targeted information extraction for review-relevant information;
6. expand backward/forward citations when the paper opens a useful new branch;
7. update only affected synthesis units.

If the user provides a richer source for an existing paper, upgrade its source depth and re-check only the information that was previously insufficiently verified.

Do not count preprint, accepted manuscript, conference, and journal versions of the same work as independent evidence merely because they are separate records.

## `rebuild`

Perform a full search and synthesis from scratch only when:

- the user explicitly requests it;
- the review question changes substantially;
- the scope changes enough that the previous search state is no longer a valid foundation;
- the existing review is too incomplete or internally inconsistent to refresh safely.

---

# 14. Delta-based updating

After `refresh` or `add-paper`, determine the **evidence delta** and **report delta**.

A paper materially changes the synthesis when it:

- creates a new synthesis unit;
- materially strengthens or weakens an empirical claim;
- changes an E0–E4 level;
- introduces a credible conflict;
- adds an important boundary condition;
- fills an important methodological/model branch;
- materially changes the interpretation of an existing unit.

If no substantive synthesis changes occur:

- update `last_search_date`;
- update search coverage / progress;
- update the literature list and relevant metadata;
- do not rewrite the entire main synthesis.

When changes occur, rewrite only the affected synthesis units and summary elements.

Useful update summary:

```text
New papers: N
New Core papers: N
New synthesis units: N
Evidence-level changes: ...
New conflicts: ...
New branches / boundary conditions: ...
```

---

# 15. Literature verification

Never include a paper in the formal literature set solely from model memory.

Every paper must be verified against at least one real bibliographic source before formal use.

Preferred sources include:

- OpenAlex;
- Crossref;
- PubMed;
- Europe PMC;
- Semantic Scholar;
- publisher metadata;
- other established scholarly indexes.

Verify as many as available:

- title;
- authors;
- publication year;
- journal or venue;
- DOI, PMID, OpenAlex ID, or other persistent identifier.

When possible, confirm important Core papers using more than one source.

If a paper cannot be verified:

- do not invent missing metadata;
- do not cite it as formal evidence;
- do not include it in the formal literature list;
- retain it only as an unverified search candidate when useful.

Never fabricate study results, abstracts, citation counts, or bibliographic details.

---

# 16. Literature-review report

Produce an updateable `.qmd` report as the canonical source file.

The `.qmd` file is the single source of truth. Do not generate a duplicate `.md` file by default.

After the QMD report is complete, ask whether the user wants an `.html` reading version.

- If Quarto is available, render locally.
- If Quarto is unavailable, generate a standalone content-equivalent HTML only when requested.

Default parent directory:

`D:\LifeOfWork\literature-review`

Create a clearly named review subdirectory inside it.

Before creating or substantially reformatting a report, read [REPORT-FORMAT.md](REPORT-FORMAT.md) and use [report-style.css](report-style.css).

Citation counts are time-dependent; always show source and retrieval date.

---

# 17. Report information architecture

Keep the report synthesis-first rather than paper-first.

Use this order:

1. `Summary / 摘要` — question, scope, method, search status, synthesis matrix, leading answer and principal caveat;
2. `Current synthesis / 当前综合` — themes and complete synthesis-unit records;
3. `Cross-cutting unresolved issues / 跨综合单元问题` — only when an issue affects multiple units;
4. `Search coverage and method / 检索覆盖与方法`;
5. `Full literature list / 完整文献表`.

Use tables whenever information has stable fields.

Reserve prose for synthesis that would become harder to read in cells.

Do not turn the report into a paper-by-paper catalogue.

---

# 18. Literature entries

Within each synthesis unit, present the literature relevant to that unit.

Include when useful:

- paper;
- year / venue;
- role;
- contribution to the synthesis unit;
- importance;
- source depth for the relevant extracted information;
- citation count with source/date;
- persistent identifier.

A paper may belong to multiple synthesis units.

The full literature table should retain:

- authors;
- year;
- original title;
- journal or venue;
- DOI or persistent identifier;
- citation count, source, and retrieval date;
- role: Core / Supporting / Peripheral;
- conceptual importance;
- topical centrality;
- citation-network centrality;
- citation impact;
- evidential importance;
- overall importance;
- synthesis units supported, defined, qualified, or challenged;
- concise review-relevant contribution;
- discovery provenance when useful.

Do not translate original titles, author names, venue names, or identifiers.

---

# 19. Researcher and group reviews

For researcher/group mode:

1. identify the relevant publication set;
2. cluster publications into research themes;
3. identify Core papers in each theme;
4. construct review-relevant synthesis units;
5. evaluate empirical evidence using E0–E4 when applicable;
6. distinguish evidence produced by the group from independent confirmation;
7. summarize how the research program developed over time.

Do not confuse productivity with evidential strength.

---

# 20. Scientific discipline

Always distinguish:

- direct source information from inference;
- source depth from evidence strength;
- correlation from causation;
- finding from interpretation;
- model fit from mechanistic evidence;
- within-group replication from independent replication;
- absence of evidence from evidence of absence;
- failed replication from opposite evidence;
- search gaps from scientific gaps.

Never raise confidence merely because:

- many papers come from the same group;
- the journal is prestigious;
- citation count is high;
- authors express high confidence.

---

# 21. Operating modes

## `review`
Run a new review from scope definition through synthesis.

## `refresh`
Incrementally search after `last_search_date`, process new information, and update only affected state.

## `add-paper`
Ingest a user-provided paper or richer source, deduplicate, extract review-relevant information, expand locally if useful, and update affected synthesis units.

## `rebuild`
Re-run the full search and synthesis from scratch when explicitly needed.

---

# 22. Final mental model

The normal review workflow is:

**review question  
→ question-conditioned conceptual resolution  
→ discover five classes of review-relevant concepts  
→ recursively refine the conceptual structure  
→ challenge the structure with independent search routes  
→ conceptual saturation assessment  
→ optional paper-exhaustibility assessment  
→ near-exhaustive paper search only when feasible and requested  
→ progressive source acquisition  
→ targeted scientific-information-extraction  
→ review-relevant synthesis units  
→ empirical evidence assessment where applicable  
→ updateable QMD report**

The living-review workflow is:

**existing review state  
→ refresh or add-paper  
→ detect new concepts and new / upgraded information  
→ update conceptual saturation when needed  
→ targeted extraction  
→ evidence delta  
→ synthesis delta  
→ update only affected report state**

The final goal is not to collect the largest possible number of papers.

The goal is to:

1. recover the review-relevant conceptual structure at the resolution required by the current question;
2. build high confidence that important concepts are not being missed;
3. estimate honestly whether near-exhaustive paper retrieval is feasible when requested;
4. synthesize what the literature provides for the review question;
5. distinguish evidence, uncertainty, conflict, and remaining search gaps.
