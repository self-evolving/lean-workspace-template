import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { buildBlueprintGraphView } from "./BlueprintGraph.tsx"

const contentDir = path.resolve("content")

test("blueprint graph view scopes chapter items plus direct neighbors", () => {
  const graph = buildBlueprintGraphView(contentDir, "blueprint/ch01_sumsofoddnumbers")
  assert.ok(graph)

  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  assert.deepEqual(graph.currentPageNodeIds, [
    "def-sumodds",
    "lemma-sumodds-succ",
    "thm-sumodds-eq-sq",
    "lemma-sumodds-pos",
  ])
  assert.equal(nodeIds.has("def-sumodds"), true)
  assert.equal(nodeIds.has("thm-sum-first-cubes"), true)
  assert.equal(nodeIds.has("def-triangular"), false)

  assert.ok(graph.edges.some((edge) => edge.from === "def-sumodds" && edge.kind === "statement"))
  assert.ok(graph.edges.some((edge) => edge.from === "lemma-sumodds-succ" && edge.kind === "proof"))
})

test("blueprint graph view leaves non-blueprint pages on the stock Quartz graph", () => {
  assert.equal(buildBlueprintGraphView(contentDir, "docs/quick-start"), null)
})
