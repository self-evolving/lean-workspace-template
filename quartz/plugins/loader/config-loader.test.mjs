import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { h } from "preact"
import render from "preact-render-to-string"
import { componentRegistry } from "../../components/registry.ts"

function testComponent(name) {
  const Component = () => h("div", { "data-component": name }, name)
  Component.displayName = name
  return Component
}

const props = {
  ctx: { cfg: { plugins: { emitters: [] } } },
  externalResources: { css: [], js: [], additionalHead: [] },
  fileData: { slug: "test-page", frontmatter: {} },
  cfg: {
    baseUrl: "example.com",
    locale: "en-US",
    pageTitle: "Test",
    theme: {
      cdnCaching: false,
      fontOrigin: "local",
    },
  },
  children: [],
  tree: { type: "root", children: [] },
  allFiles: [],
}

test("loader preserves grouped desktop and standalone mobile layout placements", async (t) => {
  const originalCwd = process.cwd()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-loader-layout-"))

  t.after(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  fs.writeFileSync(
    path.join(tempDir, "quartz.config.yaml"),
    `configuration:
  pageTitle: Test
plugins:
  - source: repeated-widget
    enabled: true
    layout:
      - position: left
        priority: 30
        group: toolbar
        display: desktop-only
      - position: left
        priority: 20
        display: mobile-only
layout:
  groups:
    toolbar:
      gap: 0.5rem
`,
  )

  componentRegistry.register("repeated-widget", testComponent("repeated-widget"), "test")

  process.chdir(tempDir)
  const { loadQuartzLayout } = await import("./config-loader.ts")
  const layout = await loadQuartzLayout()

  const left = layout.defaults.left ?? []
  assert.equal(left.length, 2)

  const html = left.map((Component) => render(Component(props))).join("")
  const mobileIndex = html.indexOf('class="mobile-only"')
  const desktopIndex = html.indexOf('class="desktop-only"')
  const flexIndex = html.indexOf('class="flex-component"')

  assert.ok(mobileIndex !== -1)
  assert.ok(desktopIndex !== -1)
  assert.ok(flexIndex !== -1)
  assert.ok(mobileIndex < desktopIndex)
  assert.ok(desktopIndex < flexIndex)
  assert.equal(countMatches(html, 'data-component="repeated-widget"'), 2)
  assert.match(html, /class="mobile-only"[^>]*><div data-component="repeated-widget"/)
  assert.match(
    html,
    /class="desktop-only"[^>]*><div class="flex-component"[^>]*>.*data-component="repeated-widget"/,
  )
})

function countMatches(text, needle) {
  return text.split(needle).length - 1
}
