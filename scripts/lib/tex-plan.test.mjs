import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  expandMacros,
  parseEnvDirectives,
  parseMacroSources,
  parsePlanTex,
  resolveInputs,
  stripTexComments,
  yamlScalar,
} from "./tex-plan.mjs"

test("stripTexComments drops % comments but keeps \\%", () => {
  assert.equal(stripTexComments("a % gone\n50\\% kept"), "a \n50\\% kept")
})

test("resolveInputs inlines \\input chains recursively", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tex-plan-"))
  fs.mkdirSync(path.join(dir, "chapters"))
  fs.writeFileSync(
    path.join(dir, "content.tex"),
    "\\input{chapters/one}\n\\input{chapters/two.tex}\n",
  )
  fs.writeFileSync(path.join(dir, "chapters", "one.tex"), "\\chapter{One}\n\\input{three}\n")
  fs.writeFileSync(path.join(dir, "chapters", "three.tex"), "deep\n")
  fs.writeFileSync(path.join(dir, "chapters", "two.tex"), "\\chapter{Two}\n")
  const out = resolveInputs(path.join(dir, "content.tex"))
  assert.match(out, /\\chapter\{One\}/)
  assert.match(out, /deep/)
  assert.match(out, /\\chapter\{Two\}/)
  assert.doesNotMatch(out, /\\input/)
})

test("macro expansion: newcommand args, optional default, DeclareMathOperator", () => {
  const table = parseMacroSources([
    "\\newcommand{\\R}{\\mathbb{R}}\n" +
      "\\newcommand{\\norm}[1]{\\lVert #1 \\rVert}\n" +
      "\\newcommand{\\ball}[2][1]{B_{#1}(#2)}\n" +
      "\\DeclareMathOperator{\\Vol}{Vol}",
  ])
  assert.equal(expandMacros("\\R^d", table), "\\mathbb{R}^d")
  // word boundary: \Rho must not expand as \R + "ho"
  assert.equal(expandMacros("\\Rho", table), "\\Rho")
  assert.equal(expandMacros("\\norm{x}", table), "\\lVert x \\rVert")
  assert.equal(expandMacros("\\ball{c}", table), "B_{1}(c)")
  assert.equal(expandMacros("\\ball[r]{c}", table), "B_{r}(c)")
  assert.equal(expandMacros("\\Vol(B)", table), "\\operatorname{Vol}(B)")
  // nested: macro bodies using other macros expand across passes
  const nested = parseMacroSources(["\\newcommand{\\R}{\\mathbb{R}}\\newcommand{\\Rd}{\\R^d}"])
  assert.equal(expandMacros("\\Rd", nested), "\\mathbb{R}^d")
})

test("parseEnvDirectives strips directives and marker macros", () => {
  const out = parseEnvDirectives(
    "\\label{def:x}\\uses{a, b}\\mathlibok\n\\lean{Foo.bar}\\leanok\nBody stays.",
  )
  assert.equal(out.label, "def:x")
  assert.deepEqual(out.uses, ["a", "b"])
  assert.deepEqual(out.leanNames, ["Foo.bar"])
  assert.equal(out.leanok, true)
  assert.equal(out.mathlibok, true)
  assert.equal(out.tex, "Body stays.")
})

const PLAN = `
\\part{Part One}
\\chapter{Alpha}
Intro prose.
\\begin{definition}[Named]\\label{def:a}\\lean{A.a}
Statement A.
\\end{definition}
\\begin{lemma}\\label{lem:b}\\uses{def:a}
Statement B.
\\end{lemma}
\\begin{proof}\\uses{def:a}
Proof of B.
\\end{proof}
\\chapter{Proof of Theorem \\ref{thm:G}}
\\begin{theorem}\\label{thm:G}
Statement G.
\\end{theorem}
`

test("parsePlanTex: parts, gap prose, trailing proofs, nested-brace titles", () => {
  const { chapters, parts } = parsePlanTex(PLAN)
  assert.deepEqual(
    parts.map((p) => p.title),
    ["Part One"],
  )
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, "Alpha")
  // heading titles may nest one brace level
  assert.equal(chapters[1].title, "Proof of Theorem \\ref{thm:G}")
  const [defA, lemB] = chapters[0].items
  assert.equal(defA.caption, "Named")
  assert.deepEqual(defA.leanNames, ["A.a"])
  assert.equal(lemB.proof.tex, "Proof of B.")
  assert.deepEqual(lemB.proof.uses, ["def:a"])
  // gap prose is preserved in order
  assert.equal(chapters[0].blocks[0].type, "prose")
  assert.match(chapters[0].blocks[0].tex, /Intro prose/)
})

test("parsePlanTex: --chapter-level=section (plastex split-level=1)", () => {
  const src = "\\section{S1}\\begin{lemma}\\label{l}\nx\n\\end{lemma}\\section{S2}"
  const { chapters } = parsePlanTex(src, { chapterCmd: "section" })
  assert.deepEqual(
    chapters.map((c) => c.title),
    ["S1", "S2"],
  )
  assert.equal(chapters[0].items.length, 1)
})

test("yamlScalar single-quotes so LaTeX backslashes survive", () => {
  assert.equal(yamlScalar("Finite variation, $\\mathcal{V}$"), "'Finite variation, $\\mathcal{V}$'")
  assert.equal(yamlScalar("it's"), "'it''s'")
})
