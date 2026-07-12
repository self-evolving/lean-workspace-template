#!/usr/bin/env node
// Generate <contentRoot>/blueprint/dep-graph.canvas from the blueprint sources
// (blueprint-as-source model: chapters in <contentRoot>/blueprint/, kernel data
// from blueprint-data.json). Cards point at chapter pages with an item anchor; the
// canvas-page fork renders them from the node's own bp* fields.
//
// Usage: node scripts/generate-canvas.mjs [--root=blueprint] [--out=dep-graph.canvas]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildSourceModel, anchorOf, cap, loadBlueprintConfig } from "./lib/blueprint-model.mjs"
import { buildLayoutDot, computeLayout } from "./lib/blueprint-layout.mjs"

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const p = argv.find((a) => a.startsWith(`--${name}=`))
  return p ? p.slice(name.length + 3) : fallback
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rootOverride = argOf("root", null)
const cfg = loadBlueprintConfig(ROOT, rootOverride ? { root: rootOverride } : {})
const BP_ROOT = cfg.root
const BLUEPRINT_DIR = cfg.blueprintDir
const OUT = path.join(BLUEPRINT_DIR, argOf("out", "dep-graph.canvas"))

if (cfg.pageMode !== "chapter") {
  console.error(
    `generate-canvas: pageMode "${cfg.pageMode}" — this generator implements chapter-page canvases; ` +
      `item-page blueprints get their canvas from the legacy importer ` +
      `(node scripts/import-blueprint.mjs --plan=... --data=... or --base-url=...).`,
  )
  process.exit(1)
}

const model = buildSourceModel({
  blueprintDir: BLUEPRINT_DIR,
  dataPath: cfg.dataPath,
  leanSrcDirs: cfg.leanSrcDirs,
})

const sizeByLabel = new Map(model.items.map((it) => [it.label, it.size]))
const layout = await computeLayout(buildLayoutDot(model.items, model.edges), sizeByLabel)

const nodes = []
for (const item of model.items) {
  const p = layout.get(item.label)
  if (!p) {
    console.warn("no layout position for:", item.label)
    continue
  }
  nodes.push({
    id: item.slug,
    type: "file",
    // virtual md path = the chapter page slug; the fork's card mode renders from
    // the bp* fields and links to file#subpath
    file: `${BP_ROOT}/${item.chapter.slug}.md`,
    subpath: `#${anchorOf(item.label)}`,
    x: p.x,
    y: p.y,
    width: item.size.w,
    height: item.size.h,
    ...(item.color ? { color: item.color } : {}),
    bpTitle: item.title,
    bpKind: `${cap(item.kind)} ${item.number}`,
    bpName: item.displayName,
    bpStatus: item.status.short,
  })
}

const edges = model.edges.map((e, i) => ({
  id: `e${i}`,
  fromNode: model.itemByLabel.get(e.from).slug,
  fromSide: "bottom",
  toNode: model.itemByLabel.get(e.to).slug,
  toSide: "top",
  // dashed = uses on the statement; solid purple = uses in the proof
  ...(e.dashed ? { dashed: true } : { color: "6" }),
}))

const legend = {
  title: "Formalization status (kernel-computed)",
  nodes: [
    { color: "#1CAC78", label: "fully formalized (proof + all ancestors)" },
    { color: "#9CEC8B", label: "proof formalized" },
    { color: "#FCD34D", label: "in progress (proof contains sorry)" },
    { color: "#B0ECA3", label: "statement formalized" },
    { color: "#A3D6FF", label: "ready to formalize (proof)" },
    { color: "#3b82f6", label: "ready to formalize (statement)" },
    { color: null, label: "not ready" },
  ],
  edges: [
    { dashed: true, label: "uses (statement)" },
    { dashed: false, color: "6", label: "uses (proof)" },
  ],
  note: "Statuses are computed from the Lean kernel (lake exe blueprint-data). Hover a card to highlight its direct dependencies; click a title to open it in its chapter.",
}

fs.writeFileSync(OUT, JSON.stringify({ nodes, edges, legend }, null, 2) + "\n")
console.log(
  `dep-graph.canvas: ${nodes.length} nodes, ${edges.length} edges (${model.chapters.length} chapters) -> ${path.relative(ROOT, OUT)}`,
)
