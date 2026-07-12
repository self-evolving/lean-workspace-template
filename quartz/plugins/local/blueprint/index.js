// Blueprint transformer (blueprint-as-source): turns the authored chapter sources
// (markdown chapters and woven literate .lean chapters) into the rendered blueprint —
//   - item headings `## Kind: Name {#label uses=... lean=...}` lose their attribute
//     braces, gain a concise numbered prose title, an anchor id equal to the label,
//     and a subtle status marker;
//   - `[text](#label)` cross-references resolve to the owning chapter page + anchor;
//   - ```lean anchor=NAME / decl=Full.Name fenced blocks are inlined from the sources;
//   - md-chapter items with `lean="..."` and no in-situ code get their declaration
//     source appended automatically (suppress with `code=none`).
//
// The model (chapters/items/statuses/edges) is built once per build from
// <contentRoot>/<root>/ + blueprint-data.json and cached by mtime.

import fs from "node:fs"
import path from "node:path"
import GithubSlugger from "github-slugger"
import { visit } from "unist-util-visit"
import {
  buildSourceModel,
  buildAnchorIndex,
  declSnippet,
  parseAttrStr,
  anchorOf,
  loadBlueprintConfig,
  githubSourceUrl,
  repoRelativePath,
  sourceRef,
} from "../../../../scripts/lib/blueprint-model.mjs"

const defaultOptions = {}

// ---- model cache (keyed on EVERY model input: chapter sources, kernel data,
// and lean snippet sources outside the blueprint dir — plus the resolved config)
const statSig = (p) => {
  try {
    return p + ":" + fs.statSync(p).mtimeMs
  } catch {
    return p + ":absent"
  }
}

function* leanFilesUnder(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* leanFilesUnder(p)
    else if (e.name.endsWith(".lean")) yield p
  }
}

function modelCacheKey(cfg) {
  const parts = []
  for (const f of fs.readdirSync(cfg.blueprintDir)) {
    parts.push(statSig(path.join(cfg.blueprintDir, f)))
  }
  parts.push(statSig(cfg.dataPath))
  for (const dir of cfg.leanSrcDirs) {
    if (path.resolve(dir) === path.resolve(cfg.blueprintDir)) continue
    for (const f of leanFilesUnder(dir)) parts.push(statSig(f))
  }
  return parts.join("|") + "|cfg:" + JSON.stringify(cfg)
}

let cache = null
function getModel(cfg, { failHard = false } = {}) {
  if (!fs.existsSync(cfg.blueprintDir)) return null
  const key = modelCacheKey(cfg)
  if (cache?.key === key) return cache.value
  let value = null
  try {
    const model = buildSourceModel({
      blueprintDir: cfg.blueprintDir,
      dataPath: fs.existsSync(cfg.dataPath) ? cfg.dataPath : null,
      leanSrcDirs: cfg.leanSrcDirs,
    })
    const usesOf = new Map(model.items.map((it) => [it.label, []]))
    const usedByOf = new Map(model.items.map((it) => [it.label, []]))
    for (const e of model.edges) {
      usesOf.get(e.to)?.push({ label: e.from, dashed: e.dashed })
      usedByOf.get(e.from)?.push({ label: e.to, dashed: e.dashed })
    }
    const anchors = buildAnchorIndex(cfg.leanSrcDirs)
    value = { ...model, usesOf, usedByOf, anchors }
  } catch (e) {
    // The Lean-free site build is the deployment validator — a broken model must
    // fail it, not ship pages without pills/refs/snippets. Only the dev server
    // degrades (warn + render plain) so a mid-edit error doesn't kill the watcher.
    if (failHard) {
      e.message = `blueprint: model build failed — ${e.message}`
      throw e
    }
    console.warn("blueprint: model build failed (rendering degraded):", e.message)
  }
  cache = { key, value }
  return value
}

// ---- rendering helpers
const capitalize = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase())

export function itemMetaLabel(item) {
  return [capitalize(item.kind), item.number].filter(Boolean).join(" ")
}

export function itemDisplayTitle(item) {
  const title = String(item.title ?? "").trim()
  const sep = title.indexOf(" · ")
  return sep >= 0 ? title.slice(sep + 3).trim() : title
}

export function itemHeadingTitle(item) {
  const meta = itemMetaLabel(item)
  const title = itemDisplayTitle(item)
  if (meta && title) return `${meta} · ${title}`
  return title || meta
}

function chapterHref(fromSlug, toItem, root) {
  // both chapter pages live in the same folder; same-page refs use the bare anchor.
  // anchors are github-slugged so they survive crawl-links/rehype-slug untouched.
  const anchor = anchorOf(toItem.label)
  const target = `${root}/${toItem.chapter.slug}`
  if (fromSlug === target) return `#${anchor}`
  return `${toItem.chapter.slug}.md#${anchor}`
}

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

function snippetRepoPath(cfg, snippet) {
  if (snippet.absPath) {
    const rel = repoRelativePath(cfg.repoRoot, snippet.absPath)
    if (rel) return rel
  }
  return path.posix.join(path.basename(snippet.baseDir), snippet.file)
}

function sourceLocHtml(cfg, snippet) {
  const repoPath = snippetRepoPath(cfg, snippet)
  const loc = `${repoPath}:${snippet.startLine}–${snippet.endLine}`
  const href = githubSourceUrl(cfg.repo, repoPath, {
    ref: sourceRef(),
    startLine: snippet.startLine,
    endLine: snippet.endLine,
  })
  const locHtml = `<code>${escapeHtml(loc)}</code>`
  return href
    ? `<a class="bp-src-link" href="${href}" target="_blank" rel="noopener noreferrer">${locHtml}</a>`
    : locHtml
}

function sourceLineHtml(cfg, name, snippet) {
  return `<div class="bp-code-header"><span class="bp-code-decl"><code>${escapeHtml(name)}</code></span><span class="bp-code-source">${sourceLocHtml(cfg, snippet)}</span></div>`
}

function sourceLineNode(cfg, name, model) {
  if (!name) return null
  const s = declSnippet(model.kernel.get(name), model.srcDirs)
  return s ? { type: "html", value: sourceLineHtml(cfg, name, s) } : null
}

const LEAN_DECL_RE =
  /^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|unsafe|partial|scoped)\s+)*(?:def|theorem|lemma|abbrev|inductive|structure|class|instance|opaque)\s+([A-Za-z_«][^\s({\[:]*)/

export function firstLeanDeclName(code) {
  const nsStack = []
  for (const line of String(code ?? "").split("\n")) {
    const ns = line.match(/^\s*namespace\s+([A-Za-z_«][\w«»'.]*)/)
    if (ns) {
      nsStack.push(ns[1])
      continue
    }
    const decl = line.match(LEAN_DECL_RE)
    if (decl) {
      const name = decl[1]
      return nsStack.length && !name.includes(".") ? `${nsStack.join(".")}.${name}` : name
    }
    const end = line.match(/^\s*end(?:\s+([A-Za-z_«][\w«»'.]*))?\s*$/)
    if (end && nsStack.length && (!end[1] || nsStack[nsStack.length - 1] === end[1])) {
      nsStack.pop()
    }
  }
  return null
}

export function itemDeclForCode(item, code) {
  const codeDecl = firstLeanDeclName(code)
  if (!codeDecl) return null
  return (item.leanDeclNames ?? []).find((decl) => decl === codeDecl) ?? null
}

function leanAutoBlocks(item, model, cfg) {
  const blocks = []
  for (const name of item.leanDeclNames ?? []) {
    const s = declSnippet(model.kernel.get(name), model.srcDirs)
    if (!s) continue
    blocks.push({ type: "html", value: sourceLineHtml(cfg, name, s) })
    blocks.push({ type: "code", lang: "lean", value: s.code })
  }
  return blocks
}

function labelAnchorNode(id) {
  return { type: "html", value: `<span id="${escapeHtml(id)}" class="bp-label-anchor"></span>` }
}

function statusMarkerElement(item) {
  const label = `Status: ${item.status.short}`
  const c = item.color ?? "var(--lightgray)"
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["bp-status-marker"],
      style: `--bp-status-color:${c}`,
      "data-status": label,
      "aria-label": label,
      title: label,
      role: "img",
      tabIndex: 0,
    },
    children: [],
  }
}

export const BlueprintTransformer = (userOpts) => {
  const _opts = { ...defaultOptions, ...userOpts }
  return {
    name: "BlueprintTransformer",
    markdownPlugins(ctx) {
      const contentDir = ctx.argv.directory
      const cfg = loadBlueprintConfig(path.resolve(contentDir, ".."))
      // production builds (npm run build / CI) fail loudly on a broken model;
      // the dev server (--serve) degrades with a warning instead. The eager call
      // surfaces the failure at build start rather than per page.
      const failHard = !ctx.argv.serve
      getModel(cfg, { failHard })
      return [
        () => (tree, file) => {
          const slug = file.data.slug ?? ""
          if (!(slug === cfg.root || slug.startsWith(cfg.root + "/"))) return
          const model = getModel(cfg, { failHard })
          if (!model) return

          // 1) rewrite cross-reference links [text](#label)
          visit(tree, "link", (node) => {
            if (!node.url?.startsWith("#")) return
            const item = model.itemByLabel.get(node.url.slice(1))
            if (!item) return
            node.url = chapterHref(slug, item, cfg.root)
            if (!node.children?.length) node.children = [{ type: "text", value: item.title }]
          })

          // 2) inline ```lean anchor= / decl= blocks
          visit(tree, "code", (node) => {
            if (node.lang !== "lean" || !node.meta) return
            const meta = parseAttrStr(node.meta)
            if (meta.anchor) {
              const a = model.anchors.get(meta.anchor)
              if (a) node.value = a.lines.join("\n").trim()
              else console.warn(`blueprint: unknown anchor "${meta.anchor}" in ${slug}`)
              node.data = { ...(node.data ?? {}), blueprintSourceSuppress: true }
            } else if (meta.decl) {
              const s = declSnippet(model.kernel.get(meta.decl), model.srcDirs)
              if (s) {
                node.value = s.code
                node.data = { ...(node.data ?? {}), blueprintSourceDecl: meta.decl }
              } else console.warn(`blueprint: no source for decl "${meta.decl}" in ${slug}`)
            } else if (meta.sourceDecl) {
              node.data = { ...(node.data ?? {}), blueprintSourceDecl: meta.sourceDecl }
            }
            node.meta = null
          })

          // 3) item / proof headings: strip attrs, retitle, subtle status, auto-code
          const inserts = [] // { index, nodes, order } — applied in reverse
          const addInsert = (index, nodes, order = 0) => inserts.push({ index, nodes, order })
          const children = tree.children
          const tocSlugger = new GithubSlugger()
          const registerTocHeading = (text, depth) => (depth <= 3 ? tocSlugger.slug(text) : null)
          for (let i = 0; i < children.length; i++) {
            const node = children[i]
            if (node.type !== "heading") continue
            // mdast heading text carries no "## " prefix — match the trailing {attrs}
            const flat = flattenHeadingText(node)
            const am = flat.match(/\{([^}]*)\}\s*$/)
            const display = flat.replace(/\s*\{[^}]*\}\s*$/, "").trim()
            const attrs = parseAttrStr(am?.[1])
            if (node.depth === 2 && attrs.id && model.itemByLabel.has(attrs.id)) {
              const item = model.itemByLabel.get(attrs.id)
              const title = itemHeadingTitle(item)
              const tocAnchor = registerTocHeading(title, node.depth)
              const itemAnchor = anchorOf(item.label)
              const headingAnchor = tocAnchor ?? itemAnchor
              node.children = [{ type: "text", value: title }]
              node.data = {
                ...(node.data ?? {}),
                hProperties: {
                  id: headingAnchor,
                  className: ["bp-item-heading"],
                },
                hChildren: [{ type: "text", value: title }, statusMarkerElement(item)],
              }
              if (headingAnchor !== itemAnchor) addInsert(i, [labelAnchorNode(itemAnchor)], 0)
              // Add source links only to declaration-backed Lean code blocks.
              // Explicit decl= fences carry their declaration even when the item
              // has no lean= attr; woven literate blocks are inferred from the
              // declaration they contain. Plain examples and anchor= snippets do
              // not inherit item-level declaration links.
              let hasLean = false
              let end = children.length
              for (let j = i + 1; j < children.length; j++) {
                if (children[j].type === "heading" && children[j].depth <= 2) {
                  end = j
                  break
                }
                if (children[j].type !== "code" || children[j].lang !== "lean") continue
                hasLean = true
                if (children[j].data?.blueprintSourceSuppress) continue
                const explicitDecl = children[j].data?.blueprintSourceDecl
                const inferredDecl = explicitDecl ? null : itemDeclForCode(item, children[j].value)
                const src = sourceLineNode(cfg, explicitDecl ?? inferredDecl, model)
                if (src) addInsert(j, [src], 0)
              }
              // auto code: only when the item's range has no lean code block
              if (!hasLean && !item.codeNone && (item.leanDeclNames ?? []).length) {
                addInsert(end, leanAutoBlocks(item, model, cfg), 0)
              }
            } else if (node.depth === 3 && /^proof\b/i.test(display)) {
              node.depth = 4
              node.children = [{ type: "text", value: "Proof" }]
            } else if (am) {
              // strip stray attr braces from any other heading
              node.children = [{ type: "text", value: display }]
              registerTocHeading(display, node.depth)
            } else {
              registerTocHeading(flat, node.depth)
            }
          }
          inserts.sort((a, b) => b.index - a.index || a.order - b.order)
          for (const insert of inserts) children.splice(insert.index, 0, ...insert.nodes)
        },
      ]
    },
  }
}

function flattenHeadingText(node) {
  let out = ""
  visit(node, "text", (t) => {
    out += t.value
  })
  return out
}

export default BlueprintTransformer
