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

Names follow `chap-01_set-function_chat-01_set-definition`, with
`chap-app-A` or `chap-app-01` for appendices. History groups chapters in contents
order, appendices after main chapters, and discussions by number. Users can
rename topics or assign unassigned discussions to a chapter. Search performs
local text matching across transcripts and provides message snippets and jumps.
Search does not send transcripts to an agent. Legacy search results open in a
preserved preview until migrated.

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

History offers **Migrate legacy discussions** only while unimported records
exist. Migration keeps complete transcripts, available local agent sessions and
original files/notes. It deduplicates identical transcripts, tracks imports,
and can retry after interruption. Imported records start under Unassigned;
chapter ownership is never guessed. Zotero sync notes include discussion and
chapter metadata so another computer can reconstruct groups and transcripts;
CLI thread identifiers remain local to their original computer.
