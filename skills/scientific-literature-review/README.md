# scientific-literature-review

Files:

- `SKILL.md` — core living-review workflow
- `EVIDENCE-ASSESSMENT.md` — synthesis-unit and evidence rules
- `REPORT-FORMAT.md` — QMD/HTML report structure
- `report-style.css` — stable reading stylesheet

## Core architecture

1. Define the review question and scope.
2. Use **question-conditioned conceptual resolution** rather than fixed G0–G3 granularity.
3. Build a conceptual structure by tracking five classes of new review-relevant concepts:
   - question
   - entity / phenomenon
   - theory / explanation
   - method
   - relation / boundary
4. Search through multiple independent routes until conceptual saturation is high.
5. Treat conceptual exhaustiveness as the default review objective.
6. If the user requests all / nearly all relevant papers, assess **paper exhaustibility under current resources**:
   - `Feasible`
   - `Uncertain`
   - `Not feasible`
7. Run near-exhaustive paper search only when feasible; otherwise recommend narrowing the question.
8. Use progressive source acquisition and `scientific-fulltext-retrieval`.
9. Finding/downloading full text does **not** trigger reading.
10. Use `scientific-information-extraction` for local paper-level information.
11. Build review-relevant synthesis units rather than paper summaries.
12. Use E0–E4 only for empirical claims where replication-based strength is meaningful.
13. Maintain the review as persistent state with `refresh`, `add-paper`, and `rebuild`.

## Search logic

**Discover → Scholar + Semantic Scholar**  
**Expand → Semantic Scholar (+ Europe PMC when domain-relevant)**  
**Challenge coverage → Scholar + OpenAlex**  
**Verify → Crossref / domain index / publisher**  
**Acquire full text → scientific-fulltext-retrieval**

Coverage confidence comes from concept-novelty decline, convergence across independent search routes, challenge-search failure, and—when paper exhaustiveness is assessed—declining unique-paper yield and corpus-growth plateau.
