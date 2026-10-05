---
name: scientific-paper-reading
description: Read a scientific paper by combining targeted scientific-information-extraction with whole-paper synthesis, generate a compact but evidence-complete research summary, and support efficient interactive discussion. Use the summary first; when local detail is missing, call scientific-information-extraction rather than broadly rereading the paper. External literature verification remains optional and requires user confirmation.
---

# Scientific Paper Reading

## Goal

Build a compact, accurate, research-oriented understanding of one scientific paper.

The workflow is:

**Paper → targeted information extraction → structured understanding → summary → user discussion → refined understanding**

The summary is the main human-readable representation of the paper.

Subsequent discussion should use the summary as the default knowledge base and return to the original paper only when the summary is insufficient, ambiguous, or needs correction.

Do not organize the workflow as a generic "chat with PDF" system.

---

# 1. Core operating model

The skill has two primary functions:

1. **Read and summarize the paper**
2. **Discuss the paper interactively with the user**

The initial summary should be good enough that the user can understand the paper mainly through the summary, then ask for details as needed.

During discussion:

- use the summary first;
- when the summary is insufficient, formulate one narrow local question and use `scientific-information-extraction`;
- inspect broader original text only when the question exceeds extraction depth 0–1 or a global paper-level synthesis must be revised;
- do not repeatedly re-read the entire paper;
- update the working understanding when discussion materially changes the interpretation;
- do not automatically regenerate the visible summary after every discussion.

The summary is the persistent human-facing representation.

The working understanding may be richer than the visible summary.

---

# 2. Source discipline

Base the initial summary on the paper itself.

Preserve the paper's terminology, experimental structure, and distinction between:

- data;
- analysis;
- authors' interpretation;
- broader claims.

Do not silently fill missing information from general knowledge.

If an important detail is unavailable or ambiguous in the paper, state that clearly.

Do not infer:

- experimental procedures not described by the paper;
- stronger causal claims than the design supports;
- model mechanisms from fit alone;
- field-level novelty from the paper's own assertion alone.

## Information-extraction dependency

Use `scientific-information-extraction` as the default low-level retrieval primitive whenever one local question can be answered by:

- one source-grounded information unit; or
- one inferential operation of the form `A -> C` or `A + B + ... -> C`.

Examples include:

- the purpose of one experiment;
- one task procedure;
- one model-fitting detail;
- one result;
- one stated limitation;
- whether one result plus one control weakens a specific alternative explanation.

Do not use information extraction to answer whole-paper questions that require multi-step argument reconstruction. Those remain the responsibility of this skill.

---

# 2A. Building the initial summary efficiently

The initial `read` workflow still constructs a global representation of the paper, but it should avoid indiscriminate repeated full-text reading.

Use this sequence:

1. **Structural scan** — identify the paper's sections, experiments/analyses, figures/tables, and overall organization.
2. **Extraction plan** — determine the local information units needed for the four-part summary.
3. **Targeted extraction** — use `scientific-information-extraction` for local fields such as research question, task flow, method, result, stated interpretation, limitation, and field-position claims.
4. **Whole-paper synthesis** — connect those local units into the paper's global experimental logic and argument.
5. **Consistency check** — verify that no substantive experiment, conflicting result, or important control has been omitted.

The extraction layer supplies local source-grounded information. This skill remains responsible for:

- deciding which local questions must be asked;
- reconstructing multi-step experiment-to-conclusion chains;
- deciding how experiments relate to one another;
- producing the coherent four-part summary.

Do not mechanically issue one extraction call for every sentence. Batch closely related local fields when they remain within the extraction skill's depth-0/1 boundary.

---

# 3. Default summary structure

The default summary has four sections.

The second section is the core of the report and should usually receive the most space.

## 1. Problem and theoretical framing

Explain:

- What is the central research problem?
- Why is this problem important according to the paper?
- What theoretical or conceptual framework do the authors use to formulate the problem?

Keep this section compact.

Distinguish clearly between:

- the scientific problem;
- the authors' motivation;
- the theoretical framework;
- author-stated novelty or importance.

Do not independently endorse claims such as:

- "this is the first study";
- "little is known";
- "this is a major unresolved problem";
- "this changes the field";

unless they have been externally verified.

When no external verification has been performed, describe them as author-stated claims.

---

## 2. Solution, experiments, and evidence

This is the most important part of the summary.

First give a short overview of the paper's overall strategy.

Then summarize the substantive experiments, analyses, models, simulations, and important control results in a table.

Use this default structure:

| Experiment / Analysis | Question | Procedure / Task flow | Method / Analysis | Result | Interpretation |
|---|---|---|---|---|---|

### Coverage principle

Aim to include **all substantive results that materially contribute to the paper's argument**.

Completeness is more important than extreme brevity.

Include when relevant:

- main experiments;
- follow-up experiments;
- behavioral analyses;
- neural analyses;
- computational models;
- model comparison;
- simulations;
- robustness analyses;
- important control analyses;
- important supplementary results.

Omit only results that are:

- purely procedural;
- redundant;
- scientifically uninformative for the paper's argument.

Do not reduce a multi-experiment paper to only a few "key findings" if doing so loses the actual experimental logic.

### Experiment / Analysis

Use the paper's own labels where useful:

- Experiment 1;
- Study 2;
- Model comparison;
- fMRI analysis;
- Supplementary analysis.

Keep distinct experiments distinct even when they use similar procedures.

### Question

State the specific question, hypothesis, or inferential purpose of the experiment or analysis.

The reader should understand why this experiment exists.

### Procedure / Task flow

This field is especially important.

Briefly reconstruct what participants, animals, systems, or models actually did.

For human or animal experiments, describe the major steps in chronological order.

For each major task, manipulation, or stage, explain its purpose.

The description should answer:

1. **What did they do?**
2. **What was each task or manipulation for?**

For example:

> Participants first completed a belief-estimation task to measure first-order beliefs, then played a strategic choice task in which opponent information was manipulated. The first task measured the latent belief variable; the second tested whether it affected strategic choice.

The procedure should be concise but logically complete enough that the experimental logic can be reconstructed from the summary alone.

Do not normally include low-level implementation details such as:

- button mappings;
- font sizes;
- every timing parameter;
- minor stimulus details;

unless they are scientifically relevant.

### Method / Analysis

Include the minimum methodological information required to understand how the result was obtained.

Depending on the study, this may include:

- sample structure;
- manipulation;
- dependent variable;
- statistical model;
- computational model;
- fitting method;
- imaging analysis;
- decoding method;
- model comparison criterion;
- simulation design.

Avoid vague labels such as "statistical analysis" when the analysis type matters.

### Result

State what the experiment or analysis actually found.

Prefer scientifically interpretable results over lists of test statistics.

Include when important:

- direction of effects;
- comparisons between conditions;
- interactions;
- null results;
- model-performance differences;
- effect magnitude;
- uncertainty;
- relevant quantitative values.

Do not write only:

- "a significant effect was found";
- "the model fit was better";
- "the hypothesis was supported".

State what changed, differed, predicted, or failed to differ.

### Interpretation

Explain what the result contributes to the argument.

Distinguish:

- what the data directly show;
- what the authors infer;
- what remains underdetermined.

Use careful formulations such as:

- supports;
- is consistent with;
- weakens an alternative;
- provides evidence against;
- does not distinguish between;
- is necessary but not sufficient for;
- cannot establish.

The goal is to make the evidence chain explicit:

**experiment → result → conclusion**

### Self-contained rows

Every row should be understandable on its own.

Avoid:

- "same as Experiment 1";
- "similar method";
- "again significant";
- "same conclusion".

Repeat the minimum information necessary for independent readability.

---

## 3. Position in the field

Explain where the paper sits in the broader research framework.

Address:

- What prior framework or unresolved problem does the paper start from?
- What gap does the paper claim to address?
- What does the paper add relative to the work it discusses?
- Is the contribution mainly:
  - a new phenomenon;
  - a new theory;
  - a new model;
  - a new method;
  - a new dataset;
  - a new experimental test;
  - stronger evidence;
  - a boundary condition;
  - a contradiction;
  - an extension?

By default, this section is based on the paper's own account of the literature.

Clearly distinguish:

- author-stated novelty;
- author-stated importance;
- author-stated gap;

from independently verified field-level conclusions.

Do not automatically run an external literature search.

When useful, end with one concise positioning sentence, for example:

> This paper extends framework X by testing Y under condition Z.

---

## 4. Limitations and future directions

Keep this section focused.

### Authors' stated limitations

Summarize limitations explicitly acknowledged by the authors.

### Additional limitations

Add only limitations that follow reasonably from:

- the study design;
- the analysis;
- the evidence;
- the inferential gap.

Do not invent speculative criticism merely to populate the section.

### Future directions

Identify natural next questions arising from the paper.

Examples:

- distinguish competing explanations;
- test generalization;
- manipulate a latent mechanism directly;
- improve model identification;
- use a new population or context;
- add process-level measures;
- add neural or causal evidence;
- test robustness across tasks.

---

# 4. Interactive discussion

After the initial summary, support free-form scientific discussion.

Typical questions include:

- What exactly did participants do in Experiment 2?
- What was Task A measuring?
- Why did the authors include this control condition?
- How was the model fitted?
- What does this interaction mean?
- Does Result 3 really support the main claim?
- Could a simpler explanation produce the same finding?
- How do Experiments 1 and 2 differ?
- What is the meaning of a technical term?
- How does this paper relate to another paper or theory?

## Discussion priority

For every question:

1. answer from the current summary if possible;
2. if the missing information is local and has inference depth 0 or 1, use `scientific-information-extraction`;
3. if the question requires a multi-step or whole-paper argument, synthesize from the working understanding and inspect broader source material only as needed;
4. correct or refine the current understanding if necessary.

The experimental table should serve as the main index for later discussion.

Procedure and task-flow questions should be especially easy to answer from the summary.

---

# 5. Updating the understanding

Discussion may materially change the interpretation of the paper.

Examples:

- the initial summary overstated what a result establishes;
- a control analysis changes the interpretation;
- an experiment was misunderstood;
- a claimed mechanism is not uniquely identified;
- two experiments serve different purposes than initially summarized.

When this happens:

- update the working understanding;
- preserve the corrected interpretation for later discussion;
- do not automatically display a complete new summary.

Ordinary explanatory questions should not count as a revision.

Examples that normally do not require an update:

- defining a term;
- explaining a statistical method;
- restating a procedure more slowly;
- translating a sentence.

Regenerate the visible summary only when:

- the user explicitly asks for an updated summary;
- the accumulated revisions materially alter the overall interpretation and an updated summary would clearly help;
- the user asks to export or save the final understanding.

---

# 6. External literature verification

The default workflow is **paper-internal**.

Do not automatically verify the paper's field-level claims.

This includes:

- "first demonstration";
- "no previous study";
- "little is known";
- "major unresolved problem";
- "dominant theory";
- "long-standing controversy";
- "this resolves the controversy";
- "this is an important gap";
- "this changes the field".

## Trigger conditions

Only consider external verification when:

1. the user explicitly asks whether a field-level claim is true; or
2. the user expresses doubt about a specific novelty, importance, prior-literature, or field-position claim.

Examples:

- "I doubt this is really the first study."
- "Is this gap actually real?"
- "They say nobody has tested this before. Is that true?"
- "Is this result actually important in the field?"
- "Can you check whether this claim is oversold?"

## Confirmation requirement

External verification may be substantially more expensive than reading one paper.

Before launching it, explicitly ask the user for confirmation.

Example:

> The authors claim this is the first demonstration of X. Verifying that requires checking the external literature. Do you want me to run a focused literature review on this specific claim?

Do not launch the search automatically.

## Verification scope

When confirmed:

1. formulate the exact claim;
2. invoke or follow the `scientific-literature-review` workflow;
3. perform a **focused claim-level search**, not a full review by default;
4. look for:
   - earlier work;
   - supporting evidence;
   - contradictory evidence;
   - related but non-identical precedents;
5. report whether the claim is:
   - supported;
   - qualified;
   - overstated;
   - contradicted;
   - unresolved;
6. update the field-position understanding if appropriate.

Keep source-derived paper interpretation separate from externally verified literature conclusions.

---

# 7. Output files

The canonical report output is a `.qmd` file.

The `.qmd` file is the single source of truth for the visible report.

Do not generate a duplicate `.md` file by default.

After the QMD report is complete, ask the user whether they also want an `.html` reading version.

- If the user wants HTML and Quarto is available, render the QMD locally.
- If the user wants HTML but Quarto is unavailable, generate a standalone HTML file that is content-equivalent to the QMD.
- Do not generate HTML automatically unless the user requests it for the current report.

Local Quarto rendering does not require the language model to rewrite the report content.

Before creating or substantially reformatting a report, read [REPORT-FORMAT.md](REPORT-FORMAT.md).

Use [report-style.css](report-style.css) as the stable visual stylesheet.

---

# 8. QMD requirements

The QMD should:

- contain the report content directly;
- render without requiring R or Python execution;
- not embed an existing HTML file through an iframe;
- use the provided stylesheet;
- preserve tables as editable source;
- remain readable as plain text.

Recommended front matter:

```yaml
---
pagetitle: "Paper Summary"
format:
  html:
    embed-resources: true
    theme: none
    page-layout: article
    css: report-style.css
execute:
  enabled: false
---
```

Adapt title and metadata to the current paper.

Write the visible title as an H1 after the kicker. Use `pagetitle` for browser
metadata rather than relying on Quarto's generated title block. Do not rely on
Quarto to create a `main` container when `theme: none`; the shared stylesheet
therefore presents `body` as the same centered, browser-responsive reading
region used by the other literature skills. Tables must fit this region and
wrap their contents instead of scrolling horizontally.

---

# 9. Accuracy requirements

Prioritize accurate reconstruction over fluent compression.

Do not:

- merge distinct experiments because they appear similar;
- infer procedures from domain conventions;
- turn correlation into causation;
- turn model fit into mechanism;
- turn author interpretation into direct evidence;
- hide important null or conflicting results;
- omit an experiment because it complicates the narrative;
- summarize only the abstract when the full paper is available.

When evidence is ambiguous, state the ambiguity.

When multiple interpretations remain possible, preserve them.

When the summary is uncertain, make the uncertainty explicit.

---

# 10. Writing style

The report should be:

- concise;
- research-oriented;
- structurally clear;
- information-dense;
- accurate;
- easy to query later.

Avoid:

- long rhetorical introductions;
- generic background;
- section-by-section paraphrase;
- excessive statistical detail;
- decorative prose;
- abstract-like repetition.

The experiment/evidence table may be substantially longer than the other sections.

This is intentional.

The report should optimize for:

**later scientific discussion, accurate recall, and reconstruction of experimental logic.**

---

# 11. Operating modes

## `read`

Build the default four-part summary using a structural scan, targeted `scientific-information-extraction`, and whole-paper synthesis.

## `discuss`

Answer from the current summary first. When a local detail is missing, call `scientific-information-extraction`; broaden to paper-level synthesis only when the question exceeds one inferential step.

## `update`

Revise the working understanding when discussion materially changes the interpretation, without necessarily displaying a new full summary.

## `show-summary`

Display the current summary.

## `refresh-summary`

Regenerate the summary from the current working understanding.

## `verify-claim`

Prepare a focused external-literature verification of a specific field-level claim.

Before performing the external search, obtain explicit user confirmation.

---

# 12. Final mental model

The normal workflow is:

**paper  
→ structural scan  
→ targeted information extraction  
→ whole-paper structured understanding  
→ QMD summary  
→ summary-first discussion  
→ targeted re-extraction when needed  
→ deeper understanding  
→ optional summary revision**

The heavier verification workflow is separate:

**questioned field-level claim  
→ ask user for confirmation  
→ focused scientific-literature-review  
→ external verification  
→ revised field-position understanding**
