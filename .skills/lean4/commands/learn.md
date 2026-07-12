---
name: learn
description: Read-only Lean teaching, repository exploration, and mathlib navigation for Sepo skill runs.
argument-hint: "[topic] [--mode=auto|repo|mathlib] [--style=tour|socratic|exercise]"
---

# Lean4 Learn

Use this note when the user wants to understand Lean code, a theorem, a tactic,
this repository's Lean layout, or the mathlib neighborhood around a topic.

## Inputs

| Input      | Default | Meaning                                                     |
| ---------- | ------- | ----------------------------------------------------------- |
| `topic`    | none    | Free-text topic, theorem name, file path, or informal claim |
| `--mode`   | `auto`  | `repo`, `mathlib`, or `auto`                                |
| `--style`  | `tour`  | `tour`, `socratic`, or `exercise`                           |
| `--source` | none    | Optional local path or URL supplied by the user             |

Treat unsupported upstream flags as plain user intent rather than parser
errors. If a requested output would write files, keep the skill response in
chat and suggest `/implement` for the file-changing follow-up.

## Workflow

1. Resolve the mode.
   - Existing `.lean` path or local declaration: use `repo`.
   - Clear mathlib concept, theorem, namespace, or tactic: use `mathlib`.
   - Ambiguous topic: ask one short clarifying question.
2. Discover evidence.
   - `repo`: inspect `lean-toolchain`, `lakefile.toml`, `content/blueprint/`,
     any adopted root libraries, and targeted `.lean` files. Use `rg` for
     declarations and usages.
   - `mathlib`: use the layered search protocol below. Treat local search as
     incomplete when this workspace has no mathlib checkout or dependency.
   - `source`: read local files directly. For remote sources, use available
     repository or web tooling; if unavailable, ask for an excerpt.
3. Explain at the requested style.
   - `tour`: concise walkthrough with key declarations and examples.
   - `socratic`: ask focused questions before giving full answers.
   - `exercise`: give a small task, then provide a checked reference solution
     when possible.
4. Label verification.
   - `verified`: checked against Lean/Lake or exact source.
   - `partially verified`: supported by local source inspection but not compiled.
   - `unverified`: conceptual explanation or missing local tool support.

## Mathlib Search Protocol

Use this protocol for `--mode=mathlib` and for `auto` requests that name or
describe a mathlib theorem, definition, namespace, or tactic. When repository
memory is available, read the `Math` section of `$MEMORY_DIR/MEMORY.md` first
as prior context: a recorded declaration gives your exact-name check its
target, and a recorded absence says a past search failed. Memory never
replaces the protocol for a current absence claim — mathlib moves, so rerun
the steps below before repeating one.

1. Classify the query.
   - Exact declaration name: fully qualified names such as
     `ProbabilityTheory.minimaxRisk`, short names, or import/module candidates.
   - Semantic query: an informal theorem statement, tactic need, or concept.
2. Verify exact names first when possible.
   - If mathlib is available locally, prefer Lean-backed checks such as:

     ```lean
     import Mathlib
     #check ProbabilityTheory.minimaxRisk
     #print ProbabilityTheory.minimaxRisk
     ```

   - If local mathlib is not available, use exact external sources before
     deciding anything is missing:
     `https://leanprover-community.github.io/mathlib4_docs/find/?pattern=<name>`,
     the resulting declaration page, and targeted source search in
     `leanprover-community/mathlib4` when repository search is available.

3. Use semantic discovery for vague queries or when exact-name checks fail.
   - Search LeanSearch (`https://leansearch.net/`) for natural-language
     statements, theorem shapes, and related declarations.
   - Use other available mathlib search tools, such as Loogle, as secondary
     evidence when LeanSearch results are ambiguous.
   - Search local `.lake/packages/mathlib` with `rg` when present, but do not
     treat its absence as evidence about upstream mathlib.
4. Report confidence and checked sources.
   - `verified by Lean`: kernel/LSP check succeeded in the current workspace.
   - `found in exact source`: exact docs/source declaration found, but not
     locally compiled.
   - `semantic candidate`: search result likely relevant but not exact or
     checked.
   - `not found in checked sources`: list the sources checked. Do not say
     "not in mathlib" unless exact docs/source search and at least one semantic
     search were both checked; otherwise say "not found locally" or "not
     verified with available tools."

## Output

Start with the resolved scope and any checks run. Prefer short Lean snippets
over long copied source. End with the most useful next step, such as a review
scope, a proof plan, or an `/implement` request for edits.
