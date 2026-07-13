import { test } from "node:test"
import assert from "node:assert/strict"
import { parseMacroSources } from "./lib/tex-plan.mjs"
import { buildNativeChapters } from "./migrate-blueprint.mjs"

const PLAN = `
\\part{One}
\\chapter{Gaussian measures}
Intro prose with a ref to \\Cref{def:IsGaussian}.
\\section{Basics}
\\begin{definition}[Gaussian measure, $\\mathcal{N}$]\\label{def:IsGaussian}\\lean{P.IsGaussian}\\mathlibok
A measure on \\R\\ is Gaussian.
\\end{definition}
\\begin{remark}\\label{rem:bundle}\\uses{def:IsGaussian}
Bundled as a structure.
\\end{remark}
\\begin{lemma}\\label{lem:map}\\lean{P.map}\\uses{def:IsGaussian, def:missing}
Pushforwards stay Gaussian, see~\\eqref{eq:nowhere}.
\\end{lemma}
\\begin{proof}\\uses{def:IsGaussian}
Immediate: \\[ L_* \\mu = \\nu. \\]
\\end{proof}
\\chapter{Proof of Theorem \\ref{lem:map}}
\\begin{proof}
An orphan proof block.
\\end{proof}
`

const MACROS = parseMacroSources(["\\newcommand{\\R}{\\mathbb{R}}"])

test("buildNativeChapters: native items, kinds, uses hygiene, proofs", () => {
  const { files, meta, parts, stats, warnings } = buildNativeChapters(PLAN, {
    label: "Test blueprint",
    macros: MACROS,
  })
  assert.deepEqual(
    parts.map((p) => p.title),
    ["One"],
  )
  assert.equal(files.length, 2)
  assert.equal(files[0].name, "1-gaussian-measures.md")

  const ch1 = files[0].content
  // YAML-safe single-quoted title; native heading syntax with lean=/uses=
  assert.match(ch1, /title: 'Gaussian measures'/)
  assert.match(
    ch1,
    /## Definition: Gaussian measure, \$\\mathcal\{N\}\$ \{#def:IsGaussian lean="P\.IsGaussian"\}/,
  )
  // remark mapped to definition, with provenance line
  assert.match(ch1, /## Definition: bundle \{#rem:bundle uses="def:IsGaussian"\}/)
  assert.match(ch1, /_Stated as a remark in the original blueprint\._/)
  // macro expanded; \section header became a bold paragraph; \Cref -> link
  assert.match(ch1, /\\mathbb\{R\}/)
  assert.match(ch1, /\*\*Basics\*\*/)
  assert.match(ch1, /\[Gaussian measure, \$\\mathcal\{N\}\$\]\(#def:IsGaussian\)/)
  // unknown uses target dropped, with warning; known one kept
  assert.match(ch1, /## Lemma: map \{#lem:map lean="P\.map" uses="def:IsGaussian"\}/)
  assert.ok(warnings.some((w) => w.includes("def:missing")))
  // proof section with its uses=, display math converted
  assert.match(ch1, /### Proof \{uses="def:IsGaussian"\}/)
  assert.match(ch1, /\$\$\nL_\* \\mu = \\nu\.\n\$\$/)
  // unknown \eqref degrades to plain text
  assert.match(ch1, /\(eq:nowhere\)/)

  // chapter-title \ref resolved to the item's display name
  assert.equal(files[1].name, "2-proof-of-theorem-map.md")
  // orphan proof kept as quoted prose
  assert.match(files[1].content, /> \*\*Proof\.\*\* An orphan proof block\./)
  assert.equal(stats.orphanProofs, 1)

  // _meta.json: label + chapters, and NO dep-graph entry until the first sync
  assert.equal(meta.label, "Test blueprint")
  assert.deepEqual(
    meta.pages,
    ["1-gaussian-measures.md", "2-proof-of-theorem-map.md"].map((f) => f.replace(/\.md$/, "")),
  )

  assert.equal(stats.items, 3)
  assert.equal(stats.withLean, 2)
  assert.equal(stats.mathlibok, 1)
})

test("buildNativeChapters: --chapter-level=section for split-level-1 plans", () => {
  const src =
    "\\section{Packings}\\begin{definition}\\label{d}\\lean{X.d}\nBody.\n\\end{definition}\\subsection{Sub}"
  const { files } = buildNativeChapters(src, { chapterCmd: "section", label: "L" })
  assert.equal(files.length, 1)
  assert.match(files[0].content, /title: 'Packings'/)
  // subsection (not section) becomes the bold in-chapter header
  assert.match(files[0].content, /\*\*Sub\*\*/)
})

test("texToMd via buildNativeChapters: inline $$ blocks get their own delimiter lines", () => {
  const src =
    "\\chapter{C}\\begin{definition}\\label{d}\nGiven $$X = \\begin{cases} 1 \\\\ 0 \\end{cases}$$ we win.\n\\end{definition}"
  const { files } = buildNativeChapters(src, { label: "L" })
  // remark-math needs the closing $$ alone on its line; inline-styled blocks
  // used to swallow the rest of the page as one unclosed math block
  assert.match(files[0].content, /\n\$\$\nX = \\begin\{cases\} 1 \\\\ 0 \\end\{cases\}\n\$\$\n/)
})

test("citations: pandoc syntax with sanitized keys; thebibliography truncates", () => {
  const src =
    "\\chapter{C}\\begin{definition}\\label{d}\nSee \\cite[Thm 2]{first course, Beiglböck2011}.\n\\end{definition}\n\\putbib\n\\begin{thebibliography}{9}\\bibitem{x} X.\\end{thebibliography}\nPostamble junk with \\badmacro that must not leak.\n"
  const { files, warnings } = buildNativeChapters(src, { label: "L" })
  assert.match(files[0].content, /\[@first-course; @Beiglbock2011, Thm 2\]/)
  assert.doesNotMatch(files[0].content, /Postamble junk|thebibliography|putbib/)
  assert.ok(warnings.some((w) => w.includes("thebibliography")))
})
