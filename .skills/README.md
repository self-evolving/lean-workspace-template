# Literature Skills

This repository includes skills for Sepo skill runs and literature-template maintenance:

- `deep-research`: broad investigations that combine academic search, web browsing, repositories, docs/releases, datasets, benchmarks, and optional social discovery signals.
- `lean4`: prompt-only Lean 4 support adapted from `cameronfreer/lean4-skills`, focused on Sepo-native learning, read-only proof review, and workspace diagnostics.
- `literature-review`: systematic topic reviews with explicit scope, deduplication, triage, and theme-based synthesis.
- `paper-to-site`: builds a clean hosted Quartz/Sepo literature-template site from a paper source, with the paper as `/`, section pages, citations, figures, graph/backlink hygiene, and standalone-repository guidance.

The research skills install the pinned research tooling version:

```bash
.skills/deep-research/setup.sh
.skills/literature-review/setup.sh
```

The setup scripts install `agent-papers-cli==0.2.1` and smoke-check `paper`, `paper-search`, and `paper-search env`. Installation does not require API keys. `paper-to-site` is documentation-only and does not require a setup script.

## Daily Literature Workflow

`Agent / Daily Literature` (`.github/workflows/agent-literature-daily.yml`)
runs the `literature-daily` prompt manually or on a daily cron. It posts one
compact research update to the `Literature` discussion category when that
category is available. The Discussion body is mobile-friendly and each research
item is posted as a separate top-level Discussion comment for focused replies.
Scheduled runs require `AGENT_LITERATURE_DAILY_ENABLED=true`; manual dispatch
remains available.

Manual inputs let you provide an optional topic, adjust the recent discovery
window, cap the number of items, and opt into social discovery signals. If no
topic is provided, the prompt infers the focus from repository context and open
`agent-goal` issues. Focused-topic issue automation, labels, and templates are intentionally deferred.

## Add Paper Workflow

`Agent / Add Paper` (`.github/workflows/agent-add-paper.yml`) accepts a paper
URL, arXiv ID, DOI, title, PDF URL, or BibTeX entry plus an optional
natural-language additional request, such as which synthesis note to update. It
opens a PR that updates `bibliography.bib`, adds or updates the matching
`content/papers/` note, and updates navigation metadata when needed.

## GitHub Environment Secrets

Literature workflows use a GitHub Environment named `agent-literature` with
these required environment secrets:

- `SERPER_API_KEY`: required for Google web and Google Scholar searches, and for the Serper browse backend.
- `S2_API_KEY`: required by repository literature workflows for practical Semantic Scholar rate limits.
- `JINA_API_KEY`: required for the Jina browse backend.

Configure them as environment secrets, not repository secrets:

```bash
gh secret set SERPER_API_KEY --env agent-literature --repo OWNER/REPO
gh secret set S2_API_KEY --env agent-literature --repo OWNER/REPO
gh secret set JINA_API_KEY --env agent-literature --repo OWNER/REPO
```

Workflow jobs that need the keys declare `environment: agent-literature` and
pass the values through step `env`. The daily workflow validates that all three
research secrets are present before starting the agent.
