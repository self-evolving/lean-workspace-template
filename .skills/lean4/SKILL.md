---
name: lean4
description: Use for Lean 4, mathlib, Lake, .lean files, blueprint proof review, Lean diagnostics, or learning Lean concepts in this Sepo workspace. This skill is prompt-only and read-only by default.
argument-hint: "[learn|review|doctor] [topic|path|options]"
allowed-tools: Bash, Read, Glob, Grep
---

# Lean 4 Sepo Skill

This is a small Sepo-native adaptation of
`cameronfreer/lean4-skills`. It reuses the upstream prompt ideas for learning,
review, and diagnostics, but intentionally does not import the upstream parser,
hooks, script library, subagents, slash-command adapter, checkpoint commits, or
autonomous proof-editing workflows.

Invoke it as:

```text
@sepo-agent /skill lean4 learn <topic-or-path>
@sepo-agent /skill lean4 review <path-or-scope>
@sepo-agent /skill lean4 doctor
```

## Command Selection

Read the matching command note before starting detailed work:

| User intent                                                     | Command note         | Sepo behavior                                              |
| --------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| Learn a Lean concept, explore this repo, or navigate mathlib    | `commands/learn.md`  | Read-only explanation and best-effort Lean-backed examples |
| Review Lean proofs, sorries, style, build status, or proof risk | `commands/review.md` | Read-only review with findings first                       |
| Diagnose Lean/Lake, skill availability, or workspace setup      | `commands/doctor.md` | Read-only diagnostic report                                |

If the user asks this skill to edit files, fill sorries, formalize a theorem, or
commit a checkpoint, explain the plan and recommend a Sepo `/implement` request
for the mutating work. If already running on an implementation route, use the
principles below with the normal Sepo edit, verification, and PR workflow.

## Sepo Integration Rules

- Use repository memory when available. Read `$MEMORY_DIR/PROJECT.md`,
  `$MEMORY_DIR/MEMORY.md`, recent daily notes, or relevant mirrored GitHub
  artifacts for Lean conventions and prior decisions.
- Write memory only for stable lessons such as accepted project conventions,
  recurring build gotchas, or reusable proof patterns. Do not store temporary
  failed tactics, proof counters, or scratch goals.
- Keep durable math facts in the `Math` section of `$MEMORY_DIR/MEMORY.md` —
  verified mathlib declarations (name plus module), dated absence findings,
  theorems proved in this repository, reusable proof patterns. Read it as
  prior context before mathlib lookups; revalidate absence entries with the
  current search protocol before repeating them. See "Math memory" in
  `AGENTS.md`.
- Do not run `git commit`, create checkpoint commits, or stage broad file sets.
  Sepo workflows own branches, commits, and pull requests.
- Keep generated and vendored directories out of broad searches unless directly
  relevant: `.git/`, `node_modules/`, `.agent/node_modules/`, `dist/`,
  `.agent/dist/`, `.lake/build/`.
- Prefer repo-local evidence over assumptions. This template uses Lean and
  Quartz together: primary Lean content lives under `content/blueprint/`,
  adopted project libraries at the repo root (e.g. `YourLib/`), and the
  extractor machinery under `scripts/blueprint-data/`.

## Lean Principles

- Search before proving. Many facts already exist in mathlib or local helpers.
- Build incrementally. Lean/Lake checks are the source of truth.
- Respect scope. If a file, declaration, or line is requested, stay there unless
  dependencies require a wider look.
- Do not change theorem statements, declarations, docstrings, or axioms without
  explicit user approval.
- Use Lean/mathlib style: clear names, local helper lemmas when useful, and
  roughly 100-character line width for Lean code.
- Prefer LSP tools if the active host exposes them. Otherwise use repository
  tools such as `rg`, `lean --version`, `lake --version`, `lake env lean <file>`,
  and narrowly scoped `lake build` checks.
- For mathlib lookup, distinguish exact declaration verification from semantic
  discovery. Do not conclude that a declaration is absent from mathlib after
  only a local search, missing import, or failed check in a workspace without
  mathlib available.

## Output Expectations

- State the command interpretation, scope, and checks run.
- For reviews, lead with findings ordered by severity and include file/line
  references when available.
- For learning, separate verified Lean facts from best-effort explanation.
- For diagnostics, report actionable blockers before environment details.
- Keep final responses concise and make any next route explicit, for example
  "open an `/implement` request to apply this proof plan."

## Attribution

This skill is adapted from `cameronfreer/lean4-skills`, licensed under MIT.
See `LICENSE` in this directory.
