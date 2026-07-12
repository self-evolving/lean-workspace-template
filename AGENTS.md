# Agent Instructions

This repository is a Lean workspace template with a shipped example blueprint.

When implementing a user-requested change that adapts the template for a real
project, remove the existing template blueprint and replace it with content that
follows the user's requirements. Do not keep the shipped example blueprint as
placeholder material unless the user explicitly asks to preserve it.

Keep the related blueprint files in sync with the replacement, including
`content/blueprint/`, blueprint metadata, `blueprint.config.json`, Lake roots,
and generated blueprint data or canvas artifacts when those files are affected.

## Working Locally

- The local site (`npm run dev`) renders **this repository's** `content/` —
  the blueprint page shows `content/blueprint/` and nothing else. A checkout
  of another project in `/tmp` (or anywhere outside this repo) will never
  appear on the canvas. To work on an external repository, issue, or PR,
  adopt it into the workspace:
  `docs/tutorial/quick-start/work-on-external-project.md`.
- A planning DAG belongs in `content/blueprint/` as a plan-stage markdown
  chapter with `uses=` edges — never as a standalone HTML page; the canvas is
  the intended rendering.
- `blueprint-data.json` and `dep-graph.canvas` are machine-managed: never edit
  them by hand; regenerate with `lake build && npm run blueprint:sync`.
- If a project requires mathlib, run `lake exe cache get` before the first
  `lake build` — never compile mathlib from source.
- After CI runs on a PR branch, `git pull --ff-only` before committing more
  local work: for same-repository branches, CI pushes regenerated blueprint
  data back to the branch (fork PRs are validated only — nothing is pushed
  back to them).

## Pull Requests

For user-submitted pull requests, add the `agent/review` label or comment
`@sepo-agent /review` on the PR to launch a Sepo review. Add the `sepo-preview`
label to request a preview deployment for a non-agent PR.

## Lean Work

For Lean 4, Lake, mathlib, `.lean` files, blueprint proof review, or Lean
workspace diagnostics, use the repository `lean4` skill under `.skills/lean4`.

**Mathlib lookups on any route** — including plain `@sepo-agent` questions:
never claim a declaration is absent from mathlib based on local search alone.
Check the mathlib4 docs find endpoint
(`https://leanprover-community.github.io/mathlib4_docs/find/?pattern=<name>`)
and [LeanSearch](https://leansearch.net/) first; the full layered protocol is
in `.skills/lean4/commands/learn.md`.

The Lean skill is read-only by default for `learn`, `review`, and `doctor`
workflows. Mutating proof work, formalization, sorry filling, or file edits
should go through the normal Sepo `/implement` workflow so changes are verified
and proposed by PR.

On `/implement` and `/fix-pr` runs that touch Lean, task dispatches stay plain
— the routing lives here, not in the request:

- **Any Lean edit** (prove, formalize, fill a sorry): read
  `.skills/lean4/SKILL.md` first and apply its Lean Principles (search mathlib
  before proving, build incrementally, respect scope) within the normal Sepo
  edit-verify-PR workflow.
- **Proof golf / cleanup**: same skill; additionally keep statements and names
  unchanged, introduce no new `sorry` or axioms, and verify with
  `lake build && npm run blueprint:sync` before proposing.
- **Blueprint planning** (skeleton before any Lean): author plan-stage markdown
  chapters under `content/blueprint/` per
  `docs/documentation/grammar.md` (items with `uses=` edges) and
  `docs/documentation/modes.md`; list new chapters in `_meta.json`.

**Math memory** — when repository memory is available (`$MEMORY_DIR`), keep a
`Math` section in `MEMORY.md`. Read it before mathlib lookups as prior
context: a recorded declaration gives your exact-name check its target, and a
recorded absence says a past search failed — but mathlib moves, so never
repeat an absence claim from memory alone; rerun the protocol above. After
Lean work that settles something durable, record one terse bullet per fact:

- a mathlib declaration you verified: full name plus module, e.g.
  `ProbabilityTheory.minimaxRisk — Mathlib.Probability.Decision.Risk.Defs`
- a declaration confirmed absent from mathlib: the sources checked, the date
  or mathlib revision, and the workaround used
- a theorem proved in this repository: blueprint label plus file
- a reusable proof pattern or tactic sequence that took real effort to find

Add entries with
`node .agent/dist/cli/memory/update.js add --dir "$MEMORY_DIR" --file MEMORY.md --section Math "<bullet>"`;
if the file exists but has no `Math` section yet, create the `## Math` heading
directly. Skip facts that are obvious from the code or likely to go stale.
