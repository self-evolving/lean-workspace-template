---
title: "Work on an external Lean project"
description: "Point the workspace at an existing repo, issue, or PR — so the blueprint shows that work, not the demo."
---

The blueprint pages render **this repository's** `content/blueprint/` and
nothing else. Cloning another project next door (or in `/tmp`) never changes
what the canvas shows, and the demo chapters are placeholders, not fixtures:
adopting a real project means deleting them. This page turns a fresh copy of
the template into the local working environment for an existing Lean project —
say, an issue or PR on a repository we'll call `acme/analysis`.

_Coming from a published leanblueprint site instead? That path is
[migrate an existing blueprint](migrate-existing-blueprint)._

## 1. Bring the code in

Two options — they differ only in the build target you'll use in steps 5–6:

- **Depend on it** (the code stays upstream; right for reading and planning):
  add a `[[require]]` to `lakefile.toml`, pinned to the branch or commit you
  are working from:

  ```toml
  [[require]]
  name = "Analysis"
  git = "https://github.com/acme/analysis"
  rev = "the-pr-branch-or-commit"
  ```

  Two details that bite here: `name` must match the package name the upstream
  `lakefile.toml`/`lakefile.lean` declares (`name = "Analysis"`), not a
  spelling of your choice. And for a **pull request from a fork**, point
  `git` at the fork itself (`https://github.com/contributor/analysis`) with
  `rev` set to the PR branch — Lake clones the repository, so a PR ref on the
  upstream repo is not fetchable.

- **Copy it in** (right when you'll edit the Lean code here): copy the source
  tree into the repo (say `Analysis/` plus a root module `Analysis.lean` that
  imports its files), and declare the library:

  ```toml
  [[lean_lib]]
  name = "Analysis"
  ```

Either way, copy the source project's `lean-toolchain` over this repo's —
Lean is strict about versions, and a toolchain mismatch is the most common
first-build failure. If the project depends on mathlib, pin the same mathlib
revision its `lake-manifest.json` records, don't let it drift to a newer one.

## 2. Resolve the dependencies

```bash
lake update
```

The fresh template's `lake-manifest.json` knows nothing about your new
`[[require]]`; `lake update` resolves it (and everything transitive),
installing the pinned toolchain on the way if needed. When mathlib is in the
tree — directly or transitively — its post-update hook downloads the
prebuilt build cache during this step, so expect a several-GB download here
rather than later.

## 3. Download prebuilt mathlib (if the project uses it)

```bash
lake exe cache get
```

Usually this now reports `No files to download` — the update hook above
already fetched it — but run it anyway: it is the guard that matters when
you clone an already-resolved workspace, and it works even when mathlib is
only a transitive dependency. Never compile mathlib from source by accident:
that takes hours, while the cache downloads compiled binaries for the pinned
commit in minutes. Budget roughly 10 GB of free disk for a mathlib-sized
`.lake/` — and if you juggle several projects, reuse one workspace rather
than keeping multiple full checkouts.

## 4. Point the blueprint at your code

In `blueprint.config.json`, set `lakeRoots` to your root module(s), `repo` to
where the project's discussions live, and `leanSrcDirs` to where the `.lean`
sources sit — that last one is what the source-snippet renderer searches, and
its default (`content/blueprint`) does not cover adopted code.
All three belong to the entry inside `blueprints` — top-level keys other than
`contentRoot` are ignored:

```json
{
  "contentRoot": "content",
  "blueprints": [
    {
      "root": "blueprint",
      "source": { "type": "dir" },
      "pageMode": "chapter",
      "lakeRoots": ["Analysis"],
      "leanSrcDirs": ["Analysis"],
      "repo": "acme/analysis"
    }
  ]
}
```

For the dependency path, point `leanSrcDirs` at Lake's checkout of the
package instead — e.g. `[".lake/packages/analysis"]`.

## 5. Replace the demo chapters

Delete `content/blueprint/Ch01_SumsOfOddNumbers.lean` and `02-further-sums.md`,
remove them from `content/blueprint/_meta.json`, and drop the demo's entry
from `roots` in `lakefile.toml` (remove the `Blueprint` library stanza
entirely if you won't keep literate Lean chapters there).

The two machine-managed files go too: delete `blueprint-data.json` and
`dep-graph.canvas` (they describe the demo), **and remove the `dep-graph`
canvas entry from `content/blueprint/_meta.json`** — the navigation is
validated strictly, so an entry pointing at a canvas that no longer exists
fails the site build. You will put that entry back after the first sync in
step 6 regenerates the canvas; until then the site builds and renders your
chapters with itemized "not in kernel data" warnings in place of statuses.

What replaces the demo in `defaultTargets` depends on how you brought the
code in:

- **Copied-in library** — it is a target of the root package, so
  `defaultTargets = ["Analysis"]` makes a plain `lake build` build your code.
- **Dependency (`[[require]]`)** — `defaultTargets` can only name root-package
  targets, so remove it instead, and build the dependency's modules
  explicitly: `lake build +Analysis`, one `+Module` for each entry you listed
  in `lakeRoots`.

Then write your own chapters in their place: markdown items carrying
`lean="Analysis.YourTheorem"` pick up kernel statuses, dependency edges, and
source snippets automatically (see the
[chapter grammar](../../documentation/grammar)). A planning DAG for an issue
belongs here too — as a plan-stage chapter whose items declare `uses=` edges,
not as a hand-built HTML page; the canvas is the intended rendering.

## 6. Build and look at it

```bash
lake build && npm run blueprint:sync     # dependency path: lake build +Analysis
npm run dev     # http://localhost:8080/blueprint/
```

Set expectations for the sync: the extraction step walks the whole compiled
environment, and on a mathlib-sized project that takes **10–20 minutes with
no output** beyond a periodic "still working" heartbeat. It is not hung —
don't interrupt it. When it finishes, restore the `dep-graph` canvas entry
you removed from `content/blueprint/_meta.json` in step 5.

The canvas now shows your project, statuses arbitrated by your kernel data.
From here the loop is the normal one: prove things and re-sync
([writing your first proof](writing-your-first-proof) walks it on the demo),
and share any branch as a deployed site by opening a PR with the
`sepo-preview` label ([per-branch preview](../features/per-branch-preview)).
