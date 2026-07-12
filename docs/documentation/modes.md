---
title: "The two authoring styles"
description: "Where should your prose live relative to your code? Reference chapters, literate chapters, and the promote lifecycle."
---

A blueprint is **chapters of items**: definitions, lemmas, theorems, and related
results. Every chapter uses the same [grammar](grammar) and feeds the same
kernel-computed status model. The main authoring decision is where the prose
lives relative to the Lean code.

## Reference style

A markdown chapter can reference declarations that live in ordinary Lean modules
with `lean="Full.Decl.Name"`. The chapter pulls each declaration's real source
onto the page automatically, while statuses and dependency edges come from the
kernel.

- Works plan-first, then formalize later.
- Also works documentation-after for an existing library.
- Keeps code organization free: refactors do not rewrite prose, helper lemmas can
  stay out of the narrative, and one item can stand for several declarations.

The tradeoff is that prose claims can drift from the code. Statuses and snippets
remain pinned to the kernel, but the surrounding explanation still needs review.

## Literate style

A literate chapter is a `.lean` file with prose in `/-! ... -/` doc blocks
between real declarations.

- Full Lean IDE support while writing: goals, errors, and infoview in the same
  buffer as the prose.
- Drift is much harder because the chapter text and declarations live together.
- `lean=next` can bind an item to the declaration that follows it, so most
  annotations disappear.

The tradeoff is that the code structure is tied to the narrative. Refactoring code
often means rewriting the document.

## Deciding

| Your situation                            | Style                                       |
| ----------------------------------------- | ------------------------------------------- |
| Existing library with API-organized code  | Reference                                   |
| New project driven by one main theorem    | Literate for the spine, reference around it |
| Tutorial or pedagogical material          | Literate                                    |
| Plan-stage chapter with no Lean yet       | Markdown/reference                          |
| Separate planning and formalization roles | Reference                                   |

This is a per-chapter choice. A real project can mix reference chapters and
literate chapters freely.

## The promote lifecycle

1. **Plan**: write the chapter in markdown; items carry `uses=` intent and render
   gray or blue.
2. **Formalize**: write Lean in your library directory (e.g. `YourLib/` at the
   repo root); attach declarations to items with `lean=`.
3. **Promote**: when the chapter's code reads in narrative order, convert it to a
   literate `.lean` file. Move prose into `/-! ... -/` doc blocks, delete the
   markdown file, register the module in `lakefile.toml`, register it in
   `blueprint.config.json` `lakeRoots`, and list it in `_meta.json`.

Chapters whose code diverges from the story can stay reference-style forever.

## Page layout

`pageMode` in [reference](reference#blueprintconfigjson) chooses how items render:
`chapter` keeps items as anchored sections on chapter pages, while `item` renders
one page per item for legacy importer workflows.
