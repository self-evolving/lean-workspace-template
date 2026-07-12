// Canvas layout helpers — kept OUT of blueprint-model.mjs on purpose: the model
// is imported by the Quartz blueprint transformer on every site build and dev
// session, which must not pay for loading @hpcc-js/wasm-graphviz. Only the canvas
// generator needs layout.

import { Graphviz } from "@hpcc-js/wasm-graphviz"
import { NODE_W, NODE_H } from "./blueprint-model.mjs"

export function buildLayoutDot(items, edges) {
  const esc = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  const lines = [
    "strict digraph G {",
    "  rankdir=TB;",
    "  ranksep=0.6;",
    "  nodesep=0.45;",
    `  node [shape=box, fixedsize=true, width=${(NODE_W / 72).toFixed(3)}, height=${(NODE_H / 72).toFixed(3)}];`,
  ]
  for (const it of items)
    lines.push(
      `  ${esc(it.label)} [width=${(it.size.w / 72).toFixed(3)}, height=${(it.size.h / 72).toFixed(3)}];`,
    )
  for (const e of edges) lines.push(`  ${esc(e.from)} -> ${esc(e.to)};`)
  lines.push("}")
  return lines.join("\n")
}

export async function computeLayout(dot, sizeByLabel) {
  const graphviz = await Graphviz.load()
  const out = JSON.parse(graphviz.layout(dot, "json", "dot"))
  const bb = (out.bb || "0,0,0,0").split(",").map(Number)
  const H = bb[3]
  const pos = new Map()
  for (const o of out.objects || []) {
    if (!o.pos) continue
    const [cx, cy] = o.pos.split(",").map(Number)
    const s = sizeByLabel.get(o.name) ?? { w: NODE_W, h: NODE_H }
    pos.set(o.name, { x: Math.round(cx - s.w / 2), y: Math.round(H - cy - s.h / 2) })
  }
  return pos
}
