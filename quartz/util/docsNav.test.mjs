import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { buildDocsNav } from "./docsNav.mjs"

test("buildDocsNav includes explicit canvas pages from _meta.json", (t) => {
  const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docs-nav-"))
  t.after(() => fs.rmSync(docsRoot, { recursive: true, force: true }))

  fs.writeFileSync(
    path.join(docsRoot, "_meta.json"),
    JSON.stringify({
      label: "Demo blueprint",
      pages: [{ page: "dep-graph", type: "canvas", title: "Dependency canvas" }, "chapter"],
    }),
  )
  fs.writeFileSync(path.join(docsRoot, "dep-graph.canvas"), '{"nodes":[],"edges":[]}\n')
  fs.writeFileSync(path.join(docsRoot, "chapter.md"), "---\ntitle: Chapter one\n---\n\nContent\n")

  const nav = buildDocsNav({ docsRoot, slugPrefix: "blueprint" })

  assert.deepEqual(nav.items, [
    { title: "Dependency canvas", slug: "blueprint/dep-graph.canvas", pageType: "canvas" },
    { title: "Chapter one", slug: "blueprint/chapter" },
  ])
})
