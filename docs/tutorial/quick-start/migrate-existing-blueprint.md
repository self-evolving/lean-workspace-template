---
title: "Migrate an existing blueprint"
description: "Bring a leanblueprint-style project into Lean Workspace: scrape a published site, import a plan, or re-author chapters."
---

There are three ways in, ordered from quickest look to most durable setup.

## Scrape a published blueprint

If your project already publishes a
[leanblueprint](https://github.com/PatrickMassot/leanblueprint) site, the
importer can rebuild it here from the published pages alone — no Lean
toolchain needed:

```bash
node scripts/import-blueprint.mjs --base-url=https://example.github.io/Project/blueprint
```

This renders generated per-item pages (`pageMode: item`). It is the fastest
way to see your blueprint in the workspace, but the generated pages are a
snapshot — treat it as a preview, not as the new source of truth.

## Import a plan plus kernel data

If you have the blueprint source (a markdown or LaTeX plan) and extracted
kernel data, the importer can combine them directly:

```bash
node scripts/import-blueprint.mjs --plan=path/to/plan --data=path/to/blueprint-data.json
```

## Migrate to native chapters (recommended)

For a project you intend to keep working on, the durable path is native
chapters that point at your existing library — and the conversion is
automated:

```bash
npm run migrate:blueprint -- --plan=path/to/blueprint/src/content.tex \
  --macros=path/to/blueprint/src/macros/common.tex \
  --label="My Project blueprint"
```

This converts the leanblueprint LaTeX — resolving `\input` chains and
expanding your custom macros — into native markdown chapters: items keep
their labels, `\lean{}` becomes `lean=`, `\uses{}` becomes `uses=`, and the
statements, proofs, and narrative prose come along as markdown. Unlike the
snapshot imports above, the result participates fully in the pipeline:
statuses, dependency edges, and source snippets recompute on every sync, and
explicit `uses=` is only needed where
[inference doesn't apply](../../documentation/grammar#dependencies-inferred-from-the-kernel).
Blueprints built with plastex `split-level=1` (where `\section` is the
chapter unit) pass `--chapter-level=section`.

The script deliberately converts content only, and prints the checklist of
what remains: adopting the Lean code itself (`[[require]]` or copy-in,
toolchain, `lake update`), pointing `blueprint.config.json` at it, and the
folder's landing page —
[work on an external Lean project](work-on-external-project) walks exactly
those steps.

There is no `\leanok` to port: every item's status is recomputed from the
compiled environment on each build, so the migrated blueprint cannot silently
drift from the code.

See [the two authoring styles](../../documentation/modes) for how reference
chapters compare with literate ones, and the
[chapter grammar](../../documentation/grammar) for the full syntax.
