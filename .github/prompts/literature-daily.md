## Task Description

Generate one compact daily literature research update for the repository.

The request text includes the update date, recency window, maximum item count,
whether social signals are enabled, and an optional topic. If no topic is
provided, infer the research focus from repository context and open
`agent-goal` issues. Do not implement focused-topic issue automation: do not
create or update labels, issue templates, issues, comments, or discussions.
The workflow will publish your final markdown as a Discussion and will publish
one top-level Discussion comment for each item block you mark.

Read the repo-local research skill guidance first:

- `.skills/literature-review/SKILL.md`
- `.skills/deep-research/SKILL.md` when the request is broad or ambiguous

Use the installed research tooling when useful:

- `paper-search` for Google web/scholar, Semantic Scholar, PubMed, and browsing
- `paper` for reading papers or PDFs
- `gh search repos` and `gh repo view` for GitHub repository discovery

Instructions:

1. Prefer primary sources: papers, project repositories, official docs, release
   notes, benchmark pages, datasets, and author or lab posts.
2. Treat tweets and threads only as discovery signals unless they link to a
   primary source. Exclude social signals when the request says they are not
   enabled.
3. Favor recent items inside the requested recency window, but include one older
   item only when it is necessary context for a recent item.
4. Deduplicate by canonical URL, DOI/arXiv ID, title, or GitHub owner/name.
   Before generating the shortlist, fetch the bodies and comments of the last
   3-5 discussions in the category specified in this request using
   `gh api graphql` or equivalent `gh` commands, extract all canonical URLs,
   arXiv IDs, DOIs, and GitHub owner/name strings already cited there, and
   exclude any item whose identifier matches one already published in a prior
   update. If the fetch fails, note the failure in the Confidence Notes section
   and proceed with within-run deduplication only.
5. Keep the update compact. Include at most the requested maximum number of
   items.
6. Optimize for phone reading. Do **not** use large markdown tables. Use short
   sections, bullets, and one item card per source.
7. Do not include raw logs, command transcripts, or a preamble.
8. Cite each item with a URL.

Produce exactly these sections in the Discussion body:

## Research Update

Summarize the main themes in 2-4 bullets. If no strong new item was found, say
that directly and explain where you looked.

## Today's Items

Use a numbered list, not a table. Each item should be a compact card:

1. **[Title / Item](URL)** — `type`, source, date/year
   - **Why it matters:** one concise sentence.
   - **Relevance:** High/Medium/Low and one phrase explaining why.
   - **Follow-up:** one concrete next action.

Valid `type` values are `paper`, `blogpost`, `github_repo`, `docs_release`,
`dataset`, `benchmark`, and `tweet_thread`.

## Confidence Notes

Briefly state source quality, uncertainty, deduplication coverage, and any
important gaps.

## Follow-ups

List 1-3 concrete next searches or say there are no obvious follow-ups.

After the Discussion body, include a separate section named exactly:

## Item Comments

For each item from `Today's Items`, emit one top-level comment block using these
HTML markers. The publishing workflow strips these blocks from the Discussion
body and posts each one as a separate Discussion comment, so users can reply to
specific papers/items.

```md
<!-- literature-item-comment -->
### [Title / Item](URL)

- **Type:** paper | blogpost | github_repo | docs_release | dataset | benchmark | tweet_thread
- **Source/date:** source, date/year
- **Why it matters:** 1-3 sentences with the key contribution or signal.
- **Relevance:** High/Medium/Low, with the reason.
- **Follow-up:** one concrete next action.
- **Identifiers:** DOI, arXiv ID, GitHub owner/name, or canonical URL when available.
<!-- /literature-item-comment -->
```

Rules for item comments:

- Produce one comment block for every item in `Today's Items`.
- Do not put multiple items in one comment block.
- Do not use markdown tables inside comments.
- Keep each comment self-contained enough to support a focused reply thread.
