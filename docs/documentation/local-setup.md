---
title: "Local setup"
description: "From clone to your first green node."
---

_For the GitHub-first path — Sepo agents, previews, and setup — start at the
[tutorial quick start](../tutorial/quick-start)._

## Prerequisites

- [elan](https://github.com/leanprover/elan) (the Lean version manager — the pinned
  toolchain installs automatically on first build)
- Node ≥ 22

## Setup

```bash
# use this repo as a template (or clone it), then:
lake build        # typechecks the blueprint chapters — they ARE Lake source
npm install
npm run dev       # http://localhost:8080
```

## Troubleshooting

Three failures cover most first runs:

- **`npm install` refuses with an engine error.** This project requires
  Node 22 or newer and fails fast on older versions. Install the current LTS
  from [nodejs.org](https://nodejs.org), or with nvm:
  `nvm install 22 && nvm use 22`.
- **`lake: command not found`.** Install
  [elan](https://github.com/leanprover/elan), the Lean version manager, and
  restart your terminal — the pinned toolchain then downloads itself on the
  first build (~300 MB):

  ```bash
  curl https://elan.lean-lang.org/elan-init.sh -sSf | sh
  ```

- **A mathlib project builds for hours.** Never compile mathlib from source.
  Download the prebuilt binaries first, and budget roughly 10 GB of disk for
  a mathlib-sized `.lake/`:

  ```bash
  lake exe cache get
  ```

(The shipped demo has no dependencies — its `lake build` takes seconds.)

## The loop

Two clocks, by design:

1. **Prose is instant** — edit any chapter file (`content/blueprint/*.md` or `*.lean`),
   save, and the page hot-reloads.
2. **Statuses follow the kernel** — pills and canvas colors refresh after you
   re-arbitrate:

```bash
lake build && npm run blueprint:sync
```

While `npm run dev` runs, a watcher in the same terminal notices Lean edits,
tells you when statuses may be stale, and runs this re-sync when you press
`s` + Enter — on mathlib-sized projects a cycle takes about a minute, which
is why it asks instead of firing on every save (`--no-lean-watch` disables
the prompt).

## Your first green node

The demo ships with one open task:
[Lemma 1.4 · sumOdds-pos](../../blueprint/ch01_sumsofoddnumbers#lemmasumodds-pos)
contains a `sorry`, so it renders amber ("in progress"). Prove it:

```lean
theorem sumOdds_pos (n : Nat) : 0 < sumOdds (n + 1) := by
  simp [sumOdds_succ]
```

Then run the status loop above and reload — the node turns green, and so does
everything that was only waiting on it. (In CI the same thing happens
automatically: a PR that proves a lemma shows its node changing color in the
PR's own diff.)

## Adding a chapter

**Plan-stage (markdown).** Create `content/blueprint/03-my-chapter.md`:

```markdown
---
title: "My chapter"
---

Intro prose for the chapter.

## Theorem: My theorem {#thm:my-theorem uses="thm:sumOdds-eq-sq"}

Statement prose, with math like `$f(x) = x^2$`.

### Proof {uses="thm:sumOdds-eq-sq"}

Proof sketch.
```

Then list it in `content/blueprint/_meta.json` (display order lives there).
No Lean required — items declare intended dependencies with `uses=` and render
gray/blue until formalized.

**Formalized (literate Lean).** When a chapter's code reads in narrative order,
[promote it](modes#the-promote-lifecycle): create `content/blueprint/Ch03_MyChapter.lean`
(the filename must be a valid module identifier), move the prose into `/-! ... -/`
doc blocks between the real declarations, delete the markdown file, and register
the module in `lakefile.toml` (`roots`), `blueprint.config.json` (`lakeRoots`),
and `_meta.json`.

## Pointing at your own Lean library

Existing code never moves. Add your library to `lakefile.toml` (e.g. a mathlib
`[[require]]`, matching `lean-toolchain`), set `lakeRoots` **and**
`leanSrcDirs` in `blueprint.config.json` (root modules, and where the `.lean`
sources sit — snippet lookup only searches the blueprint directory by
default), and write markdown chapters whose items carry
`lean="Your.Decl.Name"` — statuses, dependency edges, and source snippets
then come from your kernel data automatically. See
[the two authoring styles](modes) for when to choose which format, and
[work on an external Lean project](../tutorial/quick-start/work-on-external-project)
for the full adoption recipe — toolchain pinning, the mathlib cache, and
replacing the demo chapters.
