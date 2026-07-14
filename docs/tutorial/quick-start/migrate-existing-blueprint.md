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
node scripts/import-blueprint.mjs --base-url=https://example.github.io/Project/blueprint \
  --label="My Project blueprint"
```

This renders generated per-item pages (`pageMode: item`). It is the fastest
way to see your blueprint in the workspace, but know what you are getting:

- **The pages are a frozen snapshot.** Statuses are read off the published
  site at import time; `npm run blueprint:sync` will not refresh them — it
  would overwrite the imported canvas with (empty) kernel data. Treat the
  import as a preview, not as the new source of truth.
- **By default it replaces `content/blueprint/`** (and registers itself in
  `content/_meta.json`). Pass `--out=<name>` to write a trial import to
  `content/<name>/` next to the demo instead.
- **The Lean side is untouched.** The default import deletes the demo's
  `.lean` chapter while `lakefile.toml` `roots` and `blueprint.config.json`
  `lakeRoots` still name it, so `lake build` — including CI — fails until
  you do the cleanup in
  [work on an external Lean project](work-on-external-project) (step 5).
- Without `--label`, the sidebar label will not be your project's name —
  always pass it explicitly.

## Import a plan plus kernel data

If you have the blueprint source (a markdown or LaTeX plan) and extracted
kernel data, the importer can combine them directly:

```bash
node scripts/import-blueprint.mjs --plan=path/to/plan --data=path/to/blueprint-data.json
```

`--out` and `--label` work here too, and multi-file LaTeX plans work as-is
(`\input` chains resolve). Two more flags cover the common leanblueprint
layouts: `--macros=common.tex,web.tex` expands the project's custom
`\newcommand`/`\DeclareMathOperator` shorthands so they don't reach the
rendered statements raw, and `--chapter-level=section` serves blueprints
built with plastex `split-level=1`, where `\section` is the chapter unit.

Omitting `--data` is allowed and makes this a trial conversion with no
kernel truth behind it: every `\lean{}` reference reports "not found", and
the readiness statuses on the generated pages are placeholders computed from
an empty kernel map. Like the scrape, the output is generated snapshot pages
— the durable path is the next section.

## Re-author as reference chapters (recommended)

For a project you intend to keep working on, the durable path is to write
native chapters that point at your existing library — the code itself never
moves:

1. Add your library to `lakefile.toml` (e.g. a mathlib-style `[[require]]`,
   with a matching `lean-toolchain`).
2. Set `lakeRoots` in `blueprint.config.json` to your root modules, and
   `leanSrcDirs` to where the `.lean` sources sit (snippet lookup only
   searches the blueprint directory by default).
3. Rewrite each chapter as a markdown chapter whose items carry
   `lean="Your.Decl.Name"` — statuses, dependency edges, and source snippets
   then come from the kernel automatically, and explicit `uses=` is only
   needed where
   [inference doesn't apply](../../documentation/grammar#dependencies-inferred-from-the-kernel).

There is no `\leanok` to port: every item's status is recomputed from the
compiled environment on each build, so the migrated blueprint cannot silently
drift from the code.

See [the two authoring styles](../../documentation/modes) for how reference
chapters compare with literate ones, and the
[chapter grammar](../../documentation/grammar) for the full syntax.
