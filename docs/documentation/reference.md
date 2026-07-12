---
title: "Reference"
description: "Configuration, status model, repository layout, commands, CI behavior, side doors, and troubleshooting."
---

## `blueprint.config.json`

```json
{
  "contentRoot": "content",
  "blueprints": [
    {
      "root": "blueprint",
      "source": { "type": "dir" },
      "pageMode": "chapter",
      "lakeRoots": ["Ch01_SumsOfOddNumbers"],
      "repo": "owner/name"
    }
  ]
}
```

| field         | meaning                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentRoot` | Quartz content root for the starter project; default template clones use `content`                                                                       |
| `root`        | the blueprint lives at `<contentRoot>/<root>/`                                                                                                           |
| `source`      | the authoring decision; `dir` = blueprint-as-source (this site). `plan` / `scrape` are legacy side doors                                                 |
| `pageMode`    | `chapter` (items as anchored sections) or `item` (one page per item) — independent of `source`                                                           |
| `lakeRoots`   | root modules walked by the extractor; **CI reads this** (nothing to edit in workflows)                                                                   |
| `leanSrcDirs` | where declaration source snippets and `anchor=` regions are looked up; defaults to the blueprint directory — point it at your library when adopting code |
| `repo`        | `owner/name`, used by `discussion=` issue links                                                                                                          |

## Status model (kernel-computed)

There is no `\leanok` to maintain — `lake exe blueprint-data` walks the compiled
environment and the importer computes:

| condition                                         | status                         | color     |
| ------------------------------------------------- | ------------------------------ | --------- |
| decls exist, sorry-free, all ancestors sorry-free | fully formalized               | `#1CAC78` |
| decls exist, sorry-free, some ancestor isn't      | proof formalized               | `#9CEC8B` |
| decls exist, proof contains `sorry`               | in progress                    | `#FCD34D` |
| definition with decl                              | statement formalized           | `#B0ECA3` |
| no decl, all dependencies fully formalized        | ready to formalize (proof)     | `#A3D6FF` |
| no decl, statement dependencies formalized        | ready to formalize (statement) | `#3b82f6` |
| otherwise                                         | not ready                      | gray      |

"Sorry-free" is detected via transitive axiom collection (`sorryAx`), so a proof
that merely _calls_ something sorry'd is not fully green either.

## Repository layout

Two kinds of paths: **yours** (`content/`, and your Lean library when you add
one) and **machinery** you never edit (`scripts/`, `quartz/`, `.agent/`,
`.github/`).

```text
lakefile.toml                  # Lake root = repo root
lean-toolchain                 # pinned Lean version (elan auto-installs)
blueprint.config.json
content/                       # YOURS — everything the site renders
  index.md                     # starter site page for template clones
  _meta.json                   # starter-site sidebar order
content/blueprint/
  _meta.json                   # hand-authored chapter order
  index.md                     # hand-authored landing
  Ch01_*.lean / 0N-*.md        # the chapters (the source of truth)
  blueprint-data.json          # MACHINE-committed: kernel truth (CI)
  dep-graph.canvas             # MACHINE-committed: dependency canvas (CI)
YourLib/                       # YOURS — a real Lean library, when you add one
                               # (root-level, normal Lake conventions; see the
                               # external-project tutorial)
docs/                          # this repository's documentation site root
scripts/                       # machinery: build pipeline, importer, extractor
  blueprint-data/              #   Lake source of `lake exe blueprint-data`
quartz/                        # machinery: the site generator
.agent/, .github/, .skills/    # machinery: agents and CI
```

Only the two machine-committed files are ever regenerated; everything else in
the blueprint folder is yours. Note the prose direction: chapters carry the
prose (markdown, or `/-! -/` blocks in literate Lean chapters) — docstrings in
a referenced library do **not** render, which is the reverse of classic
leanblueprint's annotation extraction.

## Content roots and sidebar navigation

Every content folder carries a `_meta.json` (`label` + ordered `pages`); the
sidebar is derived from it, and the build validates it strictly (every Markdown
or Lean page listed exactly once, every Markdown page has a frontmatter title, and
every Lean chapter has a heading). A `pages` entry is normally a string. Generated
page types can be listed explicitly with a title:

```json
{ "page": "dep-graph", "type": "canvas", "title": "Dependency canvas" }
```

Canvas entries render with a small badge in the sidebar so generated pages are
easy to distinguish from Markdown and Lean chapters.

Template clones need no extra configuration: `npm run dev` and `npm run build`
render `content/`. This repository's documentation lives in top-level `docs/` and
uses the same Quartz build with an explicit content-root override.

## Commands

| command                    | what it does                                            |
| -------------------------- | ------------------------------------------------------- |
| `lake build`               | typecheck (chapters in `content/blueprint/` ARE source) |
| `npm run blueprint:data`   | extract kernel truth (reads `blueprint.config.json`)    |
| `npm run blueprint:sync`   | extract + regenerate the canvas in one step             |
| `npm run blueprint:canvas` | regenerate the dependency canvas                        |
| `npm run dev`              | build + serve `content/` with hot reload                |
| `npm run build`            | production build for `content/`                         |

To build or serve this repository's own `docs/` instead of `content/`, set the
content root: `QUARTZ_CONTENT_ROOT=docs npm run build` (or `npm run dev`).

The site builds from committed files only — deployment needs **no Lean toolchain**
(`public/`, Vercel-ready).

## CI (`.github/workflows/lean.yml`)

On every push/PR touching the blueprint, `docs/`, `scripts/`, or the lakefile: build
Lean → extract kernel data → regenerate the canvas → build the starter site →
build the repository docs → commit back the two machine-managed files. **A PR that
proves a lemma shows its node changing status in its own diff.** Fork PRs are
validated but not pushed to.

## Mathlib bumps (`.github/workflows/bump-mathlib.yml`)

The scheduled/manual Mathlib bump workflow is inert in a fresh template clone:
it parses `lakefile.toml` and skips unless the project has a real `[[require]]`
named `mathlib`. Once Mathlib is configured, the workflow resolves the latest
non-draft Mathlib release tag (or the manual `target` input), copies Mathlib's
matching `lean-toolchain`, pins the dependency rev, runs `lake update mathlib`,
restores the Mathlib cache, builds, and refreshes the machine-managed blueprint
data (`npm run blueprint:sync`), then opens or updates `automation/bump-mathlib`
with the Lake, toolchain, and blueprint-data changes together — so the bump PR's
own diff shows any node status changes.

The default `GITHUB_TOKEN` is enough for the workflow's `contents: write` and
`pull-requests: write` permissions. The bump job runs the build before opening
the PR; repositories that want follow-up PR workflow runs from the automated
branch can swap in their own GitHub App or PAT token for the PR creation step.

## Side doors (library-companion and migration paths)

`scripts/import-blueprint.mjs` (the legacy importer) renders blueprints from other
sources into generated per-item pages (`pageMode: item`):

```bash
# external markdown/LaTeX plan + kernel data
node scripts/import-blueprint.mjs --plan=path/to/plan --data=path/to/blueprint-data.json

# scrape a *published* leanblueprint site (no toolchain needed at all)
node scripts/import-blueprint.mjs --base-url=https://example.github.io/Project/blueprint
```

## Invariants and troubleshooting

- **Two clocks**: prose hot-reloads instantly; statuses only change after
  `lake build && npm run blueprint:sync`.
- Literate chapter filenames must be module identifiers, registered in
  `lakefile.toml` `roots`, `blueprint.config.json` `lakeRoots`, **and**
  `_meta.json`; doc blocks must not contain a literal `-/`.
- Markdown chapters carry a frontmatter `title` and no `# H1` (the nav validates
  titles strictly and will fail the build with a clear message otherwise).
- `.lean` chapter page URLs are lowercased (`Ch01_SumsOfOddNumbers.lean` →
  `/blueprint/ch01_sumsofoddnumbers`); item anchors are the github-slugged labels
  (`#thm:sumOdds-eq-sq` → `#thmsumodds-eq-sq`) — cross-references handle this
  automatically, hand-written URLs must match it.
- Explicit `uses=` may intentionally omit inferred dependencies to prune the
  narrative graph. `plan/kernel:` build warnings are reserved for explicit
  `uses=` labels that the kernel did not infer on a sorry-free declaration.

## License

Original project code and content are licensed under the
[PolyForm Shield License 1.0.0](https://github.com/self-evolving/lean-workspace-template/blob/main/LICENSE.txt).
The repository also includes third-party components under their original
licenses — see
[THIRD_PARTY_NOTICES.md](https://github.com/self-evolving/lean-workspace-template/blob/main/THIRD_PARTY_NOTICES.md).
