# scientific-data-synthesis

Companion skill for `scientific-literature-review`.

Purpose:

1. Start from an existing literature review or stable paper set.
2. Define one target construct or measurement family.
3. Extract comparable paper/sample-level data, usually through `scientific-information-extraction`.
4. Preserve missingness instead of guessing.
5. Allow only deterministic transformations with all required inputs present.
6. Save the exact plotting table.
7. Generate a figure directly from that saved table.
8. Save outputs next to the parent literature review under `data-synthesis/`.

This is not a formal meta-analysis skill.

Core integrity rule:

> Never infer or reconstruct an unreported quantity unless it is deterministically derivable from reported information with all required inputs available. Otherwise, treat it as missing.
