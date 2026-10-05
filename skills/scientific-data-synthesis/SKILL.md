---
name: scientific-data-synthesis
description: Companion skill for scientific-literature-review. Given an existing review and a user-specified target variable or measurement family, extract comparable data from reviewed papers, harmonize only when transformations are deterministic and fully supported, and produce reproducible cross-study tables and figures. This skill does not perform formal meta-analysis or replace literature-review synthesis.
---

# Scientific Data Synthesis

## Goal

Given an existing scientific literature review and a specific user-defined measurement target, construct a transparent cross-study dataset from the reviewed literature and visualize it.

The normal workflow is:

**existing literature review → define target variable → identify eligible papers/samples → extract reported data → harmonize deterministically → save plotting table → generate figure**

This skill is primarily intended to interact with `scientific-literature-review`.

It may call or follow `scientific-information-extraction` to retrieve paper-level values, but it does not replace literature review or paper reading.

---

# 1. Scope and boundary

Use this skill when all of the following are true:

1. an existing literature review, review report, or stable paper set exists;
2. the user specifies a target variable, measure, parameter, distribution, or relationship;
3. the goal is to compare, aggregate descriptively, tabulate, or visualize data across papers.

Typical requests:

- collect first-round mean guesses and SDs across beauty-contest studies;
- compare model parameters reported across papers;
- plot reaction-time means by condition across studies;
- combine reported category frequencies;
- collect participant-level or trial-level observations when publicly reported or supplied;
- plot a target outcome across rounds, doses, conditions, or task parameters;
- compare reported correlations or slopes across studies.

Do not use this skill for:

- finding the literature from scratch;
- deciding the overall scientific conclusion of a literature;
- rebuilding a whole-paper argument;
- answering one local question about one paper when no cross-paper synthesis is needed;
- formal fixed-effect or random-effects meta-analysis;
- pooled effect-size inference;
- meta-regression;
- publication-bias testing.

Delegate those tasks to the appropriate higher-level or specialized workflow.

---

# 2. Core principle

One data-synthesis task should target **one construct or tightly related measurement family**.

Examples of valid targets:

- first-round choice in beauty-contest games;
- reaction time under a defined condition;
- fitted inverse-temperature parameter;
- reported accuracy;
- model-comparison score;
- correlation between two predefined variables;
- participant-level choices in one task family.

If the request asks for many unrelated behaviors, model parameters, neural measures, and outcomes at once, split it into separate synthesis tasks.

---

# 3. Relationship to other skills

## `scientific-literature-review`

The literature review owns:

- review question;
- scope;
- inclusion logic;
- paper set;
- paper relevance;
- bibliographic verification;
- conceptual synthesis;
- evidence assessment;
- search expansion.

This skill should reuse that state rather than redo the literature search.

If the current review is clearly missing papers needed for the requested data synthesis, return the search need to `scientific-literature-review`.

Do not silently expand the literature independently.

## `scientific-information-extraction`

Information extraction owns paper-level retrieval:

- reported values;
- reported sample sizes;
- reported dispersion or uncertainty;
- condition labels;
- measurement definitions;
- source locations;
- source depth;
- local one-step inference when explicitly needed.

This skill owns:

- deciding which variables to collect;
- deciding which papers/samples are eligible;
- aligning records across papers;
- deterministic harmonization;
- missing-data handling;
- cross-study table construction;
- figure construction.

---

# 4. Supported synthesis types

## 4.1 Point-estimate synthesis

Supported examples:

- mean;
- median;
- proportion;
- rate;
- accuracy;
- model parameter estimate;
- model score;
- correlation;
- regression coefficient;
- slope;
- other single-number summaries.

Output normally includes a paper/sample-level table and an appropriate point-based figure.

## 4.2 Dispersion or uncertainty synthesis

Supported examples:

- SD;
- variance;
- SE;
- confidence interval;
- credible/posterior interval;
- IQR;
- range.

These values usually accompany a point estimate.

Do not convert one uncertainty type into another unless the conversion is deterministic and all required inputs are available.

## 4.3 Distribution synthesis

Supported examples:

- quantiles;
- histogram/bin counts;
- frequency tables;
- empirical distributions;
- category frequencies.

Do not reconstruct an unreported distribution from summary statistics.

## 4.4 Observation-level synthesis

Supported when the paper, supplement, repository, or user-provided source contains:

- participant-level observations;
- trial-level data;
- item-level data;
- group-level raw observations.

These records may support scatter, strip, trajectory, or distribution plots.

Do not fabricate raw observations from means, variances, quantiles, or fitted models.

## 4.5 Condition or trajectory synthesis

Supported when one target measure is reported across:

- rounds;
- time points;
- dose levels;
- task conditions;
- difficulty levels;
- age groups;
- model/task parameters;
- other ordered or categorical conditions.

## 4.6 Relationship synthesis

Supported examples:

- correlation;
- regression coefficient;
- slope;
- paired x-y observations;
- parameter-behavior relationships.

This skill may display the reported relationships descriptively.

Do not perform formal pooled meta-regression by default.

## 4.7 Derived-data synthesis

Transparent deterministic transformations are allowed when all required inputs are available and the transformation is scientifically appropriate.

Examples:

- variance → SD using sqrt(variance);
- SE + N → SD when the reported SE definition is standard and the corresponding N is known;
- proportion → percentage;
- 0–1 scale → 0–100 scale;
- a clearly defined difference from baseline;
- another exact unit conversion.

Always preserve both the originally reported value and the derived/harmonized value.

---

# 5. Data integrity and missingness

This is a hard constraint.

**Never infer, impute, reconstruct, or approximate an unreported quantity unless it is deterministically derivable from reported information with all required inputs available. Otherwise, treat it as missing.**

Examples:

- variance reported, N missing → SE is missing;
- mean and SD reported, raw data absent → raw observations are missing;
- CI reported but confidence level or CI definition is unclear → do not convert to SE;
- median and IQR reported → do not assume mean and SD;
- sample size reported for the study but condition-specific allocation is unclear → do not assign N to conditions;
- graph appears to show a value but no reliable numerical value is available → treat the numeric value as missing unless an explicit digitization workflow is available and used.

Missingness must remain visible.

Use a field such as:

`missing_reason`

Examples:

- `sample size not reported`;
- `dispersion not reported`;
- `condition-specific N unclear`;
- `raw observations unavailable`;
- `statistic type ambiguous`.

Never fill missing values merely to make a table or figure complete.

---

# 6. DataRecord

Use a structured record for each paper/sample/condition/statistic.

Minimum recommended fields:

```text
DataRecord
- paper_id
- paper_title
- sample_or_experiment
- population
- condition
- target_variable
- measurement_definition
- statistic_type
- reported_value
- reported_unit
- dispersion_type
- dispersion_value
- sample_size
- derived_value
- harmonized_value
- harmonized_unit
- transformation
- source_location
- source_depth
- missing_reason
- notes
```

Not every field must be populated.

Keep missing fields explicitly missing rather than inventing values.

For observation-level data, add fields such as:

```text
- observation_id
- participant_id_or_source_id
- trial_or_item
- x_value
- y_value
```

only when the source actually provides them.

---

# 7. Source discipline

Prefer the lowest sufficient source depth, but do not sacrifice correctness.

Possible source depths:

- metadata;
- abstract;
- partial-text;
- full-text;
- supplement;
- repository/raw-data file;
- user-provided data.

For numeric synthesis, abstract-only values are acceptable only when the abstract directly reports the required statistic and relevant conditions clearly enough.

If more detail is needed, use targeted extraction rather than full-paper rereading.

Record:

- exact source location when available;
- source depth;
- whether the value is directly reported or derived.

---

# 8. Eligibility and comparability

Before combining values into one table or figure, define eligibility criteria for the current synthesis task.

Examples:

- task version;
- population;
- round;
- condition;
- model parameterization;
- stimulus range;
- p parameter;
- outcome definition;
- measurement unit;
- analysis population.

Do not treat superficially similar values as equivalent when their definitions differ materially.

When records are not directly comparable:

- preserve them in the dataset when useful;
- mark the comparability issue;
- separate them into panels/groups or exclude them from a specific figure with an explicit reason.

Do not silently normalize away substantive design differences.

---

# 9. Harmonization

Harmonization is allowed only when it is transparent and justified.

For every transformed value preserve:

```text
reported_value
reported_unit
transformation
harmonized_value
harmonized_unit
```

Examples of acceptable transformations:

```text
variance = 25
transformation = sqrt(variance)
harmonized_value = 5
harmonized_unit = SD
```

or:

```text
reported_value = 0.36
reported_unit = proportion
transformation = ×100
harmonized_value = 36
harmonized_unit = percent
```

Do not overwrite the original value.

---

# 10. Descriptive interpretation boundary

The skill may make direct descriptive observations from the assembled dataset, for example:

- values are higher in one visible group than another in the current dataset;
- a measure decreases over rounds;
- reported values span a wide range;
- several studies cluster in a similar numerical range.

Do not automatically upgrade descriptive patterns into scientific causal or theoretical conclusions.

Examples that require literature-review synthesis rather than data synthesis:

- "general-population participants have lower reasoning ability";
- "model A is scientifically superior";
- "this pattern proves mechanism X";
- "the field has established effect Y".

Return such questions to `scientific-literature-review`.

---

# 11. Figures

Choose a figure appropriate to the available data.

Examples:

- point plot for study-level estimates;
- error-bar plot when a compatible uncertainty/dispersion measure is available;
- line plot for ordered conditions or rounds;
- scatter plot for paired numeric relationships or observation-level data;
- bar/frequency plot for categorical distributions;
- distribution plot when true distributional or observation-level data are available.

Do not draw an error bar when the required uncertainty quantity is unavailable.

Do not synthesize pseudo-raw points from summary statistics.

Do not visually imply comparability that the data do not support.

---

# 12. Plotting table requirement

This is a hard constraint.

**Whenever a figure is produced, save the exact tabular dataset used to generate that figure.**

Do not create figures from an intermediate hidden dataset.

The saved table must be the actual source dataset used for plotting.

The plotting table should retain provenance fields when practical, even if the figure uses only a subset of columns.

Recommended fields include:

```text
paper_id
paper_title
sample_or_experiment
population
condition
target_variable
statistic_type
reported_value
dispersion_type
dispersion_value
sample_size
derived_value
harmonized_value
harmonized_unit
transformation
source_location
source_depth
missing_reason
```

---

# 13. Output location

Save outputs alongside the existing literature review.

Default structure:

```text
<review-folder>/
├── literature-review.qmd
├── report-style.css
└── data-synthesis/
    ├── <descriptive-name>.csv
    ├── <descriptive-name>.png
    └── <descriptive-name>-notes.md   [optional]
```

Do not ask for a new output location when the literature-review directory is already known and suitable.

Use descriptive basenames tied to the target variable, for example:

```text
beauty-contest-first-round
reaction-time-condition-a
level-k-estimates
```

---

# 14. Output artifacts

Default outputs for a completed synthesis are:

1. **CSV or equivalent tabular file**
   - contains the exact data used for plotting;
   - preserves reported, derived, and harmonized values;
   - preserves provenance and missingness when practical.

2. **Figure**
   - generated directly from the saved plotting table.

3. **Optional notes file**
   - eligibility rules;
   - transformations;
   - excluded records;
   - comparability warnings;
   - unresolved missingness.

Do not generate a long standalone narrative report by default.

The parent literature review remains the main conceptual report.

---

# 15. Interaction model

Typical post-review workflow:

```text
user asks a data question
→ identify target variable
→ reuse review scope and paper set
→ define eligibility/comparability rules
→ extract paper-level values
→ construct DataRecords
→ harmonize deterministically
→ mark missing values
→ save plotting table
→ generate figure
→ return files and a concise descriptive summary
```

If the target variable is ambiguous, infer the narrowest reasonable interpretation from the existing review and user wording when safe.

If multiple incompatible definitions exist, surface the distinction rather than silently merging them.

---

# 16. Accuracy requirements

Never:

- fabricate numerical values;
- infer N from unrelated study totals;
- derive SE without the required inputs;
- infer SD from median/IQR by assumption;
- create participant-level points from summary statistics;
- convert ambiguous intervals into SE/SD;
- silently merge incompatible task variants;
- silently merge different parameter definitions;
- treat missing data as zero;
- hide excluded studies;
- hide transformations;
- hide source depth;
- perform formal meta-analysis unless a separate explicit workflow is invoked.

When a requested quantity cannot be obtained, keep it missing and state why.

---

# 17. Final mental model

The skill should answer:

> "Across the papers already identified by the literature review, what comparable data are actually reported for this specific measurement target, and how can those data be transparently aligned and visualized?"

It should not answer:

> "What does the literature ultimately prove?"

That remains the responsibility of `scientific-literature-review`.
