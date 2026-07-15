import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { build } from "esbuild"

const popoverInlineUrl = new URL("./popover.inline.ts", import.meta.url)
const popoverStyleUrl = new URL("../styles/popover.scss", import.meta.url)

test("canvas popovers include a floating no-popover open-page action", async () => {
  const source = await readFile(popoverInlineUrl, "utf8")
  const style = await readFile(popoverStyleUrl, "utf8")

  assert.match(source, /function syncCanvasPopoverAction/)
  assert.match(source, /link\.dataset\.noPopover = "true"/)
  assert.match(source, /link\.href = target\.targetUrl\.toString\(\)/)
  assert.match(source, /popoverElement\.appendChild\(actionBar\)/)
  assert.doesNotMatch(source, /popoverInner\.appendChild\(actionBar\)/)
  assert.match(source, /popover-canvas-actions/)
  assert.match(style, /\.canvas-popover > \.popover-canvas-actions \{[\s\S]*position: absolute/)
  assert.match(style, /\.canvas-popover > \.popover-canvas-actions \{[\s\S]*top: 1\.55rem/)
  assert.match(style, /\.canvas-popover > \.popover-canvas-actions \{[\s\S]*right: 1\.55rem/)
})

test("popover inline script bundles with the canvas action", async () => {
  const result = await build({
    entryPoints: [popoverInlineUrl.pathname],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  })
  const bundled = result.outputFiles[0]?.text ?? ""

  assert.match(bundled, /popover-canvas-actions/)
  assert.match(bundled, /Open page/)
})
