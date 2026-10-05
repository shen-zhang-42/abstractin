# scientific-fulltext-retrieval

Companion skill for literature review, information extraction, paper reading, and data synthesis.

Core principle:

> Full-text acquisition is not full-text reading.

The skill finds, verifies, records, and optionally saves lawful accessible versions of already identified scientific papers. It deliberately avoids semantic reading during acquisition so that token usage is deferred until a later targeted query.

Typical chain:

`scientific-literature-review` → `scientific-fulltext-retrieval` → `scientific-information-extraction`

Do not provide institutional passwords, VPN credentials, library-proxy credentials, cookies, or session tokens to this skill. Authenticate on the user's side and provide the accessible file/source instead.
