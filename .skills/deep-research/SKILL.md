---
name: deep-research
description: Research a topic in depth using agent-papers-cli, web search, academic search, citation graphs, and source synthesis. Use for broad investigations, technical landscape reviews, claim checking, or research briefs that may include papers, blog posts, GitHub repositories, docs, releases, datasets, benchmarks, and social discovery signals.
argument-hint: [topic or question]
allowed-tools: Bash, Read, Glob, Grep, Write
---

Research the user's requested topic or question in depth. Use the repo-local setup script if `paper` or `paper-search` is missing:

```bash
.skills/deep-research/setup.sh
```

The setup installs the pinned `agent-papers-cli` version and runs non-secret smoke checks. Search and browse commands may need `SERPER_API_KEY`, `S2_API_KEY`, or `JINA_API_KEY` in the shell environment.

## Workflow

1. Start broad.
   - Run web and academic searches to map terminology, communities, source types, and competing claims.
   - Prefer primary sources: papers, project repos, official docs, release notes, benchmark pages, datasets, and author or lab posts.
   - Treat tweets and threads as discovery signals unless they link to primary artifacts.

```bash
paper-search google web "<topic or question>"
paper-search semanticscholar papers "<topic or question>" --limit 10
gh search repos "<topic or question>" --limit 10
```

2. Narrow the question.
   - Refine queries from the initial landscape.
   - Use date, citation, venue, organization, benchmark, or implementation filters when useful.
   - Use PubMed only for biomedical topics.

```bash
paper-search semanticscholar papers "<refined query>" --year <recent_year_range> --min-citations 10 --limit 20
paper-search semanticscholar snippets "<specific question>"
paper-search pubmed "<biomedical query>" --limit 10
```

3. Read primary artifacts.
   - For papers, inspect structure before reading details.
   - For web sources, browse the canonical URL rather than relying on search snippets.
   - For GitHub repos, inspect README, releases, issues, examples, and recent activity when relevant.

```bash
paper outline <arxiv_id_or_pdf>
paper skim <arxiv_id_or_pdf> --lines 3
paper read <arxiv_id_or_pdf> <section>
paper-search browse <url>
gh repo view <owner/repo> --json nameWithOwner,description,url,stargazerCount,pushedAt,defaultBranchRef
```

4. Follow provenance.
   - For important papers, inspect citations and references.
   - For tools and repos, find docs, release notes, benchmarks, and papers that introduce or evaluate the system.
   - Cross-check claims across independent primary sources.

```bash
paper-search semanticscholar details <paper_id>
paper-search semanticscholar citations <paper_id> --limit 10
paper-search semanticscholar references <paper_id> --limit 10
```

5. Synthesize.
   - Organize by finding or theme, not by search order.
   - Cite every material claim with a title and URL.
   - Include uncertainty, disagreements, gaps, and follow-up searches.
   - Include BibTeX for cited papers when the user asks for a research artifact or bibliography.

## Output Shape

Use a concise research-item table when presenting discoveries:

| Type | Title / Item | URL | Source | Date / Year | Why it matters | Relevance | Follow-up |
| ---- | ------------ | --- | ------ | ----------- | -------------- | --------- | --------- |

Valid `Type` values include `paper`, `blogpost`, `github_repo`, `docs_release`, `dataset`, `benchmark`, and `tweet_thread`. Prefer primary sources in the final synthesis, and clearly label weaker social or secondary signals.
