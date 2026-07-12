---
title: "Demo proof"
description: "Blueprint-as-source demo: literate Lean chapters + markdown plan chapters, statuses computed from the kernel."
type: "blueprint-index"
tags:
  - "blueprint"
---

This blueprint **is** its own source: the files in this folder are simultaneously
the plan, the prose, and (for formalized chapters) the actual Lean code that
`lake build` typechecks.

**[→ Dependency graph (canvas)](dep-graph.canvas)**

## Chapters

- [Sums of odd numbers](ch01_sumsofoddnumbers) — literate Lean chapter (`Ch01_SumsOfOddNumbers.lean`): real declarations interleaved with prose
- [Further sums](02-further-sums) — plan-stage markdown chapter (no code yet)

## How it works

- Chapter statuses are computed from the Lean kernel (`blueprint-data.json`,
  written by `lake exe blueprint-data`) — a node is dark green only when its
  proof *and everything it depends on* compile without `sorry`.
- Edit a chapter file and save: the page hot-reloads. Statuses refresh after:

```bash
lake build && npm run blueprint:sync
```
