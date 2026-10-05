---
name: scientific-information-extraction
description: Extract one specific source-grounded information unit from a scientific paper, or combine one or more directly relevant information units in a single local inferential step. Designed as a low-cost reusable primitive for scientific-paper-reading and scientific-literature-review. Does not construct whole-paper argument models or cross-paper syntheses.
---

# Scientific Information Extraction

## Goal

Answer one narrowly scoped question about one scientific paper using the minimum source-grounded information necessary.

The skill supports two forms of output:

1. **Single information extraction** — retrieve one specific information unit.
2. **Single-step local inference** — combine one or more directly relevant information units in one inferential operation to obtain one local conclusion.

The skill is intentionally narrower than `scientific-paper-reading` and `scientific-literature-review`.

Core principle:

> **Extract and locally synthesize the minimum source-grounded information needed to answer a specific question, without constructing a multi-step or whole-paper argument model.**

---

# 1. Scope boundary

## 1.1 Allowed reasoning depth

Use an inference-depth budget of **0 or 1**.

### Depth 0 — direct extraction

Return one information unit grounded in the paper.

Examples:

- What is the paper's central research question?
- What did participants do in Experiment 2?
- What was Task A intended to measure?
- Which computational model was fitted?
- What dependent variable was analyzed?
- What result was reported for condition X versus Y?
- What limitation did the authors explicitly acknowledge?

Abstract form:

**A**

### Depth 1 — one local inferential operation

Combine one or more directly relevant information units to obtain one local conclusion.

Allowed forms include:

**A → C**

**A + B → C**

**A + B + D → C**

Examples:

- manipulation + observed effect → what hypothesis this experiment tests;
- result + control result → which alternative explanation is weakened;
- model fit + model recovery → what can reasonably be concluded about the model comparison;
- behavioral effect + neural result → what local interpretation the combined evidence supports;
- result + authors' stated interpretation → where the inferential step lies.

The number of direct inputs is not itself the boundary. The boundary is the number of inferential steps.

## 1.2 Not allowed by default

Do not construct multi-step chains such as:

**A + B → C; C + D → E**

Do not answer questions that require a global representation of the paper, such as:

- What is this paper about?
- What is the paper's overall argument?
- How do all experiments jointly establish the main theory?
- What is the paper's overall scientific contribution?
- Is the paper convincing overall?
- How strong is the complete evidence base for the paper's central claim?

These belong to `scientific-paper-reading`.

Do not synthesize across multiple papers, assess replication structure across papers, assign review-level evidence strength, or resolve literature-wide conflicts. These belong to `scientific-literature-review`.

---

# 2. Question eligibility

Before extraction, determine whether the requested question fits this skill.

A suitable question should normally have:

- one clearly identifiable target;
- a bounded information need;
- an answer that can be grounded in one paper;
- inference depth 0 or 1;
- no need to reconstruct the paper's complete argument.

A question may require several local sections, figures, tables, or supplementary passages and still qualify, provided all retrieved information feeds one direct answer or one local inferential operation.

Do not use paragraph count as the boundary. Use inferential structure.

If the user asks a broad whole-paper question, delegate to `scientific-paper-reading` rather than expanding this skill until it becomes a paper summary.

If the user asks a cross-paper question, delegate to `scientific-literature-review`.

---

# 3. Source discipline

Use the paper itself as the evidential source.

Preserve the distinction between:

- reported procedure;
- observed result;
- statistical or computational analysis;
- authors' interpretation;
- the skill's own one-step inference.

Do not silently convert authors' interpretation into direct evidence.

Do not infer missing procedures from field conventions.

Do not infer stronger causal or mechanistic claims than the design supports.

Do not fill unavailable details from general knowledge unless the user explicitly requests outside context. If outside context is used, label it separately from paper-derived information.

---

# 4. Progressive source acquisition

Use the lowest source depth sufficient to answer the question reliably.

Source-depth levels:

1. `metadata`
2. `abstract`
3. `partial-text`
4. `full-text`

## 4.1 Metadata

Use for bibliographic or simple structural questions when sufficient.

Examples:

- publication year;
- venue;
- author list;
- identifier;
- article type when explicitly available.

## 4.2 Abstract

Use when the requested information is explicitly stated in the abstract and no finer-grained verification is required.

Do not use abstract-only evidence to invent methodological, statistical, or inferential detail that the abstract does not provide.

## 4.3 Partial text

This is the normal targeted-extraction mode when full paper text is accessible.

Search for and inspect only the sections needed to answer the current question.

Possible targets include:

- relevant Introduction paragraph;
- Methods subsection;
- specific experiment;
- Results subsection;
- model description;
- figure/table caption;
- Discussion paragraph;
- supplementary section.

Do not read the entire paper merely because full text is available.

## 4.4 Full text

`full-text` means the answer has been checked against the available full paper, not that the entire paper must be deeply read.

Use broader reading only when the target question genuinely requires multiple relevant locations within the paper.

Full-text access does not imply `scientific-paper-reading`.

---

# 5. When full text is unavailable

Lack of full text does not automatically block extraction.

Use the best accessible source and lower `source_depth` accordingly.

When useful, look for lawful accessible versions such as:

- publisher open-access copy;
- PubMed Central / Europe PMC;
- preprint;
- institutional repository;
- author-accepted manuscript;
- other legitimate public full-text source.

If the available source is insufficient to answer the question reliably:

- do not guess;
- state what can be answered;
- state what cannot be verified;
- record the limitation explicitly.

---

# 6. Extraction procedure

For each request:

1. **Identify the target question.**
2. **Classify inference depth** as 0 or 1.
3. **Determine the minimum required source depth.**
4. **Locate only the relevant parts of the paper.**
5. **Extract the directly relevant information units.**
6. **If depth 1, perform exactly one local inferential operation.**
7. **Record source locations and source depth.**
8. **State limitations or uncertainty when material.**
9. **Stop once the question is answered.**

Do not continue reading merely because additional related information is available.

---

# 7. Standard output schema

Return one `InformationExtractionResult` with six fields.

```text
InformationExtractionResult
- answer
- evidence[]
- source_locations[]
- source_depth
- inference
- limitations
```

## 7.1 `answer`

The direct answer to the target question.

It should be concise, specific, and usable by an upper-level skill without further rewriting when possible.

## 7.2 `evidence[]`

One or more directly relevant source-grounded information units supporting the answer.

Each evidence item should preserve its role where useful, for example:

- procedure;
- result;
- control;
- model comparison;
- author interpretation;
- stated limitation.

For depth 0, `evidence[]` usually contains the extracted information itself or its immediate support.

For depth 1, `evidence[]` contains the direct inputs to the inference.

## 7.3 `source_locations[]`

Record where the relevant information was found.

Examples:

- Abstract
- Introduction, final paragraph
- Methods, Experiment 2
- Results §3.2
- Figure 3
- Table 2
- Supplementary Methods §S4
- PDF p. 7

Use the most precise location available without inventing section names or page numbers.

## 7.4 `source_depth`

Use exactly one of:

- `metadata`
- `abstract`
- `partial-text`
- `full-text`

This field is mandatory.

## 7.5 `inference`

For depth 0, leave empty or state `none`.

For depth 1, explicitly show the single inferential operation.

Preferred compact form:

**A + B → C**

The inference must be distinguishable from what the authors explicitly state.

## 7.6 `limitations`

State any important limit on the answer.

Examples:

- abstract does not report the comparison metric;
- the procedure is incompletely described;
- the result supports but does not uniquely identify the proposed mechanism;
- the available source does not include the supplement;
- the paper does not test the relevant alternative explanation.

If there is no material limitation, this field may be empty or `none identified for this extraction`.

---

# 8. Output style

The default output should be compact.

Do not generate a report, QMD file, HTML page, or broad narrative summary.

Do not use long prose when a short structured answer is sufficient.

A normal depth-0 answer may look like:

```text
answer: Participants completed 120 binary risky choices.
evidence:
  - The Methods section specifies 120 two-option trials.
source_locations:
  - Methods, Task
source_depth: full-text
inference: none
limitations: none identified for this extraction
```

A normal depth-1 answer may look like:

```text
answer: The control analysis weakens the explanation that the main effect was caused only by task difficulty.
evidence:
  - The main experimental manipulation produced the target behavioral effect.
  - The difficulty-matched control did not reproduce that effect.
source_locations:
  - Results, main analysis
  - Results, control analysis
source_depth: full-text
inference: Main effect + difficulty-matched control → task difficulty alone is unlikely to explain the effect.
limitations: The control does not exclude all alternative explanations.
```

---

# 9. Scientific interpretation rules

## 9.1 Result versus interpretation

When a paper states that a result demonstrates a mechanism, separate:

1. what was observed;
2. what the authors infer;
3. what a one-step local inference can support;
4. what remains underdetermined.

## 9.2 Model fit

Do not treat better model fit alone as proof of the model's psychological, biological, or causal mechanism.

## 9.3 Null results

Do not translate a non-significant result into evidence of absence unless the design and analysis support that interpretation.

## 9.4 Controls

State precisely what a control weakens or rules out. Do not claim a control excludes alternatives it was not designed to test.

## 9.5 Causal language

Preserve the causal strength supported by the design.

---

# 10. Relationship to scientific-paper-reading

`scientific-paper-reading` builds a global understanding of one paper.

This skill provides local source-grounded information to it.

Recommended discussion flow:

**user question → current paper summary sufficient? → yes: answer directly → no: call scientific-information-extraction → answer → update working understanding if necessary**

Typical paper-reading calls include:

- extract the procedure of Experiment 2;
- determine what Task A measures;
- extract how model parameters were estimated;
- extract the result underlying one summary-table row;
- determine whether a control weakens a specific alternative explanation.

Do not replace the initial whole-paper synthesis of `scientific-paper-reading` with one giant extraction request such as "What is this paper about?".

---

# 11. Relationship to scientific-literature-review

`scientific-literature-review` synthesizes information across papers according to a review question.

This skill should be used when abstract or bibliographic information is insufficient to extract a review-relevant item from one paper.

The literature review should formulate a narrow paper-specific question, for example:

- Which risk model was used in this study?
- How was probability weighting parameterized?
- Did the paper directly compare CPT with expected utility?
- What population and task support this review-relevant claim?
- What result supports or challenges claim X?

The extraction result can then be incorporated into the review's higher-level synthesis.

This skill does **not**:

- assign review-wide evidence levels;
- determine independent replication;
- score cross-paper conflict;
- decide the overall state of a literature;
- treat the paper's own headline conclusion as automatically review-relevant.

Relevance is defined by the calling review question.

---

# 12. Efficiency rules

Optimize for information gained per token.

1. Never default to whole-paper rereading.
2. Search within the paper before reading broadly.
3. Read only the sections necessary for the current target.
4. Stop after the answer and its immediate support are established.
5. Reuse already extracted information when the same paper and question recur.
6. Do not regenerate information already available at sufficient source depth.
7. Escalate source depth only when the current source cannot answer reliably.
8. Do not use `scientific-paper-reading` merely to answer one bounded local question.

---

# 13. Failure and delegation

Delegate to `scientific-paper-reading` when the question requires:

- a whole-paper summary;
- the complete experiment-to-conclusion structure;
- multi-step inferential chains;
- overall contribution or argument assessment;
- global paper-level interpretation.

Delegate to `scientific-literature-review` when the question requires:

- comparison across papers;
- field-level novelty verification;
- replication assessment;
- evidence strength across research groups;
- literature-wide conflict resolution;
- current state of evidence.

If neither source material nor accessible public information supports the requested extraction, return an unresolved result rather than guessing.

---

# 14. Final mental model

The skill answers:

**What specific information does this paper provide for question Q?**

or, at most:

**Given directly relevant information A + B + ..., what single local conclusion C follows?**

The skill does not answer:

**How does the whole paper fit together?**

and does not answer:

**What does the literature as a whole support?**
