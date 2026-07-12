import assert from "node:assert/strict"
import test from "node:test"
import render from "preact-render-to-string"
import { isActive, pageTocItems, renderNavItem } from "./DocsExplorer.nav.tsx"

const toc = pageTocItems({
  toc: [
    { depth: 2, text: "Definition: sumOdds", slug: "#definition-sumodds" },
    { depth: 3, text: "Lemma: sumOdds-succ", slug: "lemma-sumodds-succ" },
  ],
})

test("DocsExplorer renders active page TOC only under the current nav node", () => {
  const item = {
    title: "Demo blueprint",
    slug: "blueprint/index",
    children: [
      { title: "Sums of odd numbers", slug: "blueprint/ch01_sumsofoddnumbers" },
      { title: "Further sums", slug: "blueprint/02-further-sums" },
    ],
  }
  const html = render(
    renderNavItem(
      "blueprint/ch01_sumsofoddnumbers",
      item,
      ["blueprint/index", "blueprint/ch01_sumsofoddnumbers", "blueprint/02-further-sums"],
      toc,
    ),
  )

  assert.equal(countMatches(html, 'class="docs-nav-page-toc"'), 1)
  assert.match(html, /href="#definition-sumodds"/)
  assert.match(html, /href="#lemma-sumodds-succ"/)

  const currentNode = html.indexOf("Sums of odd numbers")
  const pageToc = html.indexOf('class="docs-nav-page-toc"')
  const siblingNode = html.indexOf("Further sums")
  assert.ok(currentNode !== -1)
  assert.ok(pageToc !== -1)
  assert.ok(siblingNode !== -1)
  assert.ok(currentNode < pageToc)
  assert.ok(pageToc < siblingNode)
})

test("DocsExplorer does not render page TOC for active parent sections", () => {
  const item = {
    title: "Demo blueprint",
    slug: "blueprint/index",
    children: [{ title: "Sums of odd numbers", slug: "blueprint/ch01_sumsofoddnumbers" }],
  }
  const html = render(
    renderNavItem(
      "blueprint/index",
      item,
      ["blueprint/index", "blueprint/ch01_sumsofoddnumbers"],
      toc,
    ),
  )

  const controlledList = html.indexOf('<ul id="docs-nav-blueprint" class="docs-nav-children"')
  const childNode = html.indexOf("Sums of odd numbers")

  assert.ok(controlledList !== -1)
  assert.ok(childNode !== -1)
  assert.ok(controlledList < childNode)
  assert.doesNotMatch(html, /docs-nav-page-toc/)
})

test("DocsExplorer treats canvas nav pages as active on the canvas route", () => {
  const item = {
    title: "Dependency canvas",
    slug: "blueprint/dep-graph.canvas",
    pageType: "canvas",
  }
  const html = render(
    renderNavItem("blueprint/dep-graph.canvas", item, ["blueprint/dep-graph.canvas"], []),
  )

  assert.equal(isActive("blueprint/dep-graph.canvas", item), true)
  assert.match(html, /class="docs-nav-link active"/)
  assert.match(html, /class="docs-nav-page-kind docs-nav-page-kind-canvas"/)
  assert.match(html, /aria-label="Canvas page"/)
  assert.match(html, /Dependency canvas/)
})

function countMatches(text, needle) {
  return text.split(needle).length - 1
}
