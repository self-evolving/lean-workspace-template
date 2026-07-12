---
title: "Lean Workspace"
description: "Blueprint-as-source: the blueprint folder is simultaneously the plan, the prose, and the Lean code — typechecked by Lake, rendered by Quartz, statuses computed from the kernel."
---

# Lean Workspace

**Blueprint-as-source**: the files in [`blueprint/`](blueprint/) are simultaneously the
plan, the prose, and (for formalized chapters) the **actual Lean code** that
`lake build` typechecks. Markdown chapters plan; literate `.lean` chapters formalize —
prose in `/-! -/` doc blocks, real declarations between them, full IDE while editing.
Statuses are computed from the Lean kernel: a node is dark green only when its proof,
and everything it transitively depends on, compiles without `sorry`.

## Start here first

- **[Dependency graph (canvas)](blueprint/dep-graph.canvas)** — pan/zoom; hover a card
  to highlight its direct dependencies, click a title to jump to the item in its chapter.
- [Demo proof](blueprint/) — one literate Lean chapter, one plan-stage markdown chapter.

## Using this as a template

- [Quick start](https://lean-workspace.sepo.site/tutorial/quick-start) — from clone to your first green node.
- [The two authoring styles](https://lean-workspace.sepo.site/documentation/modes) — where should your prose live relative to your code?
- [Chapter grammar](https://lean-workspace.sepo.site/documentation/grammar) — items, attributes, dependency inference, cross-refs, code blocks.
- [Reference](https://lean-workspace.sepo.site/documentation/reference) — configuration, status model, CI, troubleshooting.

## The loop

```bash
lake build                  # typecheck (blueprint chapters ARE Lake source)
npm run dev                 # edit a chapter, save -> the page hot-reloads

# after Lean changes, refresh statuses + canvas:
lake build && npm run blueprint:sync
```

CI runs the same loop on every push and commits back `blueprint-data.json` and
`dep-graph.canvas` — a PR that proves a lemma shows its node turning green in its own diff.
