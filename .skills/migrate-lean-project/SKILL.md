---
name: migrate-lean-project
description: Use when migrating an existing Lean 4 project or leanblueprint into this workspace — adopting the code as a companion dependency OR copying it in for local Lean edits, converting the blueprint to native chapters, or planning either. Encodes the field-tested procedure and its pitfalls; the tutorials are the human-facing walk of the same steps.
argument-hint: "[repo-or-url] [--adopt=companion|copy-in] [--blueprint=native|scrape-preview]"
allowed-tools: Bash, Read, Glob, Grep
---

# Migrate a Lean project into this workspace

This skill is the agent-facing checklist for turning a copy of this template
into the live workspace for an existing Lean project. It was distilled from
real migrations (RemyDegenne/brownian-motion, 15 chapters / 620 items;
Sphere-Packing-Lean, 8 chapters / 141 items) — every warning below is a
mistake one of those migrations actually hit. On `/skill` runs, plan and
dry-run only; persistent edits go through the normal `/implement`
edit-verify-PR flow following the same steps.

Human-facing tutorials for the same ground:
`docs/tutorial/quick-start/work-on-external-project.md` (code adoption) and
`docs/tutorial/quick-start/migrate-existing-blueprint.md` (content paths).

## Choose the path

| You have                                   | Use                                                   | Result                                                                                  |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Blueprint LaTeX sources (`blueprint/src/`) | `npm run migrate:blueprint`                           | **Native chapters** — statuses, edges, snippets recompute every sync. The durable path. |
| Only a published leanblueprint site        | `node scripts/import-blueprint.mjs --base-url=…`      | Frozen snapshot, preview only — `blueprint:sync` will not refresh it.                   |
| A plan file plus extracted kernel data     | `node scripts/import-blueprint.mjs --plan=… --data=…` | Snapshot with statuses baked once.                                                      |

Treat the migration tooling as maturing: convert, then eyeball the rendered
output. File template issues for conversion defects instead of hand-patching
generated chapters silently.

## Recon (before touching anything)

Read from the upstream project:

1. `lakefile.toml` / `lakefile.lean` — the declared package `name` (the
   `[[require]]` you write MUST match it exactly), and whether mathlib is a
   direct or transitive dependency (both work with the cache).
2. `lean-toolchain` — you will copy it over this repo's verbatim.
3. `blueprint/src/` — `content.tex` (usually a pure `\input` chain — the
   tooling resolves it), `macros/*.tex` (pass via `--macros`, or shorthands
   leak into rendered statements raw), `plastex.cfg` (`split-level=1` means
   `\section` is the chapter unit → `--chapter-level=section`), and whether
   `\part{}` gives the outline two levels (→ `--part-folders`; chapter URLs
   become `/blueprint/<part>/<chapter>`).
4. Attribution inputs: the title-page `\author{}` in `web.tex`/`print.tex`
   AND any per-part author paragraphs inside `content.tex` (projects list
   blueprint and formalization credits separately — carry both), plus the
   upstream `LICENSE`.

## Adopt the code

First decide how the Lean code enters the workspace — the same fork as the
external-project tutorial:

- **Companion mode** (`[[require]]`, the code stays upstream): right when
  this workspace reads, plans, and tracks statuses while the Lean lives in
  its own repository. You cannot edit the Lean here.
- **Copy-in mode** (`[[lean_lib]]`, the code lives in this repository):
  required when `/implement` runs will edit or propose Lean code in this
  workspace — proving items, filling sorries, formalizing.

### Companion mode

```toml
[[require]]
name = "UpstreamPackageName"        # must match upstream's declared name
git = "https://github.com/owner/repo"
rev = "<commit sha>"                 # a fork PR needs the FORK's url + branch
```

- `blueprint.config.json`: `lakeRoots` = upstream root module(s),
  `leanSrcDirs` = `[".lake/packages/<RequireName>"]` (Lake names the checkout
  after the require's `name`). Both keys belong INSIDE the `blueprints[]`
  entry — top-level keys other than `contentRoot` are ignored.
- No `defaultTargets` (the dependency is not a root-package target); build
  with `lake build +UpstreamRootModule`, one `+Module` per `lakeRoots` entry.

### Copy-in mode

Copy the source tree into the repo root (say `Analysis/` plus a root module
`Analysis.lean` importing its files — keep upstream file headers and
license), and declare it:

```toml
[[lean_lib]]
name = "Analysis"
```

- `blueprint.config.json`: `lakeRoots = ["Analysis"]`,
  `leanSrcDirs = ["Analysis"]`.
- `defaultTargets = ["Analysis"]` so a plain `lake build` builds the code.
- Carry over the upstream `lake-manifest.json` pins (especially mathlib's
  rev) rather than letting `lake update` drift to newer ones.

### Both modes, in order

1. Copy the upstream `lean-toolchain` over this repo's.
2. `lake update` — resolves the new require(s); when mathlib is in the tree
   its post-update hook downloads the build cache here (a several-GB step).
3. `lake exe cache get` — usually reports nothing to download; it is the
   guard for already-resolved clones. Never let mathlib compile from source.
4. Set `repo` in `blueprint.config.json` to where `discussion=` links go.
5. Remove the demo: both demo chapters, their `_meta.json` entries, the
   `Blueprint` lib stanza / `defaultTargets` in `lakefile.toml` (copy-in
   mode replaces `defaultTargets` with the new library instead), AND the two
   machine files (`blueprint-data.json`, `dep-graph.canvas`) **and the
   dep-graph entry in `content/blueprint/_meta.json`** — nav validation
   fails on a dangling canvas entry. The entry returns after the first sync.

## Convert the blueprint

```bash
npm run migrate:blueprint -- \
  --plan=<upstream>/blueprint/src/content.tex \
  --macros=<upstream>/blueprint/src/macros/common.tex \
  --label="Project Name blueprint" \
  [--chapter-level=section] [--part-folders] [--dry-run]
```

Read the tool's output: it warns on dropped non-item `uses=` references,
orphan proofs kept as quoted prose, chapterless `\part` headings, and prints
the checklist of what it deliberately does not touch (Lean adoption, config,
the folder's `index.md`). Rewrite `content/blueprint/index.md` as the
project's landing page — including attribution (authors as upstream records
them, note that prose is converted from the upstream LaTeX under its
license) — and carry the upstream license file (e.g. `UPSTREAM-LICENSE.txt`)
plus a README attribution section before the repo is shared anywhere.

## First sync and what to expect

```bash
lake build            # dependency path: lake build +UpstreamRootModule
npm run blueprint:sync
```

- Extraction walks the compiled environment: **10–20 minutes on
  mathlib-sized projects**, with progress lines every 200 declarations. It
  is not hung; do not interrupt it (locally, run it detached from anything
  that enforces short timeouts).
- Declarations referenced by chapters but living outside `lakeRoots`
  (theory upstreamed to mathlib, code in dependency packages) resolve
  automatically via the chapter-collected `--decls` list and carry
  `origin: "external"`.
- Source snippets are baked into `blueprint-data.json` so deployed builds
  (no `.lake/` checkout) still render code.
- Afterwards: restore the dep-graph canvas entry in `_meta.json`, then
  `npm run build` must pass.
- `plan/kernel:` warnings mean the validator caught an upstream-declared
  `uses=` edge the kernel disproves. Kernel truth wins: drop the declared
  edge rather than silencing the warning — real blueprints carry stale
  hand-declared edges.

## Citations (when the blueprint cites literature)

`\cite{}` converts to pandoc `[@key]` with sanitized keys (spaces and
non-ascii normalized) — apply the identical renames inside
`bibliography.bib`. Enable BOTH shipped-disabled plugins in
`quartz.config.yaml`: `citations` (reference list) and `literature-citations`
(popover cards + styled References). Quartz's transform cache keys on content
only — `rm -rf .quartz-cache` after flipping plugin config.

## Verify before proposing

- `npm run check` and `npm test` pass.
- `npm run build` passes; count remaining "not in kernel data" warnings and
  explain any (they should be near zero after a full sync).
- Spot-check one migrated chapter against the published upstream site:
  titles, math rendering, cross-references, statuses.
- Nothing was written or pushed to the upstream project.
