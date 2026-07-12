---
title: "Two proof-writing styles"
description: "Where should your prose live relative to your code? Reference chapters, literate chapters, and the promote lifecycle."
---

Lean Workspace supports two styles of keeping the Lean code and the informal
proofs together: the **reference style** and the **literate style**. They share
one [grammar](../../documentation/grammar) and feed the same status model, so
the choice is purely about where your prose lives relative to your code — and
you can make it per chapter.

## Reference style

This style follows the design of
[leanblueprint](https://github.com/PatrickMassot/leanblueprint): the formal
Lean code and the informal proofs live in separate files, woven together into
one coherent document.

In Lean Workspace the informal side is a markdown chapter. A
[minimal grammar](../../documentation/grammar) on top of standard markdown
supplies the typical blueprint features — `uses=` for dependencies, `lean=` to
bind an item to declarations — and the chapter quotes the real Lean source of
those declarations directly on the page.

## Literate style

In [literate programming](https://en.wikipedia.org/wiki/Literate_programming),
code and prose share one file. Here that means writing the informal proofs in
`/-! ... -/` doc blocks inside the `.lean` file itself, between the real
declarations, with the [same item syntax](../../documentation/grammar) —
`lean=next` binds an item to the declaration that follows it.

Choose this style when the narrative and the code order are tied together:
pedagogy, demos, "one big theorem" projects, and the frontier chapter you are
actively formalizing this week.

| Your situation                                  | Style                                                   |
| ----------------------------------------------- | ------------------------------------------------------- |
| Existing library (mathlib-style, API-organized) | Reference — document/plan around untouched code         |
| New project driven by one main theorem          | Literate where the spine is linear; reference around it |
| Tutorial / pedagogical material                 | Literate                                                |
| Plan-stage chapter (no Lean yet)                | Markdown (necessarily) — promote later, or never        |
| Team with separate planner / formalizer roles   | Reference (merge-friendly, roles split cleanly)         |

## Mixing styles

A project can freely mix the two: `.md` and `.lean` chapters live side by side
in the same blueprint.

> [!Example]
> **How the style of one chapter typically evolves during formalization:**
>
> 1. **Start with markdown**: write the chapter in markdown; items carry
>    `uses=` intent and render gray/blue.
> 2. **Formalize**: write Lean (in `YourLib/` or wherever your library lives);
>    attach declarations to items with `lean=`. Nodes turn amber → green as
>    proofs land.
> 3. **Promote (optional)**: if the chapter's code reads in narrative order,
>    convert it to a literate `.lean` file: move prose into doc blocks, delete
>    the markdown file, register the module in `lakefile.toml` `roots`,
>    `blueprint.config.json` `lakeRoots`, and `_meta.json`. Chapters whose
>    code diverges from the story simply stay reference-style forever —
>    that's the design, not a failure mode.
