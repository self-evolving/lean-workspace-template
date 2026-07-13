import { test } from "node:test"
import assert from "node:assert/strict"
import { fm, parseChapterToc } from "./import-blueprint.mjs"

test("fm emits single-quoted YAML so LaTeX math in titles survives", () => {
  const out = fm({ title: "Finite variation process, $\\mathcal{V}$", n: 3, tags: ["a'b"] })
  assert.match(out, /title: 'Finite variation process, \$\\mathcal\{V\}\$'/)
  assert.match(out, /n: 3/)
  assert.match(out, /- 'a''b'/)
})

const li = (num, title, href, sub = "") =>
  `<li><a href="${href}"><span class="toc_ref">${num}</span> <span class="toc_entry">${title}</span></a>${sub}</li>`

// Flat layout (no \part): chapters sit at sub-toc-0, sections below are
// "N.M"-numbered and must be ignored.
const FLAT_TOC = `<div class="toc"><ul class="sub-toc-0">
${li("1", "Sphere packings", "sect0001.html", `<ul class="sub-toc-1">${li("1.1", "Basics", "sect0001.html#s1")}</ul>`)}
${li("2", "Density", "sect0002.html")}
</ul></div>`

// \part layout: parts at sub-toc-0 carry bare integers too; the chapters sit
// one level down with globally-running numbers.
const PART_TOC = `<div class="toc"><ul class="sub-toc-0">
${li("1", "Brownian motion", "sect0001.html", `<ul class="sub-toc-1">${li("1", "Characteristic functions", "sect0002.html")}${li("2", "Stochastic processes", "chap-process.html")}</ul>`)}
${li("2", "Stochastic integral", "sect0003.html", `<ul class="sub-toc-1">${li("3", "Elementary integrals", "chap-elementary.html")}</ul>`)}
</ul></div>`

test("parseChapterToc: flat TOC reads chapters at the top level", () => {
  const chapters = parseChapterToc(FLAT_TOC)
  assert.equal(chapters.get(1).title, "Sphere packings")
  assert.equal(chapters.get(2).title, "Density")
  assert.equal(chapters.get(2).file, "sect0002.html")
  assert.equal(chapters.size, 2)
})

test("parseChapterToc: \\part TOC reads chapters one level down, not the parts", () => {
  const chapters = parseChapterToc(PART_TOC)
  assert.equal(chapters.size, 3)
  assert.equal(chapters.get(1).title, "Characteristic functions")
  assert.equal(chapters.get(2).title, "Stochastic processes")
  assert.equal(chapters.get(3).title, "Elementary integrals")
  assert.equal(chapters.get(3).file, "chap-elementary.html")
})
