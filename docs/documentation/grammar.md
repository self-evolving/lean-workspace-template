---
title: "Chapter grammar"
description: "The complete syntax: chapter formats, item headings and attributes, dependency inference, proofs, cross-references, and code blocks."
---

One grammar serves both chapter formats. A chapter is a sequence of **items**
introduced by attributed headings; everything else is ordinary markdown prose
(with KaTeX math via `$...$` and `$$...$$`).

> [!note]- What prose is allowed?
> Ordinary markdown: paragraphs, lists, tables, callouts, links, and inline
> code (backticked Lean like `` `s a ⊆ Ω a` `` renders verbatim — Unicode is
> fine). Math must use the KaTeX delimiters `$...$` (inline) and `$$...$$`
> (display): the LaTeX forms `\[...\]` and `\(...\)` are **not** recognized
> and will render as literal text. leanblueprint macros (`\label`, `\uses`,
> `\lean`, `\leanok`) have no meaning in chapters — their jobs are done by
> heading attributes and the kernel.

## Chapter formats

**Markdown chapter** (`02-further-sums.md`): Quartz frontmatter with a `title`,
**no `# H1`** in the body, then intro prose and items.

```markdown
---
title: "Further sums"
---

Intro prose.

## Definition: triangular {#def:triangular}

...
```

**Literate Lean chapter** (`Ch01_SumsOfOddNumbers.lean`): prose lives in top-level
`/-! ... -/` doc blocks; real declarations sit between them. The first doc block
starts with the chapter's `# Title`.

```lean
/-! # Sums of odd numbers

Chapter intro prose.

## Definition: sumOdds {#def:sumOdds lean=next}

Statement prose.
-/

namespace Demo

/-- docstring -/
def sumOdds : Nat → Nat := ...
```

Literate-chapter rules:

- The filename must be a valid **module identifier** (`Ch01_SumsOfOddNumbers.lean`),
  registered in `lakefile.toml` (`roots`), `blueprint.config.json` (`lakeRoots`),
  and `_meta.json`.
- Doc blocks must not contain a literal `-/`.
- Code before the first doc block (imports, `set_option`s) is not rendered.
- `lean=next` binds the item to the **first declaration after the doc block**
  (namespace-aware: `namespace Demo` … `end Demo` prefixes are tracked).

## What you write vs. what is computed

The authoring surface is deliberately small. **You write:** the heading (kind,
display name, `{#label}`), the prose, `lean=` once an item is formalized, and
`uses=` only in the three situations listed below. **Everything else is
computed:** statuses and colors (from the kernel — never hand-maintained),
dependency edges (inferred from the actual proof terms when `lean=` is
present), item numbering, and source-code blocks.

## Items

```text
## Kind: Display Name {#label attr=value ...}
```

- `Kind` ∈ `definition` | `lemma` | `proposition` | `theorem` | `corollary`.
- `Display Name` is free text (shown in titles, pills, canvas cards).
- `{#label}` is **required** and unique across the blueprint; the convention is
  `kind:name`, e.g. `#thm:sumOdds-eq-sq`. The label is the cross-reference and
  anchor identity of the item. It looks redundant with the display name, but it
  is the item's _stable_ identity: you can rename the display text freely
  without breaking cross-references, `uses=` lists, or canvas links.

### Item attributes

| attribute        | meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `#label`         | item identity (required)                                                                            |
| `lean="A, B"`    | the Lean declaration(s) realizing this item; `lean=next` (literate only) binds the next declaration |
| `uses="a, b"`    | statement-level dependencies, by label — **optional for formalized items** (see below)              |
| `discussion=123` | links the item to GitHub issue #123 (repo from `blueprint.config.json`)                             |
| `code=none`      | suppress the automatic source block for this item                                                   |

## Dependencies: inferred from the kernel

When an item has `lean=` and its declarations are found in the kernel data, its
dependency edges are **inferred from the actual term**: type-level constants become
statement edges (dashed), proof-term constants become proof edges (solid);
definitions fold everything into statement-level.

Explicit `uses=` **overrides** inference for that part. You write it in exactly
three situations:

1. **Plan-stage items** — no Lean yet, so declare intent: `uses="def:foo"`.
2. **Sorry'd proofs** — a `sorry` has no proof term to infer from, so the Proof
   heading declares the intended dependencies (see
   [the open demo lemma](../../blueprint/ch01_sumsofoddnumbers#lemmasumodds-pos)).
3. **Pruning** — drop an incidental kernel edge you don't want in the narrative:
   an explicit `uses=` replaces the inferred list for that part, so list only what
   you want to keep — `uses=""` prunes every inferred edge.

Explicit overrides may intentionally omit inferred dependencies to prune the
narrative graph. `plan/kernel:` warnings are reserved for explicit `uses=` labels
that the kernel did not infer on a sorry-free declaration.

## Proofs

```text
### Proof {uses="lemma:helper"}
```

A `### Proof` heading after an item holds the prose proof. Its `uses=` are
**proof-level** (solid) edges — also optional for sorry-free formalized items.

## Cross-references

`[the unfolding lemma](#lemma:sumOdds-succ)` — a link whose target is `#` + an item
label resolves to the owning chapter page and anchor, from any chapter. With empty
link text, the item's numbered title is filled in automatically.

## Code blocks

- **Literate chapters**: code is in situ — every declaration between doc blocks
  renders as a highlighted Lean block, in place.
- **Markdown chapters**: items with `lean=` get their declaration's real source
  pulled onto the page automatically (file + line range from the kernel data;
  `code=none` opts out). For curated snippets:

````markdown
```lean decl=Demo.sumOdds_eq_sq

```

```lean anchor=MY_ANCHOR

```
````

`decl=` inlines a declaration's source by name; `anchor=` inlines a region marked
in any Lean source file with `-- ANCHOR: MY_ANCHOR` / `-- ANCHOR_END: MY_ANCHOR`
comments.
