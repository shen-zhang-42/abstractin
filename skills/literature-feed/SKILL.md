---
name: literature-feed
description: Track recent scientific literature for a topic, question, researcher, or research group. Search preprint servers, online-first publications, and bibliographic databases; maintain persistent feed configuration and seen-item state; summarize all newly relevant work in clearly separated bilingual editorial records; report author-affiliation mappings; rate topical relevance and scientific importance separately; and support recurring weekly or monthly literature feeds.
---

# Literature Feed

## Goal

Continuously track new scientific work for a defined topic, question, researcher, or research group.

The feed should answer:

1. What new work appeared?
2. What did each study do?
3. What is the main result?
4. What is genuinely new?
5. How relevant is it to this feed?
6. How scientifically important is it?
7. Is it worth reading in full?
8. Which institutions are the authors affiliated with?

Do not filter out low-priority papers by default.

The default output is a complete feed of newly relevant work, ranked and summarized.

---

# 0A. User guidance and interactive onboarding

This skill should be able to explain itself and guide the user in normal conversation.

The goal is not merely to execute feed operations, but to help the user understand:

- what a literature feed is;
- what this skill can do;
- how to create and manage feeds;
- how to interpret its reports;
- what command or action is sensible next.

## When to introduce the skill

Give a brief introduction when:

- the user invokes `$literature-feed` without a specific operational request;
- the user asks what the skill does or how to use it;
- the user says they want to follow, monitor, or keep up with a research area but has not yet defined a feed;
- the user is creating their first feed;
- the user appears unsure what to do next.

Do not repeat the full introduction during routine feed runs.

A concise introduction should explain that the skill can:

1. create persistent literature feeds for topics, questions, researchers, or groups;
2. search recent journal publications and preprints;
3. verify bibliographic identity before including items;
4. track new, updated, and newly relevant work across runs;
5. score topical relevance and scientific importance separately;
6. list the published author-affiliation mapping for every paper;
7. produce bilingual English-Chinese reports with clearly separated editorial records, journal-like hierarchy, and indented subordinate text;
8. support manual and scheduled updates.

## Guide the user through setup

During feed setup, behave conversationally.

First infer as much as possible from the user's natural-language request.

Then briefly show the proposed feed definition, especially:

- feed title;
- semantic topic;
- important inclusion rules;
- important exclusion rules;
- frequency;
- notable researchers/groups if any;
- whether a baseline review is available.

Ask a question only when the answer would materially change the search space or feed behavior.

If the user's request is already clear enough, propose sensible defaults and proceed without forcing a questionnaire.

Example:

> I can turn this into a weekly feed. I would track brain organoids and living neuronal systems used for computation, learning, memory, or control; exclude ordinary disease-model organoid work unless it directly concerns computation; and include both preprints and journal papers. I can use the default weekly schedule unless you want a different scope.

## Explain available actions

When useful, tell the user the natural commands they can use.

Examples:

- `Create a weekly feed on ...`
- `Run feed <ID>`
- `Update feed <ID or name>`
- `Show my feeds`
- `Stop feed <ID>`
- `Change feed <ID> to include/exclude ...`
- `Add <researcher/group> to feed <ID>`
- `Explain this week's feed`
- `Show only P1 and P2 papers from feed <ID>`

Do not require exact command syntax. Natural-language equivalents should work.

## After creating a feed

After successful setup, report:

- feed ID;
- feed name;
- what is being watched;
- frequency;
- canonical storage path;
- mirror path(s), if any.

Then give one short next-step suggestion, normally:

- run it now for an initial update; or
- leave it for the next scheduled batch.

Do not overwhelm the user with implementation details unless requested.

## After running a feed

After a successful run:

1. summarize the most important scientific development in plain language;
2. mention the number of new/updated/newly relevant items;
3. mention search coverage if it was Partial or Limited;
4. point the user to the highest-priority paper(s);
5. offer one relevant next action.

Suitable next actions include:

- read a selected paper in depth;
- refine feed scope;
- add a researcher/group;
- compare this run with previous weeks;
- change frequency;
- inspect only high-priority items.

Do not automatically launch another operation merely because it was suggested.

## When listing feeds

When the user asks to show feeds, do not only dump registry fields.

Give a compact human-readable summary for each feed:

- ID and title;
- what it watches;
- status;
- frequency;
- last successful run;
- whether the feed appears healthy or has unresolved coverage/failure issues.

Then briefly remind the user that they can run, modify, stop, or inspect any feed by ID or name.

## Explain report fields when needed

If the user asks what a field means, explain it conversationally.

Important distinctions include:

- `Relevance` = how directly the paper belongs to this feed.
- `Scientific importance` = how much the work could matter to the field if correct.
- `Reading priority` = practical recommendation for the user.
- `Bibliographic verification` = the paper/metadata were confirmed; this is not scientific validation.
- `Search coverage` = how completely the intended sources were searched in that run.
- `New` / `Updated` / `Newly relevant` describe feed history, not paper quality.

## Interaction style

Be concise, research-oriented, and decision-focused.

Prefer one useful question over a long questionnaire.

Prefer showing a proposed interpretation that the user can correct rather than asking them to specify every configuration field from scratch.

Do not force interaction when the saved feed configuration already gives enough information for a routine run.

The guiding principle is:

**Introduce when useful → infer the user's intent → propose a concrete feed definition → ask only material questions → execute → explain what happened → suggest the next useful action.**

---

# 1. Operating modes

## Setup mode

Use when the user asks to create, start, establish, follow, or configure a new literature feed.

Determine:

- feed name;
- topic description;
- scope;
- include/exclude rules;
- search terminology;
- researchers/groups to watch;
- sources;
- frequency;
- output preferences;
- optional baseline review from `scientific-literature-review`.

Ask only when user input would materially change the search space.

After setup, automatically create the feed configuration, state file, and report directory.

The user should not need to manually copy templates.

## Run mode

Use when the user asks to update or run an existing feed.

Read:

1. global settings;
2. feed configuration;
3. prior seen-item state.

Search the relevant recent time window.

Return:

- all new relevant research items;
- important updates to previously seen items;
- concise field-level progress;
- relevance and scientific-importance scores.

Update persistent state and save a dated report.

## Scheduled mode

Same behavior as Run mode, but intended for recurring execution by an external scheduler or Codex automation.

The skill defines how the feed is run.

The scheduler defines when it is run.

## Stop mode

Use when the user asks to stop, delete, or remove a feed.

Delete:

- the active feed configuration;
- the active seen-state file.

Stop future scheduled execution when the environment allows it.

Preserve existing reports by default.

Delete report history only when the user explicitly requests it.

---

# 2. Global settings

Use a persistent global settings file.

Default location:

`~/.codex/literature-feed-settings.yaml`

On Windows this normally resolves to:

`%USERPROFILE%\.codex\literature-feed-settings.yaml`

Use `settings-template.yaml` when creating the settings file for the first time.

The settings file should define one canonical root directory:

`feed_root`

All feeds must be archived under this root.

The settings file may also contain:

- default frequency;
- default search window;
- default sources;
- default output preferences.

If `feed_root` has not been configured, ask the user to choose it when the first feed is created.

Do not silently scatter canonical feed data across workspaces.

---

# 3. Feed identity

Every feed receives a persistent random four-character identifier:

`XXXX`

The identifier must use ASCII letters and digits:

- `A-Z`
- `a-z`
- `0-9`

Examples:

- `a7K2`
- `Q3m9`
- `8BcR`

Generate the ID randomly when the feed is first created.

The ID is case-sensitive and must never change.

Before accepting a generated ID, check `registry.yaml` and existing feed directories for collisions.

If the ID already exists, generate another one.

The human-readable feed directory name is:

`feed-XXXX-<name>`

Example:

`feed-a7K2-human-meg-replay`

Use a filesystem-safe slug for `<name>`.

Do not use sequential IDs.

---

# 4. Canonical storage layout

All canonical feed output must live under `feed_root`.

Organize feeds first by ISO calendar year and ISO week:

`feed_year-YYYY_week-WW`

Then place each feed inside its own directory:

`feed-XXXX-<name>`

Example:

```text
<feed_root>/
├── feed_year-2026_week-01/
│   ├── feed-a7K2-human-meg-replay/
│   │   ├── feed.yaml
│   │   ├── seen.json
│   │   ├── report.html
│   │   ├── report.qmd
│   │   └── report.md
│   └── feed-Q3m9-organoid-computing/
│       ├── feed.yaml
│       ├── seen.json
│       ├── report.html
│       ├── report.qmd
│       └── report.md
├── feed_year-2026_week-02/
│   └── ...
└── registry.yaml
```

Each scheduled run writes the current week's snapshot into that week's directory.

The persistent identity of a feed is its `feed_id`, not its weekly path.

## Weekly snapshots

For a weekly feed, every run creates or updates:

`<feed_root>/feed_year-YYYY_week-WW/feed-XXXX-<name>/`

The folder should contain:

- `feed.yaml` — configuration snapshot used for that run;
- `seen.json` — state snapshot after that run;
- `report.html` — primary self-contained reading version;
- `report.qmd` — editable source for Positron Preview;
- `report.md` — complete feed report for that run.

If more than one successful run occurs in the same week, either:

- update the same weekly snapshot when it represents the same scheduled run; or
- append a timestamped report such as `report-YYYY-MM-DD-HHMM.md` when preserving multiple runs is useful.

For monthly feeds, keep the same year/week archive structure based on the date the feed actually ran.

## Registry

Maintain:

`<feed_root>/registry.yaml`

The registry should track at least:

- feed ID;
- feed name;
- title;
- status: active / stopped;
- frequency;
- canonical root;
- optional mirror folders;
- creation date;
- last successful run;
- last canonical snapshot path.

The registry is the main persistent index for locating active feeds across weekly archive folders.

---

# 4A. User-specified mirror folders

A feed may optionally be associated with one or more user-specified folders outside `feed_root`.

These are mirrors, not replacements for the canonical root archive.

When the user specifies an additional folder for a feed:

1. keep writing the canonical copy under `feed_root`;
2. also write the same feed snapshot into the specified folder;
3. record that folder in the feed configuration and registry.

Use the same year/week and feed-directory structure inside the user folder.

Example:

```text
D:/MyProject/
└── literature-feeds/
    ├── feed_year-2026_week-01/
    │   ├── feed-a7K2-human-meg-replay/
    │   │   ├── feed.yaml
    │   │   ├── seen.json
    │   │   ├── report.html
    │   │   ├── report.qmd
    │   │   └── report.md
    │   └── feed-8BcR-working-memory/
    │       └── ...
    └── ...
```

When the user gives a folder directly, create a `literature-feeds/` subdirectory inside it unless the user explicitly designates that folder itself as the literature-feed root.

If multiple feeds use the same user folder, place them under the same:

`feed_year-YYYY_week-WW/`

directory, each with its own:

`feed-XXXX-<name>/`

subdirectory.

The same feed ID must be used in canonical and mirrored locations.

Mirror folders should contain the same weekly `feed.yaml`, `seen.json`, `report.html`, `report.qmd`, and `report.md` snapshots as the canonical archive.

If a mirror write fails, preserve the canonical archive, report the mirror failure, and do not mark the feed run as entirely failed.

---

# 4B. Creating a feed

When the user asks to create a feed:

1. read global settings;
2. ensure `feed_root` exists;
3. generate a unique random four-character alphanumeric feed ID;
4. determine topic and scope;
5. create the persistent feed entry in `registry.yaml`;
6. record any optional user-specified mirror folders;
7. create the current week directory:
   `feed_year-YYYY_week-WW/feed-XXXX-<name>/`;
8. create `feed.yaml`;
9. create `seen.json`;
10. create the first `report.html`, `report.qmd`, and `report.md` when the feed is run;
11. create equivalent mirror paths when requested;
12. report the feed ID, name, canonical path, and mirror paths.

The user should never need to manually copy templates.

---

# 4C. Updating and stopping feeds

When running an existing feed:

1. locate it by feed ID or unique name in `registry.yaml`;
2. load its latest configuration and state;
3. create the current week's canonical directory;
4. run the feed;
5. save the updated weekly snapshot;
6. copy the same snapshot to configured mirror folders;
7. update the registry.

When the user asks to stop a feed:

1. mark it `stopped` in `registry.yaml`;
2. disable future scheduled execution when possible;
3. preserve canonical weekly archives;
4. preserve mirror archives by default.

Do not delete historical feed folders merely because a feed is stopped.

Only erase history when the user explicitly asks to delete it completely.

---

# 5. Feed configuration

Each feed has a persistent YAML configuration.

Required conceptual sections:

- identity
- topic
- scope
- search
- schedule
- ranking
- output
- baseline
- state

Use `feed-template.yaml` as the default structure.

---

# 6. Feed scope

A feed is defined semantically, not only by keywords.

The topic description should state what scientific work belongs in the feed.

Use:

- `include` rules for clearly relevant work;
- `exclude` rules for nearby but unwanted work.

Keywords are search aids, not the final relevance criterion.

Judge relevance using title, abstract, keywords, authors, and public metadata.

---

# 7. Sources

Recent-literature tracking must include preprints.

Search appropriate sources for the field, including when relevant:

- bioRxiv
- medRxiv
- arXiv
- PsyArXiv
- OSF Preprints or relevant OSF-hosted preprints
- Research Square
- SSRN
- journal accepted/in-press pages
- journal online-first / early-view pages
- PubMed
- Europe PMC
- Crossref
- OpenAlex
- Semantic Scholar
- publisher metadata

Preprints and journal publications must be searched together.

Publication status is metadata, not a relevance filter.

Do not systematically privilege journal articles over credible preprints.

---

# 8. Search window

Defaults:

- weekly feed: the most recent completed Friday-to-Friday interval;
- monthly feed: last 30 days;
- manual feed with no specified window: last 14 days.

For weekly feeds, use Europe/Berlin time and define every interval as half-open:

`[Friday 00:00, following Friday 00:00)`

The displayed label may be `4–11 September 2026`, but the ending Friday is an exclusive boundary. The next interval begins at exactly that same boundary. Consecutive weekly windows must therefore cover all time with neither gaps nor duplicated instants.

At or after the scheduled Friday 02:00 run time, use the interval ending at 00:00 that Friday. Before Friday 02:00, a manually requested weekly feed uses the last fully completed interval, ending at 00:00 on the previous Friday. A user-specified fixed interval overrides this calculation, but still record whether its end is inclusive or exclusive.

When recovering from a missed run, cover every unsearched interval from the first uncovered Friday boundary through the latest completed Friday boundary. The search may be executed as one continuous request or in adjacent weekly chunks, but chunks must share boundaries without overlapping.

Avoid gaps between consecutive runs.

Use the feed state to determine the last successful run.

---

# 9. Search strategy

For each run, search using several routes.

## Semantic search

Use:

- primary topic terms;
- synonyms;
- alternative terminology;
- method names;
- theory names;
- population names;
- concepts inherited from the baseline review.

## Researcher/group search

Track named researchers, laboratories, or research lineages in the feed configuration.

## Citation/context search

When a newly found paper appears especially important, use its references, citing context, authors, or related-paper metadata to identify recent work keyword search may miss.

Do not turn each feed run into a full literature review.

Search expansion should remain focused on recent additions.

---

# 10. Literature verification

Literature verification is a hard gate.

Never include a paper solely from model memory, conversational recall, or an unverified search snippet.

Every research item must be confirmed against at least one real scholarly or publisher source before it can:

- enter the feed;
- receive relevance or importance scores;
- appear in the saved report;
- be added to `seen.json`;
- be described as evidence of field progress.

Preferred verification sources include:

- publisher pages;
- Crossref;
- OpenAlex;
- PubMed;
- Europe PMC;
- Semantic Scholar;
- bioRxiv;
- medRxiv;
- arXiv;
- PsyArXiv;
- OSF;
- Research Square;
- SSRN;
- other established scholarly indexes or preprint servers.

For every included item, verify as many of the following as available:

- exact title;
- authors;
- the complete abstract as published;
- author affiliations and the published author-to-affiliation mapping;
- publication/preprint date;
- venue or preprint server;
- DOI;
- PMID;
- OpenAlex ID;
- stable preprint identifier.

For Core or high-priority items, prefer confirmation from two independent metadata sources when practical.

## Abstract verification

Every included paper must have an `Abstract / 摘要原文` block in the saved report. Retrieve the complete abstract from the publisher or preprint record, structured scholarly metadata, JATS/XML, or the paper PDF. Prefer the abstract attached to the exact reported version.

Present the abstract in its original published language and wording. Do not reconstruct it from the research digest, silently correct awkward grammar, or substitute an abstract from another version. Do not translate the full abstract by default; add a clearly labeled translation only when the user requests one. If no abstract is publicly available, retain the block and state `Not publicly available in the sources checked / 所查公开来源未提供`, then name the sources checked in the verification line.

## Author-affiliation verification

Every included paper must have an `Authors and affiliations / 作者与单位` block after the abstract in the saved report.

Actively look for affiliations in the publisher or preprint landing page, structured scholarly metadata, full HTML, JATS/XML, or the paper PDF. Prefer the version attached to the reported paper, because affiliations can change across preprint and journal versions.

Preserve:

- each author's published name;
- numbered, lettered, or symbol-based affiliation markers when supplied;
- the full published affiliation text, including department, institution, city, and country when available;
- the mapping between authors and multiple affiliations.

Do not infer an affiliation from an email domain, an author's current profile, another paper, institutional memory, or the corresponding author's affiliation. Do not silently substitute a current affiliation for the affiliation published on the paper.

The default presentation uses affiliation markers in the byline and an indented numbered list, following standard scholarly article pages:

```markdown
*Author A¹˒², Author B²*

> **Affiliations / 作者单位**  
> ¹ Department..., Institution...  
> ² Institute..., University...
```

Use a compact author-affiliation mapping table only when many overlapping affiliations make the marker format ambiguous. Keep institution and department names in their published language rather than inventing translations.

If the public sources checked do not expose all affiliations, still include the affiliation block. Use `Not publicly available in the sources checked / 所查公开来源未提供` for the missing value and name the sources checked under bibliographic verification. Distinguish partial availability from complete unavailability. Missing public affiliation data does not by itself make an otherwise verified research item unverified.

## Bibliographic verification status

This status refers to whether the research item itself and its bibliographic identity have been verified. It does **not** mean that the paper's scientific claims, numerical results, methodology, or conclusions have been independently validated.

Internally classify candidates as:

- `Verified`
- `Partially verified`
- `Unverified`

Only `Verified` items may enter the formal feed by default.

`Partially verified` items may be mentioned only in a separate verification-warning note when they appear potentially important and additional checking is warranted.

`Unverified` items must not appear as literature findings.

In saved reports, label this field:

`Bibliographic verification:`

Do not use the bare label `Verification:` because it can be misread as scientific validation of the paper's findings.

## Content verification

Do not infer study details from title alone.

The sections:

- What they did
- Main result
- What is new
- Why it matters

must be grounded in an accessible abstract, preprint page, publisher summary, or other reliable public source containing the relevant information.

If only bibliographic metadata is available, say that the result could not be verified and do not invent a summary.

## Never fabricate

Never fabricate or guess:

- papers;
- authors;
- author affiliations or author-affiliation mappings;
- titles;
- venues;
- publication dates;
- identifiers;
- citation counts;
- abstracts;
- methods;
- sample sizes;
- statistical results;
- study conclusions.

If sources disagree, report the discrepancy.

If verification fails, exclude the item from the formal feed.

A shorter verified feed is preferable to a larger feed containing uncertain or hallucinated literature.

---

# 11. Research-item identity and version merging

The unit tracked by the feed is a research item, not a publication record.

A preprint and its later journal article should normally be treated as versions of the same research item.

Prefer a canonical identifier in this order:

1. DOI;
2. stable preprint identifier;
3. PMID/OpenAlex ID or equivalent;
4. normalized title fingerprint when necessary.

Use title, author overlap, abstract similarity, and identifiers to detect version relationships.

Possible feed states:

- New
- Updated
- Newly relevant

## New

The research item has not appeared in this feed before.

## Updated

A previously seen research item has:

- a new preprint version;
- an accepted version;
- an online-first version;
- a journal publication;
- a materially changed abstract/result;
- a correction;
- a withdrawal;
- a retraction.

## Newly relevant

The item existed before but enters the feed for the first time because:

- feed scope changed;
- terminology expanded;
- its relevance was newly recognized.

Do not report a journal version as a completely new study when it is the same underlying work as an earlier preprint.

---

# 12. Persistent state

Each feed maintains a seen-item state file.

The state should record at least:

- canonical ID;
- title;
- first-seen date;
- last-seen date;
- current publication status;
- known versions;
- whether it has already appeared in a feed.

State supports:

- deduplication;
- version tracking;
- missed-run recovery;
- longitudinal monitoring.

Do not use state to suppress important updates.

---

# 13. Relevance score

Rate topical relevance from 0–10.

Question:

**How directly does this work belong to the defined feed?**

Consider:

- topic overlap;
- mechanism overlap;
- population overlap;
- method/paradigm overlap;
- outcome overlap;
- whether it directly addresses the tracked question.

Use high scores for directly relevant work even when the paper is not scientifically important.

---

# 14. Scientific importance score

Rate scientific importance from 0–10 independently of relevance.

Question:

**If the result is correct, how important is this work for the field?**

Evaluate:

## Theoretical importance
Does it change, distinguish, constrain, or overturn an important theory?

## Conceptual novelty
Does it introduce a genuinely new concept, framework, mechanism, or way of organizing the problem?

## Empirical novelty
Does it reveal an important new phenomenon or resolve an important empirical uncertainty?

## Methodological importance
Does it introduce or validate a method that opens new scientific questions?

## Evidential strength
How convincing is the study given the available public information?

Consider when available:

- design quality;
- sample size;
- preregistration;
- directness of evidence;
- robustness;
- alternative explanations.

Do not overstate evidential quality when only an abstract is available.

## Generality
Could the result plausibly generalize across populations, paradigms, methods, species, or conditions?

## Field-impact potential
If correct, is the work likely to change future research priorities, models, or experimental practice?

## Venue quality
Venue may contribute weakly as contextual information.

Venue prestige must never substitute for scientific importance.

A major preprint can receive a high importance score.

A prestigious journal article can receive a modest importance score.

---

# 15. Ranking

Keep relevance and scientific importance separate.

Do not collapse them into a single opaque score.

Default rule:

**High relevance OR high scientific importance → high feed priority.**

When papers are otherwise similar:

1. prioritize the higher maximum of relevance and importance;
2. use the other dimension as a secondary sort;
3. then consider recency and confidence in metadata.

Always show both scores.

---

# 16. Reading priority

Use an advisory reading label.

### P1 — Read
High relevance, high scientific importance, or both.

### P2 — Worth reading
Substantively useful but less urgent.

### P3 — Skim
Relevant incremental work or lower-impact progress worth knowing.

### P4 — Low priority
Within scope but currently low expected reading value.

Do not hide P3 or P4 papers from the complete feed.

---

# 17. Per-paper analysis

For every newly relevant item summarize:

## What they did
1–2 concise sentences.

Describe:

- population/system;
- method;
- manipulation or analysis;
- core question.

## Main result
1–2 concise sentences.

State only what is supported by available public information.

## What is new
One concise sentence.

Distinguish:

- new phenomenon;
- new mechanism;
- new theory;
- new method;
- replication;
- contradiction;
- extension;
- improved evidence.

## Why it matters
One concise sentence explaining broader scientific significance.

Do not merely restate the abstract.

---

# 17A. Search coverage

Every feed run must report search coverage explicitly.

The purpose is to distinguish:

- papers found during the run;
- the completeness of source coverage during that run.

Do not imply that the number of included papers equals the total number of relevant papers published in the period when one or more important sources could not be searched completely.

Classify overall coverage as:

- `Complete` — all configured major sources were searched successfully for the intended window;
- `Partial` — one or more configured sources were unavailable, rate-limited, incomplete, or only partially searched;
- `Limited` — major parts of the intended source set or time window could not be searched reliably.

At the top of every saved report, include:

```text
Search coverage: Complete / Partial / Limited
```

Then list, when useful:

```text
Successful:
- source A
- source B

Limited or failed:
- source C — rate limited
- source D — unavailable
```

Coverage status concerns search completeness, not paper quality.

A `Partial` or `Limited` run may still be successful if verified literature was found and state can be updated safely, but the report must make the coverage limitation visible.

If a source fails after exact candidate verification but broad discovery was incomplete, count that source as limited for discovery coverage.

---

# 18. Weekly/monthly overview

Begin each feed with a brief overview.

Include:

- number of new papers;
- number of updated papers;
- number of newly relevant papers;
- major themes this period;
- notable high-importance developments.

Summarize field-level progress concisely.

Do not infer a major field shift from a single weak study.

---

# 18A. Bilingual report format

By default, saved feed reports must be bilingual in **English and Simplified Chinese**.

The preferred presentation keeps English and Chinese together inside the same indented semantic block, not in separate language sections.

## Translation rules

Do not translate:

- paper titles;
- author names;
- institution and department names in the affiliation table;
- journal names;
- preprint-server names;
- DOI, PMID, OpenAlex ID, preprint IDs, URLs, or other identifiers;
- established proper names when translation would make identification less precise.

Translate or provide bilingual versions of:

- period and progress summaries;
- search-coverage explanations;
- status labels and explanatory metadata;
- What they did;
- Main result;
- What is new;
- Why it matters;
- reading-queue explanations;
- feed notes.

Chinese should be a faithful scientific translation of the English content, not a second independent summary. Preserve uncertainty, caveats, strength of claims, and technical distinctions.

## Preferred editorial layout

Use a restrained single-column HTML reading layout. Follow the information hierarchy common to research-article pages from publishers such as Science and Nature:

`article type and status → title → author byline → basic information → original abstract → affiliations → research digest → verification`

This is a structural reference, not an instruction to copy publisher branding, colors, fonts, or proprietary page design.

Use [report-style.css](report-style.css) as the stable visual stylesheet. It must present the report as the same centered reading region used by the other literature skills: the region's width, padding, and outer gutters respond to the browser width. All tables must remain inside that region and wrap their contents rather than scrolling horizontally.

Prefer tables whenever information can be expressed as stable rows and columns. Use CSS padding and nested labels inside cells to show parent-child hierarchy. Reserve indented prose blocks for content that is not naturally tabular.

```html
<table class="digest">
  <thead><tr><th>Section</th><th>English</th><th>中文</th></tr></thead>
  <tbody>
    <tr><td>What they did / 研究做了什么</td><td>...</td><td>...</td></tr>
  </tbody>
</table>
```

English and Chinese are peer columns. Do not visually subordinate one language to the other.

For each paper, keep the original paper title as a normal Markdown heading above the bilingual analytical blocks:

```markdown
### Original paper title
```

Do **not** add a translated paper title.

Give `What they did`, `Main result`, `What is new`, and `Why it matters` separate rows in one bilingual digest table. Never combine all four fields into one paragraph.

Keep bibliographic metadata in the article-information block near the end of the paper. Identifiers and links should appear only once because they do not need translation.

## Bilingual overview

`Progress this period`, `Reading queue`, and substantive `Feed notes` should use bilingual tables. Tables may contain paragraph-length text when clear column widths, padding, and responsive wrapping preserve readability inside the reading region.

Short machine-like fields such as dates, scores, DOI, and source names do not need duplicated values. Their labels may be bilingual, for example:

- `Status / 状态`
- `Feed status / Feed状态`
- `Relevance / 相关性`
- `Scientific importance / 科学重要性`
- `Reading priority / 阅读优先级`
- `Bibliographic verification / 书目信息核验`

## Fallback

If HTML cannot be rendered, use equivalent Markdown tables. If a long Markdown table becomes unreadable, use paired labeled paragraphs in the same order: `English`, then `中文`. Do not silently omit either language.

---

# 18B. Visual hierarchy and paper boundaries

Every saved report must expose its hierarchy before the prose is read. Use a journal-article-page rhythm: generous separation between papers, a strong title and byline, compact subordinate metadata, then progressively deeper analytical sections.

## Hierarchy rules

- Use one level-one heading for the feed title.
- Use level-two headings for report sections and individual numbered papers.
- Use level-three headings for paper titles and major blocks within a paper.
- Use level-four headings for individual analytical questions.
- Use table-cell padding, nested labels, or one prose indentation level to distinguish child content from its parent heading.
- Keep peer items at the same indentation depth. Never indent merely for decoration.
- Separate the report's major parts with a full-width thick black rule.
- Begin each paper with a thick Science-inspired red rule approximately one third of the content width.
- Use `#c9252d` as the default red accent, near-black text, white background, and subtle warm-gray table cells.
- Do not use blue callouts, blue quote bars, emoji, gradients, or repeated boxed borders.

## Paper record

Each paper is a self-contained editorial record in this order:

1. one-third-width thick red rule;
2. a compact eyebrow line: `PAPER N OF M · PREPRINT/ARTICLE · P1–P4`;
3. `## Paper N of M / 文献 N/M`;
4. original title as a level-three heading;
5. author byline with affiliation markers;
6. a `Basic information / 基本信息` table containing publication status, feed status, date, relevance, scientific importance, reading priority, identifiers, and link;
7. an `Abstract / 摘要原文` prose block containing the complete abstract as published;
8. a plain, non-highlighted author-affiliation mapping table;
9. a bilingual `Research digest / 研究解读` table with one row for each analytical field;
10. a short verification line;
11. generous whitespace before the next paper's red rule.

Do not highlight author names or affiliations with colored fills. The affiliation table may use thin neutral rules, but its header and cells should remain white. Group authors only when they share exactly the same affiliation mapping.

Example:

```text
[one-third-width thick red rule]
PAPER 1 OF 3 · PREPRINT · P1
Original paper title
Author A¹, Author B¹˒², Author C²

[basic-information table]
[original abstract]
[plain author-affiliation table]
[bilingual research-digest table]
[verification line]
```

If there are no papers, retain the major report sections and state the zero result clearly; do not create an empty paper record.

---

# 19. Feed output structure

Use this structure by default, following the editorial hierarchy and indentation rules above.

# [Feed name] — Literature Feed / 文献追踪

---

## Summary / 摘要

Put all of the following inside this single section rather than creating separate `Period` and `Progress this period` sections:

- run date;
- search window;
- search coverage;
- successful and limited sources;
- counts of new, updated, newly relevant, and reverified items;
- concise bilingual progress synthesis;
- the leading development and its principal caveat.

Use a compact key-value table for run, window, coverage, sources, and counts. Use a second bilingual table for substantive progress.

---

## New and updated literature / 新增与更新文献

Repeat the complete paper-record structure from Section 18B for every included item. Preserve the original paper title, published author order, and verified author-affiliation markers.

Within every record, use these headings in order:

1. `Basic information / 基本信息` table;
2. `Abstract / 摘要原文` prose block with the complete original abstract;
3. plain `Authors and affiliations / 作者与单位` table;
4. `Research digest / 研究解读` bilingual table containing separate rows for What they did, Main result, What is new, and Why it matters;
5. bibliographic, abstract, and affiliation-verification line.

## Reading queue / 阅读顺序

Recommend a short reading order in a compact table with columns for order, paper, English rationale, and Chinese rationale.

This is advisory and must not replace the complete literature list.

---

## Feed notes / Feed备注

Use a compact table whenever the notes can be expressed as labeled rows. Reserve indented bilingual prose only for genuinely narrative material that would become less clear in cells.

Include only when useful:

- search gaps not already captured by the Search coverage field;
- source failures or rate limits;
- unusual terminology;
- possible duplicate/version uncertainty;
- important withdrawn or corrected items.

---

# 20. Feed reports

Every successful feed run must save the complete output in the current weekly snapshot:

`<feed_root>/feed_year-YYYY_week-WW/feed-XXXX-<name>/report.html`

Save the fully styled, self-contained HTML report as the primary reading version. Embed the complete contents of [report-style.css](report-style.css) in the file so it previews without network access and stays visually consistent with the other literature skills.

Also save an editable Quarto source for Positron as:

`<feed_root>/feed_year-YYYY_week-WW/feed-XXXX-<name>/report.qmd`

The QMD must contain the same complete report and visual system as `report.html`, not an iframe or a link to the HTML file. Configure it to render a self-contained HTML document with embedded resources. It should preview from Positron's `Preview` action without requiring R or Python execution. Rendering `report.qmd` may replace `report.html`, so make both outputs visually and substantively equivalent.

When the QMD uses indented HTML to express the report hierarchy, wrap the complete report body in a triple-backtick Quarto raw HTML block marked `{=html}`. Otherwise Pandoc can interpret nested four-space-indented elements as code blocks and display table markup literally. After rendering, verify that key tables appear as actual `<table>` elements rather than escaped text inside `<pre><code>`.

Also save a content-equivalent Markdown fallback as:

`<feed_root>/feed_year-YYYY_week-WW/feed-XXXX-<name>/report.md`

Also save the same snapshot to every configured mirror folder.

The conversational response may be shorter.

All saved report formats should contain the complete feed output. The HTML version controls visual presentation, the QMD is the editable Positron-preview source, and the Markdown version prioritizes portability.

---

# 21. Baseline from Skill 1

A feed may inherit context from a previous `scientific-literature-review`.

When a baseline review is supplied, reuse:

- topic definition;
- granularity;
- inclusion/exclusion logic;
- key terminology;
- alternative terminology;
- major theories;
- important researchers/groups;
- core papers;
- known literature up to the baseline date.

Do not rerun the entire baseline review during each feed update.

The feed should focus on what is new since the baseline or last run.

---

# 22. Researcher/group feeds

For a researcher or group feed:

- search the named researcher/group directly;
- track newly appearing work from that lineage;
- also search closely related independent work when relevant;
- distinguish group-authored work from independent replication or contradiction.

Do not equate productivity with scientific importance.

---

# 23. Interaction policy

The skill should be conversational and self-guiding, but must not force interaction at every run.

Use the onboarding and guidance rules in Section 0A.

Ask the user only when input would materially change:

- feed scope;
- inclusion/exclusion rules;
- search terminology;
- researchers/groups watched;
- frequency;
- output behavior.

For routine updates, run autonomously using the saved feed configuration.

During setup:

1. infer the intended feed from natural language;
2. briefly present the proposed interpretation;
3. ask only for important unresolved choices;
4. otherwise proceed using sensible defaults.

When an operation completes, briefly explain what happened and suggest one useful next action.

Natural-language requests should be accepted; users should not have to memorize exact commands.

---

# 24. Feed evolution

A feed may be revised over time.

When the user changes the topic or scope:

- update the configuration;
- preserve prior state;
- mark newly included older work as `Newly relevant`;
- avoid resetting history unless explicitly requested.

Feed configuration is the persistent definition of what to watch.

Seen-item state is the persistent history of what has already been observed.

---

# 25. Stopping a feed

When the user asks to stop a feed:

1. locate it through `registry.yaml`;
2. mark its status as `stopped`;
3. stop future scheduled runs when possible;
4. preserve canonical and mirrored weekly archives.

If the user explicitly asks to erase the feed completely, delete its canonical and mirrored historical directories and remove it from the registry.

---


# 26A. Feed commands

## General help

When the user says things such as:

- `How do I use this?`
- `What can this skill do?`
- `Help me set up literature feeds`
- `What should I do next?`

Give a short capability overview, show a few natural-language examples, and recommend the most relevant next action based on the current registry and conversation.

Do not run a feed unless the user asked to run or update one.


Support the following direct user commands.

## Show my feeds

When the user says:

- `show my feeds`
- `list my feeds`
- `show active feeds`

Read `registry.yaml` and return the active feeds.

For each feed show:

- feed ID;
- name/title;
- topic;
- frequency;
- last successful run;
- canonical location;
- configured mirror folders.

Do not run the feeds when listing them.

If requested, also show stopped feeds separately.

## Run a feed

When the user says:

- `run feed <ID>`
- `run <feed-name>`
- `update feed <ID/name>`

Locate the feed through `registry.yaml` and run it immediately using its saved configuration.

Manual execution must not alter the automatic schedule unless the user explicitly requests a schedule change.



# 26B. Weekly batch runner

Support a single scheduled batch run for all active feeds.

Default batch schedule:

- weekday: Friday
- start time: 02:00
- timezone: Europe/Berlin

The batch runner should:

1. read global settings;
2. load `<feed_root>/registry.yaml`;
3. select feeds with `status: active`;
4. sort them by feed ID using case-sensitive lexicographic order;
5. run feeds sequentially, never concurrently;
6. wait for one feed to finish before starting the next;
7. save each feed's canonical weekly snapshot;
8. write configured mirrors;
9. update registry state after each successful feed;
10. continue to the next feed if one feed fails, while recording the failure.

Do not assign fixed clock times to individual feeds.

The schedule applies to the batch runner only.

The sequence is:

`Friday 02:00 → feed 1 → feed 2 → feed 3 → ...`

A manually triggered feed run does not change its position in the next scheduled batch.

If there are no active feeds, the batch runner should exit without performing searches.

When feeds are created or stopped, the next scheduled batch should automatically use the updated registry without requiring a new schedule.



# 26C. Missed-run recovery

Scheduled feeds must recover automatically from missed runs.

Do not assume that the scheduled Friday 02:00 run always executes.

For every batch run:

1. read each active feed's `last_successful_run`;
2. compare it with the current scheduled cycle;
3. if the current week's scheduled run was missed, perform a catch-up run immediately;
4. search from the first uncovered Friday boundary through the latest completed Friday boundary;
5. update state only after a successful run.

The preferred search interval is therefore a continuous union of the missing half-open Friday-to-Friday windows, never `last_successful_run → now` when that would create a partial or overlapping weekly interval.

Use the configured `window_days` only when:

- no previous successful run exists;
- initializing a new feed;
- the user explicitly requests a fixed recent window.

## Missed-cycle detection

For the default weekly schedule:

- weekday: Friday
- scheduled time: 02:00
- timezone: Europe/Berlin

Treat the current weekly cycle as missed when:

- the current time is later than this week's scheduled Friday 02:00;
- and `last_successful_run` is earlier than this week's scheduled Friday 02:00.

When this condition is detected, run catch-up at the next available batch execution.

Do not wait until the following Friday.

## Long gaps

If several scheduled cycles were missed, search the continuous sequence of complete Friday-to-Friday windows through the latest completed boundary.

Do not run one separate search for every missed week unless necessary for source limitations.

Preserve all newly discovered items and version updates across the whole gap.

## Failure handling

If a feed fails during catch-up:

- do not advance its `last_successful_run`;
- record the failure in the registry or run log;
- continue with the next feed;
- retry the failed feed at the next available batch or manual run.

A feed should never silently lose coverage because the computer or Codex was unavailable at the scheduled time.


# 26. Final principles

Always preserve these distinctions:

- relevance ≠ scientific importance;
- publication venue ≠ scientific importance;
- preprint ≠ low importance;
- novelty ≠ credibility;
- bibliographic verification ≠ scientific validation;
- bilingual translation ≠ independent reinterpretation; preserve the same scientific claim strength in both languages;
- user guidance should reduce friction without interrupting routine autonomous runs;
- one new paper ≠ field consensus;
- journal publication ≠ new underlying research item;
- user reading preference ≠ field importance.

The final goal is:

**Recent research → concise understanding → relevance → scientific importance → reading decision → longitudinal field progress**
