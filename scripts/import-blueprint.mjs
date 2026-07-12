#!/usr/bin/env node
// LEGACY importer (self-contained, frozen): renders published leanblueprint sites
// (--base-url scrape mode) and the LaTeX/markdown plan dialects into per-item pages.
// The primary pipeline is now blueprint-as-source (<contentRoot>/blueprint/ + the
// quartz/plugins/local/blueprint transformer + scripts/generate-canvas.mjs).
//
// Blueprint importer: produces literature-template (Quartz) Markdown + JSON Canvas
// from either of two sources:
//
//  A) WORKSPACE MODE (--plan [+ --data]): the in-repo blueprint plan
//     (a content.tex authored in leanblueprint conventions:
//     \label, \uses, \lean, \leanok) merged with kernel-truth data emitted by
//     `lake exe blueprint-data` (real dependency edges, sorry/axiom status).
//     Statuses are COMPUTED from the kernel data, not from \leanok.
//
//  B) SCRAPE MODE (--base-url): a *published* leanblueprint site (plasTeX +
//     plastexdepgraph output), e.g. the Sphere-Packing-Lean blueprint:
//       dep_graph_document.html -> graphviz dot (nodes + statuses + edges)
//                                  + per-node modals (statement LaTeX, lean decls)
//       index.html              -> chapter TOC; <section>.html -> proofs
//
// Both modes emit under <contentRoot>/<out>/:
//   index.md, _meta.json, dep-graph.canvas, ch<N>-<title>/{index.md,_meta.json,<item>.md...}
//
// Edge style: dashed = \uses on the statement, solid = \uses in the proof
// (matching plastexdepgraph: `edges` get style=dashed, `proof_edges` are solid).
//
// Usage:
//   node scripts/import-blueprint.mjs --plan=path/to/content.tex \
//        --data=path/to/blueprint-data.json [--label=...] [--out=blueprint]
//   node scripts/import-blueprint.mjs [--base-url=...] [--out=blueprint]
//        [--content-root=content|docs] [--cache-dir=.quartz-cache/blueprint-import]
//        [--refresh] [--embed=card|statement]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fromHtml } from "hast-util-from-html"
import { Graphviz } from "@hpcc-js/wasm-graphviz"

// ---------------------------------------------------------------- config
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const p = argv.find((a) => a.startsWith(`--${name}=`))
  return p ? p.slice(name.length + 3) : fallback
}
const hasFlag = (name) => argv.includes(`--${name}`)

const BASE = argOf(
  "base-url",
  "https://thefundamentaltheor3m.github.io/Sphere-Packing-Lean/blueprint",
).replace(/\/+$/, "")
// Workspace mode inputs (when --plan is given, no network access happens).
const PLAN = argOf("plan", "")
const DATA = argOf("data", "")
const OUT = argOf("out", "blueprint")
const SITE_LABEL = argOf("label", PLAN ? "Blueprint" : "Sphere Packing blueprint")
// card: compact title cards (full page via hover popover); statement: embed the
// Statement section into each canvas node (heavier, the pre-card behavior).
const EMBED = argOf("embed", "card") // card | statement
const REFRESH = hasFlag("refresh")

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const configContentRoot = () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "blueprint.config.json"), "utf8"))
    return cfg.blueprints?.[0]?.contentRoot ?? cfg.contentRoot
  } catch {
    return null
  }
}
const CONTENT_ROOT = argOf("content-root", configContentRoot() ?? "content")
const CONTENT = path.resolve(ROOT, CONTENT_ROOT)
const CACHE = path.resolve(ROOT, argOf("cache-dir", ".quartz-cache/blueprint-import"))
// Lake root of the in-repo Lean project: source of anchor snippets and decl ranges.
const LEAN_DIR = path.resolve(ROOT, argOf("lean-dir", "lean"))

const positiveIntEnv = (name, fallback) => {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}
const FETCH_CONCURRENCY = positiveIntEnv("BP_FETCH_CONCURRENCY", 8)
const FETCH_RETRIES = positiveIntEnv("BP_FETCH_RETRIES", 5)
const FETCH_RETRY_BASE_MS = positiveIntEnv("BP_FETCH_RETRY_BASE_MS", 750)

// Node footprint on the canvas, in px (1pt = 1px); graphviz takes inches (px / 72).
// Title cards are sized per-item (cardSize); statement embeds use this fixed footprint.
const NODE_W = 331
const NODE_H = 187
const NODE_W_IN = (NODE_W / 72).toFixed(3)
const NODE_H_IN = (NODE_H / 72).toFixed(3)

// ---------------------------------------------------------------- HTML fetch + cache
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const retryableFetchStatus = (status) => status === 429 || (status >= 500 && status < 600)

async function fetchTextWithRetry(url) {
  let lastError
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.text()
      lastError = new Error(`${url} -> ${res.status}`)
      if (!retryableFetchStatus(res.status)) throw lastError
    } catch (e) {
      lastError = e
    }
    if (attempt < FETCH_RETRIES) {
      const delay = FETCH_RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250)
      console.warn(
        `fetch retry ${attempt + 1}/${FETCH_RETRIES}: ${url} (${lastError.message}); waiting ${delay}ms`,
      )
      await sleep(delay)
    }
  }
  throw lastError
}

async function getPage(fileName) {
  const f = path.join(CACHE, fileName.replace(/[^A-Za-z0-9._-]/g, "_"))
  if (!REFRESH && fs.existsSync(f)) return fs.readFileSync(f, "utf8")
  const t = await fetchTextWithRetry(`${BASE}/${fileName}`)
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(f, t)
  return t
}

async function prefetch(fileNames) {
  let i = 0
  const worker = async () => {
    while (i < fileNames.length) {
      const f = fileNames[i++]
      try {
        await getPage(f)
      } catch (e) {
        console.warn("fetch failed:", f, e.message)
      }
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker))
}

// ---------------------------------------------------------------- hast helpers
const isEl = (n, tag) => n && n.type === "element" && (typeof tag !== "string" || n.tagName === tag)
const classes = (n) =>
  n && n.type === "element" && Array.isArray(n.properties?.className) ? n.properties.className : []
const hasClass = (n, c) => classes(n).includes(c)
const textOf = (n) =>
  n.type === "text" ? n.value : n.type === "comment" ? "" : (n.children || []).map(textOf).join("")
const collapse = (s) => s.replace(/\s+/g, " ").trim()
function findDesc(n, pred) {
  if (pred(n)) return n
  for (const c of n.children || []) {
    const r = findDesc(c, pred)
    if (r) return r
  }
  return null
}
function findAll(n, pred, acc = []) {
  if (pred(n)) acc.push(n)
  for (const c of n.children || []) findAll(c, pred, acc)
  return acc
}

// ---------------------------------------------------------------- dot extraction + parsing
const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")

function extractDotSource(html) {
  const m = html.match(/renderDot\(`([\s\S]*?)`\)/)
  if (!m) throw new Error("dep_graph_document.html: renderDot(`...`) payload not found")
  let dot = m[1]
  if (/&(#|amp|quot|lt|gt|nbsp)/.test(dot)) dot = decodeEntities(dot)
  if (!/^\s*strict digraph/.test(dot)) throw new Error("extracted payload is not a strict digraph")
  return dot
}

// One machine-generated dot profile (plastexdepgraph): quoted-or-bare ids, flat [k=v,...] attr
// lists, no subgraphs. Flatten whitespace, split on `;`, classify each statement.
const ID_RE = `"(?:[^"\\\\]|\\\\.)*"|[A-Za-z0-9_.:\\-]+`
const unq = (tok) => (tok.startsWith('"') ? tok.slice(1, -1).replace(/\\(.)/g, "$1") : tok)

function parseAttrs(s) {
  const out = {}
  for (const m of s.matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|([^,\]\s]+))/g)) {
    out[m[1]] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3]
  }
  return out
}

function parseDot(dot) {
  const body = dot.slice(dot.indexOf("{") + 1, dot.lastIndexOf("}")).replace(/[\t\n\r]/g, " ")
  const nodes = new Map() // id -> { shape, border, fill, filled }
  const edgeMap = new Map() // "from\x00to" -> { from, to, dashed }
  const edgeRe = new RegExp(`^(${ID_RE})\\s*->\\s*(${ID_RE})\\s*(?:\\[(.*)\\])?$`)
  const nodeRe = new RegExp(`^(${ID_RE})\\s*\\[(.*)\\]$`)

  for (const raw of body.split(";")) {
    const t = raw.trim()
    if (!t) continue
    if (/^(graph|node|edge)\s*\[/.test(t)) continue
    const em = t.match(edgeRe)
    if (em) {
      const attrs = parseAttrs(em[3] || "")
      const from = unq(em[1])
      const to = unq(em[2])
      // strict digraph semantics: a repeated edge statement merges; last attrs win
      edgeMap.set(`${from}\x00${to}`, { from, to, dashed: attrs.style === "dashed" })
      continue
    }
    const nm = t.match(nodeRe)
    if (nm) {
      const a = parseAttrs(nm[2])
      nodes.set(unq(nm[1]), {
        shape: a.shape || "ellipse",
        border: a.color, // unquoted color name (blue/green/orange) or hex
        fill: a.fillcolor, // quoted hex
        filled: /filled/.test(a.style || ""),
      })
      continue
    }
    console.warn("dot: unparsed statement:", t.slice(0, 120))
  }

  const edges = [...edgeMap.values()]
  for (const e of edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to))
      throw new Error(`dot: edge endpoint not declared as node: ${e.from} -> ${e.to}`)
  }
  if (nodes.size < 50 || edges.length < 50)
    throw new Error(`dot: suspiciously small parse (${nodes.size} nodes, ${edges.length} edges)`)
  return { nodes, edges }
}

// ---------------------------------------------------------------- status decoding (scrape mode)
// Legend: border = statement status, fill = proof status.
const STATEMENT_STATUS = {
  blue: "ready",
  orange: "notReady",
  green: "formalized",
  "#1CAC78": "mathlib",
}
const PROOF_STATUS = {
  "#A3D6FF": "ready",
  "#9CEC8B": "formalized",
  "#1CAC78": "fullyFormalized", // proof + all ancestors
  "#B0ECA3": "notStarted", // fill marks "statement formalized" only
}
function decodeStatus(dotNode) {
  const statement =
    STATEMENT_STATUS[dotNode.border] ?? (dotNode.fill === "#B0ECA3" ? "formalized" : "notReady")
  const proof = (dotNode.filled && PROOF_STATUS[dotNode.fill]) || "notStarted"
  // [verbose page label, compact card label]
  const [label, short] =
    proof === "fullyFormalized"
      ? ["fully formalized (proof + ancestors)", "fully formalized"]
      : proof === "formalized"
        ? ["proof formalized", "proof formalized"]
        : proof === "ready"
          ? ["ready to formalize (proof)", "proof ready"]
          : statement === "formalized" || statement === "mathlib"
            ? ["statement formalized", "statement ✓"]
            : statement === "ready"
              ? ["ready to formalize (statement)", "statement ready"]
              : ["not ready", "not ready"]
  return { statement, proof, label, short }
}
const BORDER_FALLBACK_HEX = { blue: "#3b82f6", green: "#22c55e", orange: "#f97316" }
const canvasColor = (dotNode) =>
  dotNode.filled && dotNode.fill ? dotNode.fill : BORDER_FALLBACK_HEX[dotNode.border]

// ---------------------------------------------------------------- status styles (workspace mode)
// Statuses are computed from the kernel data; \leanok is intentionally ignored.
const STATUS_STYLES = {
  fully: {
    statement: "formalized",
    proof: "fullyFormalized",
    label: "fully formalized (proof + ancestors)",
    short: "fully formalized",
    color: "#1CAC78",
  },
  proofDone: {
    statement: "formalized",
    proof: "formalized",
    label: "proof formalized",
    short: "proof formalized",
    color: "#9CEC8B",
  },
  inProgress: {
    statement: "formalized",
    proof: "inProgress",
    label: "in progress (contains sorry)",
    short: "in progress",
    color: "#FCD34D",
  },
  stmtDone: {
    statement: "formalized",
    proof: "notStarted",
    label: "statement formalized",
    short: "statement ✓",
    color: "#B0ECA3",
  },
  proofReady: {
    statement: "ready",
    proof: "ready",
    label: "ready to formalize (proof)",
    short: "proof ready",
    color: "#A3D6FF",
  },
  stmtReady: {
    statement: "ready",
    proof: "notStarted",
    label: "ready to formalize (statement)",
    short: "statement ready",
    color: "#3b82f6",
  },
  notReady: {
    statement: "notReady",
    proof: "notStarted",
    label: "not ready",
    short: "not ready",
    color: undefined,
  },
}

// ---------------------------------------------------------------- card sizing
// Size each card to its own text instead of one fixed footprint. Estimated text
// metrics match the fork's card CSS: title 13.76px bold (~8.2px/char), kind line
// 9.92px caps + 0.06em tracking (~7.8px/char), status pill 9.28px (~4.9px/char)
// plus 16px pill padding. The 2-line clamp + ellipsis in CSS absorbs estimate error.
const CARD_MIN_W = 150
const CARD_MAX_W = 300
const CARD_CHROME_W = 28 // 2 x 0.7rem padding + borders + slack
const CARD_H_1LINE = 64
const CARD_H_2LINE = 82
function cardSize(item) {
  if (EMBED === "statement") return { w: NODE_W, h: NODE_H }
  const kindLine = `${cap(item.kind)}${item.number ? " " + item.number : ""}`
  const name = item.displayName ?? displayNameOf(item.label)
  const titleLen = name.length
  const titleW = Math.ceil(titleLen * 8.2)
  const kindW = Math.ceil(kindLine.length * 7.8)
  const statusW = Math.ceil(item.status.short.length * 4.9) + 16
  const maxInner = CARD_MAX_W - CARD_CHROME_W
  // decide line count with a conservative (wider) estimate so a near-boundary title
  // that renders wider than estimated wraps into the taller card, not a clipped one
  const lines = Math.ceil(titleLen * 8.8) > maxInner ? 2 : 1
  // balanced wrap: a 2-line title needs roughly half its single-line width
  const effTitleW = lines === 2 ? Math.min(Math.ceil(titleW / 2) + 16, maxInner) : titleW
  const inner = Math.max(effTitleW, kindW, statusW)
  return {
    w: Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, inner + CARD_CHROME_W)),
    h: lines === 2 ? CARD_H_2LINE : CARD_H_1LINE,
  }
}

// ---------------------------------------------------------------- modal + section parsing (scrape)
function parseModals(html) {
  const tree = fromHtml(html)
  const modals = new Map()
  for (const c of findAll(tree, (n) => isEl(n, "div") && hasClass(n, "dep-modal-container"))) {
    const id = String(c.properties?.id || "")
    if (!id.endsWith("_modal")) continue
    const label = id.slice(0, -"_modal".length)
    const thm = findDesc(c, (x) => isEl(x, "div") && hasClass(x, "thm"))
    if (!thm) continue
    const capEl = findDesc(
      thm,
      (x) => isEl(x, "span") && classes(x).some((cl) => cl.endsWith("_thmcaption")),
    )
    const numEl = findDesc(
      thm,
      (x) => isEl(x, "span") && classes(x).some((cl) => cl.endsWith("_thmlabel")),
    )
    const contentEl = findDesc(thm, (x) => isEl(x, "div") && hasClass(x, "thm_thmcontent"))
    const latexA = findDesc(c, (x) => isEl(x, "a") && hasClass(x, "latex_link"))
    const leanDecls = findAll(c, (x) => isEl(x, "a") && hasClass(x, "lean_link"))
      .map((a) => {
        const href = String(a.properties?.href || "")
        const name = decodeURIComponent(href.split("#doc/")[1] || "")
        return name ? { name, href } : null
      })
      .filter(Boolean)
    modals.set(label, {
      kind: capEl ? collapse(textOf(capEl)).toLowerCase() : null,
      number: numEl ? collapse(textOf(numEl)) : "",
      contentEl,
      latexHref: latexA ? String(latexA.properties?.href || "") : "",
      leanDecls,
    })
  }
  return modals
}

function parseChapterToc(html) {
  const tree = fromHtml(html)
  const chapters = new Map() // num -> { title, file }
  const toc = findDesc(tree, (n) => isEl(n, "ul") && hasClass(n, "sub-toc-0"))
  if (!toc) return chapters
  for (const li of (toc.children || []).filter((c) => isEl(c, "li"))) {
    const a = findDesc(li, (x) => isEl(x, "a") && x.properties?.href)
    if (!a) continue
    const ref = findDesc(li, (x) => isEl(x, "span") && hasClass(x, "toc_ref"))
    const num = Number(ref ? collapse(textOf(ref)) : NaN)
    if (!Number.isInteger(num)) continue
    // Title = the li's own text minus sub-TOCs, the expander arrow, and the leading number.
    // (plasTeX nests <a> inside <a> when a title contains \ref; the HTML parser splits the
    // outer anchor there, so reading only the toc_entry span would drop the tail — e.g.
    // "Proof of Theorem 5.3" would lose the "5.3".)
    const parts = (li.children || []).filter(
      (c) => !isEl(c, "ul") && !(isEl(c, "span") && hasClass(c, "expand-toc")),
    )
    let title = collapse(parts.map(textOf).join(" ")).replace(/\\\(|\\\)/g, "")
    title = title.replace(new RegExp(`^${num}\\s*`), "")
    chapters.set(num, { title, file: String(a.properties.href).split("#")[0] })
  }
  return chapters
}

// Section pages: per item, the explicit proof anchor (from the hidden header extras);
// plus an index of proof_wrapper bodies by id so deferred "Proof of X" blocks resolve too.
function parseSectionPage(html) {
  const tree = fromHtml(html)
  const proofAnchors = new Map() // label -> { file, frag }
  const proofsById = new Map() // frag -> proof_content element
  for (const w of findAll(
    tree,
    (n) => isEl(n, "div") && classes(n).some((cl) => cl.endsWith("_thmwrapper")),
  )) {
    const label = String(w.properties?.id || "")
    if (!label) continue
    const hidden = findDesc(w, (x) => isEl(x, "div") && hasClass(x, "thm_header_hidden_extras"))
    if (!hidden) continue
    for (const a of findAll(hidden, (x) => isEl(x, "a") && hasClass(x, "proof"))) {
      const href = String(a.properties?.href || "")
      const [file, frag] = href.split("#")
      if (frag && frag !== label) {
        proofAnchors.set(label, { file, frag })
        break
      }
    }
  }
  for (const p of findAll(tree, (n) => isEl(n, "div") && hasClass(n, "proof_wrapper"))) {
    const id = String(p.properties?.id || "")
    const content = findDesc(p, (x) => isEl(x, "div") && hasClass(x, "proof_content"))
    if (id && content) proofsById.set(id, content)
  }
  return { proofAnchors, proofsById }
}

// ---------------------------------------------------------------- HTML -> Markdown (TeX passthrough)
// Some blueprint sources carry unicode quotes inside TeX (e.g. `E_2’`); KaTeX rejects them.
const normMathQuotes = (s) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
// Inline MathJax delimiters -> remark-math dollars (no surrounding spaces inside the $...$).
const mathText = (s) =>
  s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, inner) => `$${normMathQuotes(inner)}$`)
const stripLabels = (s) => s.replace(/\\label\{[^}]*\}/g, "")
const isDisplayEl = (n) => isEl(n, "div") && (hasClass(n, "displaymath") || hasClass(n, "equation"))

function displayMathMd(el) {
  if (hasClass(el, "displaymath")) {
    let t = normMathQuotes(stripLabels(textOf(el))).trim()
    t = t.replace(/^\\\[/, "").replace(/\\\]$/, "").trim()
    return t ? `$$\n${t}\n$$` : ""
  }
  // div.equation: unwrap the equation env, drop \label, keep the printed number as \tag
  const content = findDesc(el, (x) => isEl(x, "div") && hasClass(x, "equation_content"))
  const tagEl = findDesc(el, (x) => isEl(x, "span") && hasClass(x, "equation_label"))
  let t = normMathQuotes(stripLabels(textOf(content || el))).trim()
  t = t
    .replace(/\\begin\{equation\*?\}/g, "")
    .replace(/\\end\{equation\*?\}/g, "")
    .trim()
  const tag = tagEl ? collapse(textOf(tagEl)) : ""
  if (!t) return ""
  return `$$\n${t}${tag ? ` \\tag{${tag}}` : ""}\n$$`
}

// Link resolution needs the item table; threaded via ctx.
function linkMd(a, ctx) {
  const href = String(a.properties?.href || "")
  const txt = collapse(inlineChildren(a, ctx)) || href
  if (!href) return txt
  if (/^https?:\/\//.test(href)) return `[${txt}](${href})`
  const [file, frag] = href.split("#")
  if (frag && ctx?.itemByLabel?.has(frag)) {
    const target = ctx.itemByLabel.get(frag)
    if (ctx.fromItem && target !== ctx.fromItem)
      return `[${txt}](${relHrefItems(ctx.fromItem, target)})`
    if (!ctx.fromItem) return `[${txt}](${target.chapter.slug}/${target.slug}.md)`
    return txt // self-reference
  }
  // anything else (equation anchors, unimported pages) -> original blueprint
  const abs = file ? `${BASE}/${file}${frag ? "#" + frag : ""}` : `${BASE}/${href}`
  return `[${txt}](${abs})`
}

function inlineMd(n, ctx) {
  if (n.type === "text") return mathText(n.value)
  if (!isEl(n)) return ""
  if (isDisplayEl(n)) return displayMathMd(n) // display math nested in a paragraph
  if (isEl(n, "code")) return `\`${collapse(textOf(n))}\``
  if (isEl(n, "a")) return linkMd(n, ctx)
  if (isEl(n, "em") || isEl(n, "i")) return `_${inlineChildren(n, ctx)}_`
  if (isEl(n, "strong") || isEl(n, "b")) return `**${inlineChildren(n, ctx)}**`
  if (isEl(n, "br")) return " "
  return inlineChildren(n, ctx)
}
const inlineChildren = (n, ctx) => (n.children || []).map((c) => inlineMd(c, ctx)).join("")

// A <p> may interleave prose with display-math divs; split it into paragraph/display blocks.
function paragraphBlocks(p, ctx) {
  const blocks = []
  let run = []
  const flush = () => {
    const t = collapse(run.map((c) => inlineMd(c, ctx)).join(""))
    if (t) blocks.push(t)
    run = []
  }
  for (const c of p.children || []) {
    if (isDisplayEl(c)) {
      flush()
      const d = displayMathMd(c)
      if (d) blocks.push(d)
    } else run.push(c)
  }
  flush()
  return blocks.join("\n\n")
}

function blockMd(n, ctx) {
  if (!isEl(n)) {
    const t = n.type === "text" ? collapse(mathText(n.value)) : ""
    return t
  }
  if (isDisplayEl(n)) return displayMathMd(n)
  if (isEl(n, "p")) return paragraphBlocks(n, ctx)
  if (/^h[1-6]$/.test(n.tagName)) return "**" + collapse(inlineChildren(n, ctx)) + "**"
  if (isEl(n, "pre")) {
    const code = findDesc(n, (x) => isEl(x, "code")) || n
    return "```\n" + textOf(code).replace(/\n$/, "") + "\n```"
  }
  if (isEl(n, "ul") || isEl(n, "ol")) {
    const ordered = isEl(n, "ol")
    const items = (n.children || []).filter((c) => isEl(c, "li"))
    return items
      .map((li) => (ordered ? "1. " : "- ") + collapse(inlineChildren(li, ctx)))
      .join("\n")
  }
  if (isEl(n, "blockquote")) return "> " + collapse(inlineChildren(n, ctx))
  const inner = (n.children || []).map((c) => blockMd(c, ctx)).filter((s) => s && s.trim())
  if (inner.length) return inner.join("\n\n")
  return collapse(inlineChildren(n, ctx))
}

const proseMd = (nodes, ctx) =>
  (nodes || [])
    .map((n) => blockMd(n, ctx))
    .filter((s) => s && s.trim())
    .join("\n\n")

// ---------------------------------------------------------------- slugs + relative links
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item"

function makeUniqueSlugger() {
  const seen = new Map()
  return (s) => {
    const base = slugify(s)
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}-${n + 1}`
  }
}

const itemFileRel = (item) => `${OUT}/${item.chapter.slug}/${item.slug}.md`
const relHrefItems = (fromItem, toItem) =>
  path.posix.relative(path.posix.dirname(itemFileRel(fromItem)), itemFileRel(toItem))

const KIND_PREFIX_RE =
  /^(definition|def|lemma|lem|theorem|thm|proposition|prop|corollary|cor)\s*:\s*/i
const displayNameOf = (label) => label.replace(KIND_PREFIX_RE, "").trim() || label
const numKey = (number) => (number ? number.split(".").map(Number) : [Infinity])
const numCompare = (a, b) => {
  const ka = numKey(a.number)
  const kb = numKey(b.number)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (d) return d
  }
  return a.slug.localeCompare(b.slug)
}

// ---------------------------------------------------------------- plan (.tex) parsing
const PLAN_ENV_KINDS = ["definition", "lemma", "proposition", "theorem", "corollary"]

function stripTexComments(src) {
  return src
    .split("\n")
    .map((line) => {
      let out = ""
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "%" && line[i - 1] !== "\\") break
        out += line[i]
      }
      return out
    })
    .join("\n")
}

// Pull the leanblueprint directives out of an environment body; the remainder is
// the statement/proof TeX (kept raw — Quartz's KaTeX pipeline renders $...$/$$...$$).
function parseEnvDirectives(body) {
  const out = { label: null, leanNames: [], leanok: false, uses: [] }
  body = body.replace(/\\label\{([^}]*)\}/, (_, v) => {
    out.label = v.trim()
    return ""
  })
  body = body.replace(/\\uses\{([^}]*)\}/g, (_, v) => {
    out.uses.push(
      ...v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    return ""
  })
  body = body.replace(/\\lean\{([^}]*)\}/g, (_, v) => {
    out.leanNames.push(
      ...v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    return ""
  })
  body = body.replace(/\\leanok\b/g, () => {
    out.leanok = true
    return ""
  })
  out.tex = body.replace(/\n{3,}/g, "\n\n").trim()
  return out
}

function parsePlanTex(src) {
  src = stripTexComments(src)
  const chapters = []
  let current = null
  const re = new RegExp(
    `\\\\chapter\\{([^}]*)\\}|\\\\begin\\{(${PLAN_ENV_KINDS.join("|")})\\}(?:\\[([^\\]]*)\\])?([\\s\\S]*?)\\\\end\\{\\2\\}`,
    "g",
  )
  let m
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) {
      current = { title: collapse(m[1]), items: [] }
      chapters.push(current)
      continue
    }
    if (!current) {
      current = { title: "Blueprint", items: [] }
      chapters.push(current)
    }
    const item = { kind: m[2], caption: m[3] ? collapse(m[3]) : null, ...parseEnvDirectives(m[4]) }
    // an immediately-following proof environment belongs to this item
    const rest = src.slice(re.lastIndex)
    const pm = rest.match(/^\s*\\begin\{proof\}([\s\S]*?)\\end\{proof\}/)
    if (pm) {
      item.proof = parseEnvDirectives(pm[1])
      re.lastIndex += pm[0].length
    }
    current.items.push(item)
  }
  return chapters
}

// Minimal TeX-to-markdown for plan prose: resolve \Cref/\ref to item links, a few
// inline conveniences; math stays raw for KaTeX.
function planTexToMd(tex, ctx) {
  if (!tex) return ""
  let s = tex
  s = s.replace(/\\[Cc]ref\{([^}]*)\}/g, (_, l) => {
    const t = ctx.itemByLabel.get(l.trim())
    if (t && ctx.fromItem && t !== ctx.fromItem)
      return `[${t.title}](${relHrefItems(ctx.fromItem, t)})`
    return t ? t.title : l
  })
  s = s.replace(/\\ref\{([^}]*)\}/g, (_, l) => {
    const t = ctx.itemByLabel.get(l.trim())
    if (t && ctx.fromItem && t !== ctx.fromItem)
      return `[${t.number}](${relHrefItems(ctx.fromItem, t)})`
    return l
  })
  s = s
    .replace(/\\texttt\{([^}]*)\}/g, "`$1`")
    .replace(/\\emph\{([^}]*)\}/g, "_$1_")
    .replace(/\\textbf\{([^}]*)\}/g, "**$1**")
  return s.trim()
}

// ---------------------------------------------------------------- plan (.md) parsing
// The markdown blueprint dialect:
//   # Chapter Title                          (prose before the first item = chapter intro)
//   ## Kind: Display Name {#label uses="a, b" lean="Full.Name" code=none}
//   ### Proof {uses="..."}
// Cross-refs: [text](#label). Code: ```lean anchor=NAME / ```lean decl=Full.Name
// (empty fenced blocks, filled in by the inliner); items with lean= and no explicit
// lean block get an auto "Lean" section.

function parseAttrStr(s) {
  const out = {}
  if (!s) return out
  for (const m of s.matchAll(/#([^\s"}]+)|([\w-]+)=(?:"([^"]*)"|([^\s"}]+))|([\w-]+)/g)) {
    if (m[1] !== undefined) out.id = m[1]
    else if (m[2] !== undefined) out[m[2]] = m[3] ?? m[4]
    else if (m[5] !== undefined) out[m[5]] = true
  }
  return out
}

const splitList = (s) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)

const MD_KIND_RE = new RegExp(`^(${PLAN_ENV_KINDS.join("|")})\\s*:\\s*(.*)$`, "i")

// Parse one or more markdown plan files into the same planChapters shape the tex
// frontend produces (items carry `tex` = raw body source; format tracked per item).
function parsePlanMdFiles(files) {
  const chapters = []
  let chapter = null
  let item = null
  let target = null // line sink: {push}
  const flushTarget = () => {}

  const startChapter = (title) => {
    chapter = { title, introLines: [], items: [] }
    chapters.push(chapter)
    item = null
    target = chapter.introLines
  }
  const finishItem = () => {
    if (!item) return
    item.tex = item.bodyLines.join("\n").trim()
    if (item.proof) item.proof.tex = item.proofLines.join("\n").trim()
    delete item.bodyLines
    delete item.proofLines
    item = null
  }

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8")
    let inFence = false
    for (const line of src.split("\n")) {
      if (/^\s*```/.test(line)) inFence = !inFence
      if (!inFence) {
        const h = line.match(/^(#{1,3})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/)
        if (h) {
          const level = h[1].length
          const text = h[2].trim()
          const attrs = parseAttrStr(h[3])
          if (level === 1) {
            finishItem()
            startChapter(text)
            continue
          }
          if (level === 2) {
            const km = text.match(MD_KIND_RE)
            if (km) {
              finishItem()
              if (!chapter) startChapter("Blueprint")
              item = {
                kind: km[1].toLowerCase(),
                caption: km[2].trim() || null,
                label: attrs.id ?? null,
                leanNames: splitList(attrs.lean),
                leanok: false,
                uses: splitList(attrs.uses),
                codeNone: attrs.code === "none",
                format: "md",
                bodyLines: [],
                proof: null,
                proofLines: [],
              }
              chapter.items.push(item)
              target = item.bodyLines
              continue
            }
            console.warn(`plan(md): H2 "${text}" is not "Kind: Name" — treated as prose`)
          }
          if (level === 3 && item && /^proof$/i.test(text)) {
            item.proof = { uses: splitList(attrs.uses), leanok: false, tex: "" }
            target = item.proofLines
            continue
          }
        }
      }
      if (target) target.push(line)
      else if (line.trim())
        console.warn(`plan(md): prose before first chapter ignored: ${line.slice(0, 60)}`)
    }
    finishItem()
  }
  finishItem()
  for (const c of chapters) {
    c.intro = c.introLines.join("\n").trim()
    delete c.introLines
  }
  return chapters
}

// ---------------------------------------------------------------- Lean source snippets
function* walkLeanFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "lake-packages") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkLeanFiles(p)
    else if (e.name.endsWith(".lean")) yield p
  }
}

const ANCHOR_RE = /^\s*--\s*ANCHOR(_END)?:\s*(\S+)\s*$/

// name -> { file (lean-dir relative), lines: [text] }
function buildAnchorIndex() {
  const anchors = new Map()
  if (!fs.existsSync(LEAN_DIR)) return anchors
  for (const file of walkLeanFiles(LEAN_DIR)) {
    const rel = path.relative(LEAN_DIR, file)
    const lines = fs.readFileSync(file, "utf8").split("\n")
    const open = new Map() // name -> startIdx
    lines.forEach((line, i) => {
      const m = line.match(ANCHOR_RE)
      if (!m) return
      const [, end, name] = m
      if (!end) open.set(name, i + 1)
      else if (open.has(name)) {
        anchors.set(name, { file: rel, lines: lines.slice(open.get(name), i) })
        open.delete(name)
      }
    })
    for (const name of open.keys()) console.warn(`anchors: unterminated ANCHOR ${name} in ${rel}`)
  }
  return anchors
}

const dedentLines = (lines) => {
  const nonEmpty = lines.filter((l) => l.trim())
  const indent = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)[0].length), 99)
  return lines
    .map((l) => l.slice(indent))
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
}

// Slice a declaration's source from its file, extending upward through a
// contiguous doc comment (`/-- ... -/`) and attribute lines (`@[...]`).
function declSnippet(decl) {
  if (!decl?.file || !decl.startLine) return null
  const abs = path.join(LEAN_DIR, decl.file)
  if (!fs.existsSync(abs)) return null
  const lines = fs.readFileSync(abs, "utf8").split("\n")
  let start = decl.startLine - 1 // 0-based
  // attributes / doc comment directly above
  while (start > 0) {
    const prev = lines[start - 1].trim()
    if (prev.startsWith("@[")) {
      start--
      continue
    }
    if (prev.endsWith("-/")) {
      let j = start - 1
      while (j >= 0 && !lines[j].trim().startsWith("/--") && !lines[j].trim().startsWith("/-!")) j--
      if (j >= 0 && lines[j].trim().startsWith("/--")) {
        start = j
        continue
      }
    }
    break
  }
  return {
    file: decl.file,
    startLine: start + 1,
    endLine: decl.endLine,
    code: dedentLines(lines.slice(start, decl.endLine)),
  }
}

// Resolve ```lean anchor=NAME / ```lean decl=Full.Name fenced blocks in a markdown body.
function inlineCodeBlocks(md, anchors, kernel, where) {
  let sawLean = false
  const out = md.replace(/```lean([^\n]*)\n([\s\S]*?)```/g, (full, metaStr, body) => {
    sawLean = true
    const meta = parseAttrStr(metaStr.trim())
    if (meta.anchor) {
      const a = anchors.get(meta.anchor)
      if (!a) {
        console.warn(`plan(md): unknown anchor "${meta.anchor}" in ${where}`)
        return full
      }
      return "```lean\n" + dedentLines(a.lines) + "\n```"
    }
    if (meta.decl) {
      const s = declSnippet(kernel.get(meta.decl))
      if (!s) {
        console.warn(`plan(md): no source range for decl "${meta.decl}" in ${where}`)
        return full
      }
      return "```lean\n" + s.code + "\n```"
    }
    return full
  })
  return { md: out, sawLean }
}

// Auto "Lean" section for an item: each declaration's source + location line.
function buildLeanSection(item, kernel) {
  const blocks = []
  for (const name of item.leanDeclNames ?? []) {
    const s = declSnippet(kernel.get(name))
    if (!s) continue
    blocks.push(
      `**\`${name}\`** — \`${path.posix.join(path.basename(LEAN_DIR), s.file)}:${s.startLine}–${s.endLine}\`\n\n` +
        "```lean\n" +
        s.code +
        "\n```",
    )
  }
  return blocks.length ? "## Lean\n\n" + blocks.join("\n\n") : null
}

// Rewrite [text](#label) cross-refs to relative item links. `resolve(item)` maps a
// target item to an href from the current page.
function rewriteMdRefs(md, itemByLabel, resolve) {
  return md.replace(/\[([^\]]*)\]\(#([^)\s]+)\)/g, (full, text, label) => {
    const t = itemByLabel.get(label)
    if (!t) return full
    const href = resolve(t)
    if (!href) return text || t.title
    return `[${text || t.title}](${href})`
  })
}

// ---------------------------------------------------------------- layout (graphviz wasm)
function buildLayoutDot(items, edges) {
  const esc = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  const lines = [
    "strict digraph G {",
    "  rankdir=TB;",
    "  ranksep=0.6;",
    "  nodesep=0.45;",
    `  node [shape=box, fixedsize=true, width=${NODE_W_IN}, height=${NODE_H_IN}];`,
  ]
  for (const it of items)
    lines.push(
      `  ${esc(it.label)} [width=${(it.size.w / 72).toFixed(3)}, height=${(it.size.h / 72).toFixed(3)}];`,
    )
  for (const e of edges) lines.push(`  ${esc(e.from)} -> ${esc(e.to)};`)
  lines.push("}")
  return lines.join("\n")
}

async function computeLayout(dot, sizeByLabel) {
  const graphviz = await Graphviz.load()
  const out = JSON.parse(graphviz.layout(dot, "json", "dot"))
  const bb = (out.bb || "0,0,0,0").split(",").map(Number)
  const H = bb[3]
  const pos = new Map()
  for (const o of out.objects || []) {
    if (!o.pos) continue
    const [cx, cy] = o.pos.split(",").map(Number)
    const s = sizeByLabel.get(o.name) ?? { w: NODE_W, h: NODE_H }
    pos.set(o.name, {
      x: Math.round(cx - s.w / 2),
      y: Math.round(H - cy - s.h / 2),
    })
  }
  return pos
}

// ---------------------------------------------------------------- writers
let written = 0
const write = (rel, body) => {
  const abs = path.join(CONTENT, rel.toLowerCase())
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
  written++
}
const fm = (obj) => {
  const lines = ["---"]
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue
    if (Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const it of v) lines.push(`  - "${it}"`)
    } else if (typeof v === "number") lines.push(`${k}: ${v}`)
    else lines.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`)
  }
  lines.push("---", "")
  return lines.join("\n")
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// ---------------------------------------------------------------- model: workspace mode
function buildModelFromPlan() {
  const planPath = path.resolve(ROOT, PLAN)
  const kernelRaw = DATA
    ? JSON.parse(fs.readFileSync(path.resolve(ROOT, DATA), "utf8"))
    : { decls: [] }
  const kernel = new Map((kernelRaw.decls ?? []).map((d) => [d.name, d]))
  if (!DATA) console.warn("plan: no --data given — every lean reference will be 'not found'")

  // frontend dispatch: directory of *.md (filename order) | single .md | .tex
  let planChapters
  if (fs.existsSync(planPath) && fs.statSync(planPath).isDirectory()) {
    const files = fs
      .readdirSync(planPath)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => path.join(planPath, f))
    if (!files.length) throw new Error(`plan: no .md files in directory ${PLAN}`)
    planChapters = parsePlanMdFiles(files)
  } else if (planPath.endsWith(".md")) {
    planChapters = parsePlanMdFiles([planPath])
  } else {
    planChapters = parsePlanTex(fs.readFileSync(planPath, "utf8"))
  }
  if (!planChapters.some((c) => c.items.length))
    throw new Error(`plan: no items parsed from ${PLAN}`)

  const uniqueSlug = makeUniqueSlugger()
  const chapters = new Map()
  const items = []
  const itemByLabel = new Map()
  planChapters.forEach((pc, ci) => {
    const num = ci + 1
    const chapter = {
      num,
      title: pc.title,
      slug: `ch${num}-${slugify(pc.title)}`,
      intro: pc.intro || "",
      items: [],
    }
    chapters.set(num, chapter)
    pc.items.forEach((pi, ii) => {
      if (!pi.label) {
        console.warn(`plan: ${pi.kind} without a label skipped in chapter "${pc.title}"`)
        return
      }
      const item = {
        label: pi.label,
        slug: uniqueSlug(pi.label),
        kind: pi.kind,
        number: `${num}.${ii + 1}`,
        chapter,
        displayName: pi.caption || displayNameOf(pi.label),
        leanDeclNames: pi.leanNames,
        statementTex: pi.tex,
        proofTex: pi.proof?.tex || null,
        stmtUses: pi.uses,
        proofUses: pi.proof?.uses ?? [],
        format: pi.format ?? "tex",
        codeNone: pi.codeNone ?? false,
      }
      item.title = `${cap(item.kind)} ${item.number} · ${item.displayName}`
      chapter.items.push(item)
      items.push(item)
      itemByLabel.set(pi.label, item)
    })
  })

  // kernel join
  for (const item of items) {
    item.declsFound = item.leanDeclNames.map((n) => kernel.get(n)).filter(Boolean)
    item.declsOk =
      item.leanDeclNames.length > 0 && item.declsFound.length === item.leanDeclNames.length
    item.sorries = item.declsFound.filter((d) => d.hasSorry).length
    for (const n of item.leanDeclNames)
      if (!kernel.has(n)) console.warn(`plan: \\lean{${n}} on ${item.label} not in kernel data`)
    for (const l of [...item.stmtUses, ...item.proofUses])
      if (!itemByLabel.has(l)) console.warn(`plan: ${item.label} \\uses{${l}} — unknown label`)
  }

  // an item is "clean" when its decls exist, are sorry-free, and so is everything
  // it transitively depends on (the dark-green "fully formalized" criterion)
  const cleanMemo = new Map()
  const isClean = (item, stack = new Set()) => {
    if (cleanMemo.has(item.label)) return cleanMemo.get(item.label)
    if (stack.has(item.label)) return false
    stack.add(item.label)
    const deps = [...item.stmtUses, ...item.proofUses]
      .map((l) => itemByLabel.get(l))
      .filter(Boolean)
    const ok = item.declsOk && item.sorries === 0 && deps.every((d) => isClean(d, stack))
    cleanMemo.set(item.label, ok)
    return ok
  }

  for (const item of items) {
    const stmtDeps = item.stmtUses.map((l) => itemByLabel.get(l)).filter(Boolean)
    const allDeps = [...item.stmtUses, ...item.proofUses]
      .map((l) => itemByLabel.get(l))
      .filter(Boolean)
    let key
    if (item.declsOk) {
      if (item.sorries > 0) key = "inProgress"
      else if (item.kind === "definition") key = "stmtDone"
      else key = isClean(item) ? "fully" : "proofDone"
    } else {
      const stmtReady = stmtDeps.every((d) => d.declsOk)
      if (!stmtReady) key = "notReady"
      else if (item.kind === "definition") key = "stmtReady"
      else key = allDeps.every((d) => isClean(d)) ? "proofReady" : "stmtReady"
    }
    const st = STATUS_STYLES[key]
    item.status = { statement: st.statement, proof: st.proof, label: st.label, short: st.short }
    item.color = st.color
    item.linkLines = item.leanDeclNames.length
      ? [`- Lean: ${item.leanDeclNames.map((n) => `\`${n}\``).join(", ")}`]
      : []
    item.size = cardSize(item)
  }

  // code inlining (anchor=/decl= blocks in md bodies) + auto Lean sections
  const anchors = buildAnchorIndex()
  for (const item of items) {
    let sawLean = false
    if (item.format === "md") {
      if (item.statementTex) {
        const r = inlineCodeBlocks(item.statementTex, anchors, kernel, item.label)
        item.statementTex = r.md
        sawLean = sawLean || r.sawLean
      }
      if (item.proofTex) {
        const r = inlineCodeBlocks(item.proofTex, anchors, kernel, item.label)
        item.proofTex = r.md
        sawLean = sawLean || r.sawLean
      }
    }
    if (!item.codeNone && !sawLean) item.leanSection = buildLeanSection(item, kernel)
  }

  // edges: dashed = statement-level \uses, solid = proof-level \uses
  const edgeMap = new Map()
  for (const item of items) {
    for (const l of item.stmtUses)
      if (itemByLabel.has(l))
        edgeMap.set(`${l}\x00${item.label}`, { from: l, to: item.label, dashed: true })
    for (const l of item.proofUses) {
      const k = `${l}\x00${item.label}`
      if (itemByLabel.has(l) && !edgeMap.has(k))
        edgeMap.set(k, { from: l, to: item.label, dashed: false })
    }
  }
  const edges = [...edgeMap.values()]

  // plan-vs-kernel dependency report (informational)
  const declOwner = new Map()
  for (const item of items) for (const n of item.leanDeclNames) declOwner.set(n, item)
  for (const item of items) {
    if (!item.declsOk) continue
    const kernelDeps = new Set()
    for (const d of item.declsFound)
      for (const u of d.usedConstants ?? []) {
        const owner = declOwner.get(u)
        if (owner && owner !== item) kernelDeps.add(owner.label)
      }
    const planned = new Set([...item.stmtUses, ...item.proofUses])
    for (const l of kernelDeps)
      if (!planned.has(l))
        console.warn(`plan/kernel: ${item.label} actually uses ${l} (missing from \\uses)`)
  }

  const meta = {
    legend: {
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
        { dashed: true, label: "\\uses on the statement" },
        { dashed: false, color: "6", label: "\\uses in the proof" },
      ],
      note: "Statuses are computed from the Lean kernel (lake exe blueprint-data), not from \\leanok. Hover a card to highlight its direct dependencies; click a title to open its page.",
    },
    landingLines: (stats) => [
      `A live blueprint of the in-repo Lean project: **${stats.items} items** across **${stats.chapters} chapters**, with ${stats.edges} dependency edges. Statuses are computed from the Lean kernel — a node is dark green only when its proof *and everything it depends on* compile without \`sorry\`.`,
      "",
      `**[→ Dependency graph (canvas)](dep-graph.canvas)**`,
      "",
      "Regenerate after editing the Lean code or the plan:",
      "",
      "```bash",
      "lake build && npm run blueprint:data",
      "npm run import:blueprint -- --plan=path/to/content.tex --data=content/blueprint/blueprint-data.json",
      "```",
    ],
  }

  return { items, itemByLabel, chapters, edges, meta }
}

// ---------------------------------------------------------------- model: scrape mode
async function buildModelFromSite() {
  const depHtml = await getPage("dep_graph_document.html")
  const indexHtml = await getPage("index.html")

  const { nodes: dotNodes, edges } = parseDot(extractDotSource(depHtml))
  const modals = parseModals(depHtml)
  const chapterToc = parseChapterToc(indexHtml)

  // section files: union of modal latex_link targets and TOC entries
  const sectionFiles = new Set()
  for (const m of modals.values()) if (m.latexHref) sectionFiles.add(m.latexHref.split("#")[0])
  for (const c of chapterToc.values()) sectionFiles.add(c.file)
  await prefetch([...sectionFiles])

  const proofAnchors = new Map() // label -> {file, frag}
  const proofsByFile = new Map() // file -> Map(frag -> proof_content el)
  for (const f of sectionFiles) {
    try {
      const parsed = parseSectionPage(await getPage(f))
      for (const [label, anchor] of parsed.proofAnchors)
        proofAnchors.set(label, { file: anchor.file || f, frag: anchor.frag })
      proofsByFile.set(f, parsed.proofsById)
    } catch (e) {
      console.warn("section parse failed:", f, e.message)
    }
  }

  const fileToChapter = new Map([...chapterToc].map(([num, c]) => [c.file, num]))

  const uniqueSlug = makeUniqueSlugger()
  const chapters = new Map()
  const chapterFor = (num) => {
    if (!chapters.has(num)) {
      const toc = chapterToc.get(num)
      const title = toc ? toc.title : num === 0 ? "Miscellaneous" : `Chapter ${num}`
      chapters.set(num, {
        num,
        title,
        file: toc?.file,
        slug: num === 0 ? "misc" : `ch${num}-${slugify(title)}`,
        items: [],
      })
    }
    return chapters.get(num)
  }

  const items = []
  const itemByLabel = new Map()
  for (const [label, dotNode] of dotNodes) {
    const modal = modals.get(label)
    if (!modal) console.warn("no modal for node:", label)
    const number = modal?.number || ""
    let chNum = number ? Number(number.split(".")[0]) : NaN
    if (!Number.isInteger(chNum)) {
      const f = modal?.latexHref?.split("#")[0]
      chNum = (f && fileToChapter.get(f)) ?? 0
    }
    const status = decodeStatus(dotNode)
    const kind = modal?.kind || (dotNode.shape === "box" ? "definition" : "theorem")
    const item = {
      label,
      slug: uniqueSlug(label),
      kind,
      number,
      chapter: chapterFor(chNum),
      status,
      dotNode,
      modal,
      displayName: displayNameOf(label),
    }
    item.title = `${cap(kind)}${number ? " " + number : ""} · ${item.displayName}`
    item.color = canvasColor(dotNode)
    const bpHref = modal?.latexHref ? `${BASE}/${modal.latexHref}` : `${BASE}/index.html`
    item.url = bpHref
    item.leanDeclNames = (modal?.leanDecls ?? []).map((d) => d.name)
    item.linkLines = [
      `- [Blueprint](${bpHref}) · [original dependency graph](${BASE}/dep_graph_document.html)`,
    ]
    for (const d of modal?.leanDecls ?? [])
      item.linkLines.push(`- Lean: [\`${d.name}\`](${d.href})`)
    const anchor = proofAnchors.get(label)
    item.proofEl = anchor ? (proofsByFile.get(anchor.file)?.get(anchor.frag) ?? null) : null
    item.size = cardSize(item)
    item.chapter.items.push(item)
    items.push(item)
    itemByLabel.set(label, item)
  }

  const meta = {
    legend: {
      title: "Formalization status",
      nodes: [
        { color: "#1CAC78", label: "proof + all ancestors formalized" },
        { color: "#9CEC8B", label: "proof formalized" },
        { color: "#B0ECA3", label: "statement formalized" },
        { color: "#22c55e", label: "statement formalized, proof not started" },
        { color: "#A3D6FF", label: "ready to formalize (proof)" },
        { color: "#3b82f6", label: "ready to formalize (statement)" },
        { color: null, label: "not ready" },
      ],
      edges: [
        { dashed: true, label: "\\uses on the statement" },
        { dashed: false, color: "6", label: "\\uses in the proof" },
      ],
      note: "Arrows point from prerequisite to dependent. Hover a card to highlight its direct dependencies; click a title to open its page.",
    },
    landingLines: (stats) => [
      `A hosted, cross-linked edition of the [${SITE_LABEL}](${BASE}/index.html) — **${stats.items} items** (definitions, lemmas, theorems) across **${stats.chapters} chapters**, with ${stats.edges} dependency edges.`,
      "",
      `**[→ Dependency graph (canvas)](dep-graph.canvas)** · [original](${BASE}/dep_graph_document.html)`,
    ],
  }

  return { items, itemByLabel, chapters, edges, meta }
}

// ---------------------------------------------------------------- emit (shared)
async function emitAll(model) {
  const { items, itemByLabel, chapters, edges, meta } = model

  const usesOf = new Map(items.map((it) => [it.label, []]))
  const usedByOf = new Map(items.map((it) => [it.label, []]))
  for (const e of edges) {
    usesOf.get(e.to)?.push({ label: e.from, dashed: e.dashed })
    usedByOf.get(e.from)?.push({ label: e.to, dashed: e.dashed })
  }

  const sizeByLabel = new Map(items.map((it) => [it.label, it.size]))
  const layout = await computeLayout(buildLayoutDot(items, edges), sizeByLabel)

  fs.rmSync(path.join(CONTENT, OUT), { recursive: true, force: true })

  const depKindNote = (dashed) => (dashed ? "statement" : "proof")
  const depLine = (fromItem, dep) => {
    const t = itemByLabel.get(dep.label)
    return `- [${t.title}](${relHrefItems(fromItem, t)}) — ${depKindNote(dep.dashed)}`
  }

  for (const item of items) {
    const ctx = { itemByLabel, fromItem: item }
    const resolveFromItem = (t) => (t === item ? null : relHrefItems(item, t))
    const planProse = (src) =>
      item.format === "md"
        ? rewriteMdRefs(src, itemByLabel, resolveFromItem)
        : planTexToMd(src, ctx)
    const parts = []

    parts.push("## Statement")
    const stmt =
      item.statementTex !== undefined
        ? planProse(item.statementTex)
        : item.modal?.contentEl
          ? proseMd(item.modal.contentEl.children, ctx)
          : ""
    parts.push(stmt || "_Statement not available._")

    const proof = item.proofTex
      ? planProse(item.proofTex)
      : item.proofEl
        ? proseMd(item.proofEl.children, ctx)
        : ""
    if (proof) parts.push("## Proof", proof)
    if (item.leanSection) parts.push(item.leanSection)

    const uses = (usesOf.get(item.label) || []).map((d) => depLine(item, d))
    const usedBy = (usedByOf.get(item.label) || []).map((d) => depLine(item, d))
    if (uses.length || usedBy.length) {
      const dep = ["## Dependencies"]
      if (uses.length) dep.push("**Uses:**", "", uses.join("\n"))
      if (usedBy.length) dep.push((uses.length ? "\n" : "") + "**Used by:**", "", usedBy.join("\n"))
      parts.push(dep.join("\n"))
    }

    const links = [
      "## Links",
      ...(item.linkLines ?? []),
      `- [Dependency canvas](../dep-graph.canvas)`,
    ]
    parts.push(links.join("\n"))

    const front = fm({
      title: item.title,
      description: `${SITE_LABEL} — ${cap(item.kind)}${item.number ? " " + item.number : ""} (${item.displayName})`,
      type: item.kind,
      status: item.status.label,
      status_short: item.status.short,
      blueprint_label: item.label,
      chapter: item.chapter.num,
      number: item.number || undefined,
      statement_status: item.status.statement,
      proof_status: item.status.proof,
      sorries: item.sorries > 0 ? item.sorries : undefined,
      dot_border: item.dotNode?.border,
      dot_fill: item.dotNode?.fill,
      url: item.url,
      lean_decls: item.leanDeclNames ?? [],
      tags: ["blueprint", item.kind],
    })
    write(itemFileRel(item), front + parts.join("\n\n") + "\n")
  }

  // ---- chapter folders
  const chapterList = [...chapters.values()]
    .filter((c) => c.items.length)
    .sort((a, b) => a.num - b.num)
  for (const ch of chapterList) {
    ch.items.sort(numCompare)
    write(
      `${OUT}/${ch.slug}/_meta.json`,
      JSON.stringify(
        { label: `${ch.num ? ch.num + ". " : ""}${ch.title}`, pages: ch.items.map((i) => i.slug) },
        null,
        2,
      ) + "\n",
    )
    const lines = ch.items.map((i) => `- [${i.title}](${i.slug}.md) — ${i.status.label}`)
    const chIntro = ch.intro
      ? rewriteMdRefs(ch.intro, itemByLabel, (t) =>
          t.chapter === ch ? `${t.slug}.md` : `../${t.chapter.slug}/${t.slug}.md`,
        ) + "\n\n"
      : ""
    write(
      `${OUT}/${ch.slug}/index.md`,
      fm({
        title: `${ch.num ? ch.num + ". " : ""}${ch.title}`,
        type: "blueprint-chapter",
        chapter: ch.num,
        tags: ["blueprint", "chapter"],
      }) +
        (ch.file ? `Original: [${ch.title}](${BASE}/${ch.file})\n\n` : "") +
        chIntro +
        "## Items\n\n" +
        lines.join("\n") +
        "\n",
    )
  }

  // ---- canvas
  const canvasNodes = []
  const canvasEdges = []
  for (const item of items) {
    const p = layout.get(item.label)
    if (!p) {
      console.warn("no layout position for:", item.label)
      continue
    }
    canvasNodes.push({
      id: item.slug,
      type: "file",
      file: itemFileRel(item),
      ...(EMBED === "statement" ? { subpath: "#statement" } : {}),
      x: p.x,
      y: p.y,
      width: item.size.w,
      height: item.size.h,
      ...(item.color ? { color: item.color } : {}),
    })
  }
  edges.forEach((e, i) => {
    canvasEdges.push({
      id: `e${i}`,
      fromNode: itemByLabel.get(e.from).slug,
      fromSide: "bottom",
      toNode: itemByLabel.get(e.to).slug,
      toSide: "top",
      // dashed = \uses on the statement; solid purple = \uses in the proof.
      // `dashed` is a local canvas-page fork extension field.
      ...(e.dashed ? { dashed: true } : { color: "6" }),
    })
  })
  write(
    `${OUT}/dep-graph.canvas`,
    JSON.stringify({ nodes: canvasNodes, edges: canvasEdges, legend: meta.legend }, null, 2) + "\n",
  )

  // ---- blueprint root
  write(
    `${OUT}/_meta.json`,
    JSON.stringify(
      {
        label: SITE_LABEL,
        pages: [
          { page: "dep-graph", type: "canvas", title: "Dependency canvas" },
          ...chapterList.map((c) => c.slug),
        ],
      },
      null,
      2,
    ) + "\n",
  )
  const statusCounts = {}
  for (const it of items) statusCounts[it.status.label] = (statusCounts[it.status.label] || 0) + 1
  const stats = { items: items.length, chapters: chapterList.length, edges: edges.length }
  write(
    `${OUT}/index.md`,
    fm({
      title: SITE_LABEL,
      description: `Blueprint: ${items.length} items across ${chapterList.length} chapters`,
      type: "blueprint-index",
      tags: ["blueprint"],
    }) +
      [
        ...meta.landingLines(stats),
        "",
        "## Formalization status",
        "",
        ...Object.entries(statusCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `- ${v} × ${k}`),
        "",
        "## Chapters",
        "",
        ...chapterList.map((c) => `- [${c.num ? c.num + ". " : ""}${c.title}](${c.slug}/)`),
        "",
        "Use the sidebar to browse chapters, the canvas to explore the dependency graph, and the backlinks panel on any item to see what uses it.",
        "",
      ].join("\n"),
  )

  // ---- root <contentRoot>/_meta.json merge
  const rootMetaPath = path.join(CONTENT, "_meta.json")
  const rootMeta = JSON.parse(fs.readFileSync(rootMetaPath, "utf8"))
  if (!rootMeta.pages.includes(OUT)) {
    rootMeta.pages.push(OUT)
    fs.writeFileSync(rootMetaPath, JSON.stringify(rootMeta, null, 2) + "\n")
  }

  console.log(
    `Wrote ${written} files: ${items.length} items, ${chapterList.length} chapters, ${edges.length} edges (${canvasNodes.length} canvas nodes).`,
  )
}

// ---------------------------------------------------------------- main
async function main() {
  const model = PLAN ? buildModelFromPlan() : await buildModelFromSite()
  await emitAll(model)
}

main()
