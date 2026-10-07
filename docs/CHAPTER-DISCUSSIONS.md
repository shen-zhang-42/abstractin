# Chapter discussions

AbstractIn stores a plugin-owned `discussions.json` index beside each PDF's
`reading.json`. Discussion IDs never change when display names or chapter
assignments change. Each discussion has its own `discussions/<id>/chat.json`,
`session.json`, sync state and agent workspace. The index uses atomic replacement.

Books route questions by their subject. Selected text uses its physical PDF
page; an explicit chapter or appendix uses the verified contents index; local
page questions use the location captured when Send was pressed. Ordinary
follow-ups stay in the current discussion. Reference navigation and requests
for supporting evidence do not move the discussion. Missing or ambiguous
chapter boundaries require a user choice instead of an inferred page offset.

Returning to a chapter opens its most recently used discussion and resumes its
local agent thread when compatible and still available. New discussion creates
another independent thread in that chapter. Source and knowledge modes retain
separate local thread identifiers. An expired CLI thread falls back to replaying
only that discussion's transcript.

Names follow `chap-01_chat-01_set-definition`, with
`chap-app-A` or `chap-app-01` for appendices. History replaces the conversation area with a chapter-and-discussion list in
the current reading window. Clicking a card restores that discussion; Back
returns to the current discussion with its unsent draft and scroll position.
The list groups chapters in contents order, appendices after main chapters, and
discussions by number. Users can
rename topics or assign unassigned discussions to a chapter. Search performs
local text matching across transcripts and provides message snippets and jumps.
Search does not send transcripts to an agent. Legacy search results open in a
preserved preview until migrated.

History cards separate topics from discussion numbers and show the current
selection. Checkboxes support bulk deletion and merging, with a review before
applying either action; each card also offers Delete. Deletion hides discussions
from history, search and chapter routing while retaining local originals for
recovery. Deleting the final discussion creates an empty replacement.

Merging preserves complete transcript blocks in chapter/number order and stable
result references, automatically names the result from the source topics, and
starts a fresh agent thread. Sources are superseded in the index and retained on
disk. Same-chapter merges retain their chapter; cross-chapter merges are
Unassigned. Deleted and superseded metadata travels in Zotero chat notes so
index recovery does not restore removed sources. Busy or stale selections are
rejected, and the index is committed atomically before switching discussions.


Knowledge discussion uses the current transcript, supplied passage or page and
model knowledge. A theorem number alone never authorizes a source search.
Explicit requests to check the book's proof allow a bounded source lookup for
that turn, without changing the discussion's chapter or evidence preference.
The full PDF cache stays outside discussion workspaces. Scoped workspaces expose
only authorized source excerpts. Codex command/web/app tools and Claude file
tools are disabled for scoped requests; original skill resources and authorized
source excerpts are supplied inline. Other adapters retain their established
capability checks and workspace boundaries. Third-party executable adapters are
trusted local programs, not an OS isolation boundary.

Papers keep discussions by topic rather than switching at section boundaries.
At an estimated 12,000 text tokens, the UI offers continuing, creating a new
discussion or reviewing and explicitly selecting messages to carry over. This
estimate is not the agent's billed token count. No automatic truncation or
summary transfer occurs.

History offers **Migrate legacy discussions** while unimported records exist,
and **Classify / reimport legacy discussions** for records already imported.
The review classifies question/answer turns from verified selected-page ranges
and explicit chapter subjects. Follow-ups can inherit a preceding verified
assignment; theorem numbers and chapters cited as evidence are not ownership.
Users can request isolated agent suggestions for unknown turns and inspect the
full text before confirming each assignment. The classification call sees only
bounded legacy excerpts and chapter headings, has no reading-chat session or
source tools, and does not modify any reading chat.

Confirmed turns belonging to a chapter are combined into one new discussion,
with complete text retained and uncertain turns left Unassigned. Originals and
previous imports remain on disk. Unchanged previous imports are superseded in
history; conversations with subsequent edits are preserved as separate entries.
Split/combined transcripts start fresh agent threads; the old thread belongs to
its retained original transcript. Repeating the same reviewed import is
idempotent. The earlier unclassified import path retains local thread identifiers
where available. Zotero sync notes include discussion and
chapter metadata so another computer can reconstruct groups and transcripts;
CLI thread identifiers remain local to their original computer.

## Explicit result citations

Saved results have stable IDs and visible **Chat Theorem 1.1.1.1**,
**Chat Definition 1.1.1.3**, or **Chat Result 1.1.2.1** labels. The four positions
are chapter, discussion, question/answer turn, and result; all statement types
share the final counter. Proofs do not consume a statement number. Appendix A
uses `A`, numeric appendices use `App1`, Unassigned uses `U`, and papers use `P`.
The Chat badge and monospaced formal-result number distinguish conversation
labels from original book numbers, which remain unchanged in excerpts.

**Quote** is a dropdown beside Quick questions at the top right of the composer,
separated by a vertical rule. Both controls retain their complete labels;
question descriptions appear only as hover tooltips.
Choose a chapter, a discussion, and a numbered result from the shared composer
dropdown. Selecting a result opens an editable preview. Insertion adds only the reviewed excerpt with
`[result:ID|Chat Theorem 1.1.1.1]` to the composer and never submits it. Legacy
`[result:ID]` links remain supported. Clicking a citation locates the saved result
or opens its preview without switching the active discussion or agent session.

Numbering and exact statement excerpts are saved as message metadata and travel
with Zotero chat notes. Old local transcripts gain this metadata when loaded;
legacy source archives remain intact. Moving keeps previous result numbers and IDs. Deletion and merging compact
visible discussion numbers within each chapter and renumber their results by
chapter, discussion, turn and statement. Stable result IDs remain unchanged;
saved citation labels and composer drafts are refreshed to the new numbers.
Removed originals retain their historical numbering. Formal LaTeX statements and recognized Markdown
statement headings are indexed separately; ordinary answers have a Result entry.
Code examples and quoted book prose are not inferred to be formal statements.

The later agent sees an explicitly supplied prior assistant result, not verified
original-source evidence. Quoted excerpts cannot reroute a question or authorize
a source lookup. Mathematical statements use formal labels and important
equations use tags when subsequent reasoning refers to them.

The footer omits static material/language/agent/mode descriptions. Existing
model and reading-mode dropdowns remain the controls for those choices. The
footer appears only for actionable source status, such as unavailable PDF text
or unverified page links, and disappears when there is no status to show.

The reading companion animates only while an answer is being generated. Its
animations pause while idle; reduced-motion preferences remain respected.
