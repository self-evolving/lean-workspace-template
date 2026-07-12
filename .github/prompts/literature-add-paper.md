## Task Description

Add or update one durable paper note in this Quartz literature site.

The requested paper or source is provided in `${REQUEST_TEXT}`. It may be an
arXiv URL/ID, DOI, PDF URL, paper title, project page, BibTeX entry, or a short
natural-language request. The request text may also include an additional
natural-language request, just like an inline agent request, such as asking to
update a specific synthesis note or add a particular connection.

Repository conventions:

- Durable paper notes live in `content/papers/`.
- Synthesis/topic notes live in `content/notes/`.
- Do **not** create transient/daily-review markdown content.
- Bibliographic entries live in `bibliography.bib`.
- The `citekey` frontmatter field is a template convention that links a paper
  note to a BibTeX entry; Quartz renders citations from inline syntax such as
  `[@author2026paper]`.

Instructions:

1. Resolve the paper identity from primary sources where possible.
   - Prefer arXiv, DOI landing pages, publisher pages, official project pages,
     Semantic Scholar, or the PDF itself.
   - Use `paper-search`, `paper`, and `gh` when useful and available.
2. Choose a stable BibTeX key and paper-note slug.
   - Prefer an existing key if `bibliography.bib` already contains the paper.
   - Otherwise use a readable key like `firstauthorYYYYshorttitle`.
   - Prefer `content/papers/<citekey>.md` unless the repository already has a
     different slug for the same paper.
3. Add or update the BibTeX entry in `bibliography.bib`.
   - Include stable identifiers such as `doi`, `eprint`, `archivePrefix`, `url`,
     `venue`/`journal`/`booktitle`, and `year` when available.
   - Avoid duplicate BibTeX entries for the same paper.
4. Add or update the paper note.
   - Frontmatter should include `title`, `citekey`, `authors`, `year`, `venue`,
     `url`, and `doi`/`arxiv` when available.
   - Use `tags: [paper]` plus specific topical tags when obvious.
   - Keep note properties useful but concise.
5. Use this paper-note body shape unless an existing note already has a better
   structure:

```md
## Summary

## Key ideas

## Evidence / results

## Limitations

## Connections

## Open questions
```

6. Follow any additional natural-language request from the workflow input. For
   example, update a named synthesis note, add the paper under a requested
   section, or create a specific connection when asked.
7. Link related synthesis notes when the request names a topic or the repository
   already has an obvious matching note. Do not invent a broad synthesis note
   unless the user explicitly asked for one.
8. Update `content/papers/_meta.json` if needed so the new note appears in the
   literature navigation.
9. Run focused validation when practical, such as `npx quartz build` or at least
   checking modified Markdown/BibTeX for obvious syntax errors.
10. Do not commit. Leave changes in the working tree.

Return exactly one JSON object and nothing else:

```json
{
  "summary": "One short paragraph describing the paper note and bibliography changes.",
  "commit_message": "Concise commit message under 72 characters.",
  "pr_title": "Concise pull request title under 72 characters.",
  "pr_body": "GitHub-flavored markdown pull request body."
}
```

Rules:

- `summary` should mention the citekey and note path.
- `commit_message` should describe the actual paper addition or update.
- `pr_title` should identify the paper or source added.
- `pr_body` should include the paper/source URL when known and summarize any
  validation run.
- If you cannot determine better PR metadata from the work performed, return
  empty strings for `commit_message`, `pr_title`, or `pr_body` so the workflow
  can fall back to defaults.
