// Shared blueprint model library.
//
// Consumed by three clients:
//   - scripts/import-blueprint.mjs        (legacy scrape/tex/md importer modes)
//   - quartz/plugins/local/blueprint      (build-time transformer: pills/refs/code)
//   - scripts/generate-canvas.mjs         (dep-graph.canvas generator)
//
// The "blueprint-as-source" model: <contentRoot>/blueprint/ holds the chapters
// directly — markdown files (plan-stage) and literate .lean files (prose in
// /-! -/ doc blocks, real declarations between them). `weaveLeanToMd` converts a
// .lean chapter to markdown; `buildSourceModel` parses the whole directory
// (order from _meta.json), joins kernel data (blueprint-data.json from
// `lake exe blueprint-data`) and computes statuses. \leanok is deliberately
// ignored: the kernel arbitrates.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import GithubSlugger from "github-slugger"

// Anchor id for an item label, matching what Quartz's link/heading sluggers
// produce (github-slugger): "thm:sumOdds-eq-sq" -> "thmsumodds-eq-sq".
export const anchorOf = (label) => new GithubSlugger().slug(label)

// ---------------------------------------------------------------- config
// blueprint.config.json at the repo root. The two main knobs are deliberately
// independent: `source` is the authoring decision (where the prose lives
// relative to the code); `pageMode` is a rendering choice available to any source.
export const DEFAULT_BLUEPRINT_CONFIG = {
  contentRoot: "content", // Quartz content root; override only if the project moves content/
  root: "blueprint", // <contentRoot>/<root>/
  source: { type: "dir" }, // dir | plan | scrape (legacy side doors) | architect (future)
  pageMode: "chapter", // chapter | item
  lakeRoots: [], // root modules passed to `lake exe blueprint-data`
  leanSrcDirs: null, // snippet lookup dirs (default: the blueprint dir; set to your library when adopting code)
  data: null, // kernel JSON path (default: <contentRoot>/<root>/blueprint-data.json)
  repo: null, // "owner/name", used for discussion= issue links
}

export function loadBlueprintConfig(repoRoot, overrides = {}) {
  let raw = {}
  let entry = {}
  const p = path.join(repoRoot, "blueprint.config.json")
  if (fs.existsSync(p)) {
    try {
      raw = JSON.parse(fs.readFileSync(p, "utf8"))
      entry = (raw.blueprints ?? [])[0] ?? {}
    } catch (e) {
      console.warn(`blueprint: failed to parse ${p}: ${e.message}`)
    }
  }
  const cfg = {
    ...DEFAULT_BLUEPRINT_CONFIG,
    ...(raw.contentRoot ? { contentRoot: raw.contentRoot } : {}),
    ...entry,
    ...overrides,
  }
  cfg.repoRoot = repoRoot
  cfg.contentDir = path.resolve(repoRoot, cfg.contentRoot)
  cfg.blueprintDir = path.join(cfg.contentDir, cfg.root)
  cfg.dataPath = cfg.data
    ? path.resolve(repoRoot, cfg.data)
    : path.join(cfg.blueprintDir, "blueprint-data.json")
  cfg.leanSrcDirs = (cfg.leanSrcDirs ?? [path.join(cfg.contentRoot, cfg.root)]).map((d) =>
    path.resolve(repoRoot, d),
  )
  return cfg
}

let cachedSourceRef = null
export function sourceRef(fallback = "main") {
  if (cachedSourceRef) return cachedSourceRef
  try {
    cachedSourceRef = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (cachedSourceRef) return cachedSourceRef
  } catch {}
  cachedSourceRef =
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.COMMIT_REF ||
    fallback
  return cachedSourceRef
}

export function repoRelativePath(repoRoot, absPath) {
  const rel = path.relative(repoRoot, absPath)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join("/")
}

export function githubSourceUrl(repo, repoPath, { ref = sourceRef(), startLine, endLine } = {}) {
  if (!repo || !repoPath) return null
  const normalizedRepo = String(repo)
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\/+$/, "")
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalizedRepo)) return null

  const cleanPath = String(repoPath)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")
  if (!cleanPath) return null

  const cleanRef = String(ref || "main").trim() || "main"
  const start = Number(startLine)
  const end = Number(endLine)
  const fragment =
    Number.isInteger(start) && start > 0
      ? `#L${start}${Number.isInteger(end) && end > start ? `-L${end}` : ""}`
      : ""
  return `https://github.com/${normalizedRepo}/blob/${encodeURIComponent(cleanRef)}/${cleanPath}${fragment}`
}

// ---------------------------------------------------------------- small utils
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item"

export function makeUniqueSlugger() {
  const seen = new Map()
  return (s) => {
    const base = slugify(s)
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}-${n + 1}`
  }
}

const KIND_PREFIX_RE =
  /^(definition|def|lemma|lem|theorem|thm|proposition|prop|corollary|cor)\s*:\s*/i
export const displayNameOf = (label) => label.replace(KIND_PREFIX_RE, "").trim() || label

const numKey = (number) => (number ? number.split(".").map(Number) : [Infinity])
export const numCompare = (a, b) => {
  const ka = numKey(a.number)
  const kb = numKey(b.number)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (d) return d
  }
  return a.slug.localeCompare(b.slug)
}

// ---------------------------------------------------------------- attribute / plan parsing
export function parseAttrStr(s) {
  const out = {}
  if (!s) return out
  for (const m of s.matchAll(/#([^\s"}]+)|([\w-]+)=(?:"([^"]*)"|([^\s"}]+))|([\w-]+)/g)) {
    if (m[1] !== undefined) out.id = m[1]
    else if (m[2] !== undefined) out[m[2]] = m[3] ?? m[4]
    else if (m[5] !== undefined) out[m[5]] = true
  }
  return out
}

export const splitList = (s) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)

export const PLAN_ENV_KINDS = ["definition", "lemma", "proposition", "theorem", "corollary"]
const MD_KIND_RE = new RegExp(`^(${PLAN_ENV_KINDS.join("|")})\\s*:\\s*(.*)$`, "i")

export const HEADING_ATTR_RE = /^ {0,3}(#{1,3})\s+(.*?)(?:\s*\{([^}]*)\})?\s*$/

// Parse markdown plan sources ({ name, src } entries) into chapters:
// '# Title' = chapter (+ intro prose), '## Kind: Name {attrs}' = item,
// '### Proof {attrs}' = proof. Items carry raw md bodies (format: "md").
export function parsePlanMdSources(entries) {
  const chapters = []
  let chapter = null
  let item = null
  let target = null

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

  for (const { name, src } of entries) {
    let inFence = false
    for (const line of src.split("\n")) {
      if (/^\s*```/.test(line)) inFence = !inFence
      if (!inFence) {
        const h = line.match(HEADING_ATTR_RE)
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
                // presence matters: uses="" explicitly overrides inference to zero deps
                usesGiven: attrs.uses !== undefined,
                discussion: attrs.discussion ? Number(attrs.discussion) : null,
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
            console.warn(`plan(md): H2 "${text}" in ${name} is not "Kind: Name" — treated as prose`)
          }
          if (level === 3 && item && /^proof$/i.test(text)) {
            item.proof = {
              uses: splitList(attrs.uses),
              usesGiven: attrs.uses !== undefined,
              leanok: false,
              tex: "",
            }
            target = item.proofLines
            continue
          }
        }
      }
      if (target) target.push(line)
      else if (line.trim())
        console.warn(
          `plan(md): prose before first chapter ignored in ${name}: ${line.slice(0, 60)}`,
        )
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

// ---------------------------------------------------------------- tex plan parsing
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

export function parsePlanTex(src) {
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
      current = { title: m[1].replace(/\s+/g, " ").trim(), items: [] }
      chapters.push(current)
      continue
    }
    if (!current) {
      current = { title: "Blueprint", items: [] }
      chapters.push(current)
    }
    const item = {
      kind: m[2],
      caption: m[3] ? m[3].replace(/\s+/g, " ").trim() : null,
      format: "tex",
      codeNone: false,
      ...parseEnvDirectives(m[4]),
    }
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

// Lean chapter weave lives in its own dependency-light module (imported by the
// Quartz core parser); re-exported here for model consumers.
export { weaveLeanToMd, weaveWithFrontmatter, leanChapterTitle } from "./lean-weave.mjs"
import { weaveLeanToMd } from "./lean-weave.mjs"

// ---------------------------------------------------------------- status model
// Statuses are computed from kernel data; \leanok is ignored.
export const STATUS_STYLES = {
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

export function readKernel(dataPath) {
  if (!dataPath || !fs.existsSync(dataPath)) return new Map()
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"))
  return new Map((raw.decls ?? []).map((d) => [d.name, d]))
}

// Join kernel data, compute statuses/colors and the edge list. Mutates items.
//
// Dependency edges are kernel-INFERRED for formalized items (LeanArchitect-style):
// typeUses → statement-level (dashed), valueUses → proof-level (solid). An explicit
// `uses=` on the item / its Proof heading OVERRIDES inference for that part — needed
// for plan-stage items (no Lean yet) and sorry'd proofs (intended deps aren't in the
// term), and available to prune incidental kernel edges.
export function computeStatusesAndEdges(items, itemByLabel, kernel) {
  // lean decl -> owning item, for mapping kernel constants onto blueprint items
  const declOwner = new Map()
  for (const item of items) for (const n of item.leanDeclNames) declOwner.set(n, item)

  for (const item of items) {
    item.declsFound = item.leanDeclNames.map((n) => kernel.get(n)).filter(Boolean)
    item.declsOk =
      item.leanDeclNames.length > 0 && item.declsFound.length === item.leanDeclNames.length
    item.sorries = item.declsFound.filter((d) => d.hasSorry).length
    for (const n of item.leanDeclNames)
      if (!kernel.has(n)) console.warn(`plan: lean decl ${n} on ${item.label} not in kernel data`)
    for (const l of [...item.stmtUses, ...item.proofUses])
      if (!itemByLabel.has(l)) console.warn(`plan: ${item.label} uses ${l} — unknown label`)

    // kernel-inferred dependencies (definitions have no proof part: everything
    // their body touches counts as statement-level)
    const inferredStmt = []
    const inferredProof = []
    if (item.declsOk) {
      const add = (arr, names) => {
        for (const u of names ?? []) {
          const owner = declOwner.get(u)
          if (owner && owner !== item && !arr.includes(owner.label)) arr.push(owner.label)
        }
      }
      for (const d of item.declsFound) {
        if (item.kind === "definition") {
          add(inferredStmt, d.typeUses ?? d.usedConstants)
          add(inferredStmt, d.valueUses)
        } else {
          add(inferredStmt, d.typeUses ?? [])
          add(inferredProof, d.valueUses ?? d.usedConstants)
        }
      }
    }
    // override on PRESENCE, not list length: `uses=""` explicitly prunes every
    // inferred edge for that part (the documented escape hatch)
    item.effStmtUses = item.stmtUsesGiven ? item.stmtUses : inferredStmt
    item.effProofUses = item.proofUsesGiven ? item.proofUses : inferredProof

    // informational: explicit annotations that name deps absent from the kernel.
    // Omitting inferred deps is the documented pruning escape hatch (including
    // `uses=""`), so subset overrides stay quiet. Sorry'd proofs also rely on
    // explicit intended deps because there is no proof term to infer from yet.
    if (item.declsOk && item.sorries === 0 && (item.stmtUsesGiven || item.proofUsesGiven)) {
      const inferred = new Set([...inferredStmt, ...inferredProof])
      const planned = new Set([
        ...(item.stmtUsesGiven ? item.stmtUses : []),
        ...(item.proofUsesGiven ? item.proofUses : []),
      ])
      for (const l of planned)
        if (!inferred.has(l))
          console.warn(
            `plan/kernel: ${item.label} declares ${l} in uses=, but the kernel did not infer it`,
          )
    }
  }

  const cleanMemo = new Map()
  const isClean = (item, stack = new Set()) => {
    if (cleanMemo.has(item.label)) return cleanMemo.get(item.label)
    if (stack.has(item.label)) return false
    stack.add(item.label)
    const deps = [...item.effStmtUses, ...item.effProofUses]
      .map((l) => itemByLabel.get(l))
      .filter(Boolean)
    const ok = item.declsOk && item.sorries === 0 && deps.every((d) => isClean(d, stack))
    cleanMemo.set(item.label, ok)
    return ok
  }

  for (const item of items) {
    const stmtDeps = item.effStmtUses.map((l) => itemByLabel.get(l)).filter(Boolean)
    const allDeps = [...item.effStmtUses, ...item.effProofUses]
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
  }

  // edges: dashed = statement-level uses, solid = proof-level uses
  const edgeMap = new Map()
  for (const item of items) {
    for (const l of item.effStmtUses)
      if (itemByLabel.has(l))
        edgeMap.set(`${l}\x00${item.label}`, { from: l, to: item.label, dashed: true })
    for (const l of item.effProofUses) {
      const k = `${l}\x00${item.label}`
      if (itemByLabel.has(l) && !edgeMap.has(k))
        edgeMap.set(k, { from: l, to: item.label, dashed: false })
    }
  }
  return [...edgeMap.values()]
}

// ---------------------------------------------------------------- Lean source snippets
function* walkLeanFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkLeanFiles(p)
    else if (e.name.endsWith(".lean")) yield p
  }
}

const ANCHOR_RE = /^\s*--\s*ANCHOR(_END)?:\s*(\S+)\s*$/

export function buildAnchorIndex(srcDirs) {
  const anchors = new Map()
  for (const dir of srcDirs) {
    if (!fs.existsSync(dir)) continue
    for (const file of walkLeanFiles(dir)) {
      const rel = path.relative(dir, file)
      const lines = fs.readFileSync(file, "utf8").split("\n")
      const open = new Map()
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
  }
  return anchors
}

export const dedentLines = (lines) => {
  const nonEmpty = lines.filter((l) => l.trim())
  const indent = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)[0].length), 99)
  return lines
    .map((l) => l.slice(indent))
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
}

// Slice a declaration's source from disk (file resolved over srcDirs), extending
// upward through a contiguous doc comment and attribute lines.
export function declSnippet(decl, srcDirs) {
  if (!decl?.file || !decl.startLine) return null
  let abs = null
  let baseDir = null
  for (const dir of srcDirs) {
    const candidate = path.join(dir, decl.file)
    if (fs.existsSync(candidate)) {
      abs = candidate
      baseDir = dir
      break
    }
  }
  if (!abs) return null
  const lines = fs.readFileSync(abs, "utf8").split("\n")
  let start = decl.startLine - 1
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
    absPath: abs,
    baseDir,
    startLine: start + 1,
    endLine: decl.endLine,
    code: dedentLines(lines.slice(start, decl.endLine)),
  }
}

export function inlineCodeBlocks(md, anchors, kernel, where, srcDirs) {
  let sawLean = false
  const out = md.replace(/```lean([^\n]*)\n([\s\S]*?)```/g, (full, metaStr, body) => {
    sawLean = true
    const meta = parseAttrStr(metaStr.trim())
    if (meta.anchor) {
      const a = anchors.get(meta.anchor)
      if (!a) {
        console.warn(`plan: unknown anchor "${meta.anchor}" in ${where}`)
        return full
      }
      return "```lean\n" + dedentLines(a.lines) + "\n```"
    }
    if (meta.decl) {
      const s = declSnippet(kernel.get(meta.decl), srcDirs)
      if (!s) {
        console.warn(`plan: no source range for decl "${meta.decl}" in ${where}`)
        return full
      }
      return "```lean\n" + s.code + "\n```"
    }
    return full
  })
  return { md: out, sawLean }
}

export function buildLeanSection(item, kernel, srcDirs) {
  const blocks = []
  for (const name of item.leanDeclNames ?? []) {
    const s = declSnippet(kernel.get(name), srcDirs)
    if (!s) continue
    const loc = path.posix.join(path.basename(s.baseDir), s.file)
    blocks.push(
      `**\`${name}\`** — \`${loc}:${s.startLine}–${s.endLine}\`\n\n` +
        "```lean\n" +
        s.code +
        "\n```",
    )
  }
  return blocks.length ? "## Lean\n\n" + blocks.join("\n\n") : null
}

export function rewriteMdRefs(md, itemByLabel, resolve) {
  return md.replace(/\[([^\]]*)\]\(#([^)\s]+)\)/g, (full, text, label) => {
    const t = itemByLabel.get(label)
    if (!t) return full
    const href = resolve(t)
    if (!href) return text || t.title
    return `[${text || t.title}](${href})`
  })
}

// ---------------------------------------------------------------- card sizing + layout
export const NODE_W = 331
export const NODE_H = 187
const CARD_MIN_W = 150
const CARD_MAX_W = 300
const CARD_CHROME_W = 28
const CARD_H_1LINE = 64
const CARD_H_2LINE = 82

export function cardSize(item, embed = "card") {
  if (embed === "statement") return { w: NODE_W, h: NODE_H }
  const kindLine = `${cap(item.kind)}${item.number ? " " + item.number : ""}`
  const name = item.displayName ?? displayNameOf(item.label)
  const titleLen = name.length
  const titleW = Math.ceil(titleLen * 8.2)
  const kindW = Math.ceil(kindLine.length * 7.8)
  const statusW = Math.ceil(item.status.short.length * 4.9) + 16
  const maxInner = CARD_MAX_W - CARD_CHROME_W
  const lines = Math.ceil(titleLen * 8.8) > maxInner ? 2 : 1
  const effTitleW = lines === 2 ? Math.min(Math.ceil(titleW / 2) + 16, maxInner) : titleW
  const inner = Math.max(effTitleW, kindW, statusW)
  return {
    w: Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, inner + CARD_CHROME_W)),
    h: lines === 2 ? CARD_H_2LINE : CARD_H_1LINE,
  }
}

// (graphviz layout lives in blueprint-layout.mjs — canvas-only, so the Quartz
// transformer never loads @hpcc-js/wasm-graphviz)

// ---------------------------------------------------------------- blueprint-as-source model
// Read the configured blueprint directory directly: _meta.json gives chapter order;
// each entry is a .md or .lean chapter file. Returns { chapters, items,
// itemByLabel, edges }.
// Chapter slugs match Quartz page slugs (filename-derived, .lean treated like .md).
export function chapterSlugFor(fileName) {
  // mirrors the patched Quartz slugging: .lean chapter slugs are lowercased
  // (module names are CamelCase; crawl-links lowercases link targets)
  return fileName.endsWith(".lean")
    ? fileName.toLowerCase().replace(/\.lean$/, "")
    : fileName.replace(/\.md$/i, "")
}

export function buildSourceModel({ blueprintDir, dataPath, leanSrcDirs }) {
  const metaPath = path.join(blueprintDir, "_meta.json")
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"))
  const kernel = readKernel(dataPath)
  const srcDirs = leanSrcDirs ?? [blueprintDir]

  const chapters = []
  const items = []
  const itemByLabel = new Map()
  const uniqueSlug = makeUniqueSlugger()

  let chNum = 0
  for (const seg of meta.pages) {
    const mdCandidate = path.join(blueprintDir, seg + ".md")
    const leanCandidate = path.join(blueprintDir, seg + ".lean")
    const hasMd = fs.existsSync(mdCandidate)
    const hasLean = fs.existsSync(leanCandidate)
    // a chapter lives in exactly one format at a time; preferring one silently
    // here while navigation prefers the other would render and generate from
    // different sources mid-promotion
    if (hasMd && hasLean) {
      throw new Error(
        `blueprint: chapter "${seg}" is ambiguous — both ${seg}.md and ${seg}.lean exist; ` +
          `delete the markdown file when promoting a chapter to literate Lean`,
      )
    }
    const file = hasLean ? leanCandidate : hasMd ? mdCandidate : null
    const format = hasLean ? "lean" : "md"
    if (!file) continue // folders / non-chapter entries are not ours to validate

    const src = fs.readFileSync(file, "utf8")
    let md
    if (format === "lean") {
      md = weaveLeanToMd(src).md
    } else {
      // md chapter files carry Quartz frontmatter (title) rather than an H1;
      // strip the frontmatter and synthesize the chapter heading for the parser
      const fmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
      const titleMatch = fmMatch?.[1]?.match(/^title\s*:\s*["']?(.+?)["']?\s*$/m)
      const body = fmMatch ? src.slice(fmMatch[0].length) : src
      md = /^ {0,3}#\s/m.test(body.split("\n")[0] ?? "")
        ? body
        : `# ${titleMatch?.[1] ?? seg}\n\n${body}`
    }
    const parsed = parsePlanMdSources([{ name: seg, src: md }])
    chNum++
    const fileName = path.basename(file)
    const chapterSlug = chapterSlugFor(fileName)
    for (const pc of parsed) {
      const chapter = {
        num: chNum,
        title: pc.title,
        slug: chapterSlug,
        fileName,
        format,
        intro: pc.intro || "",
        items: [],
      }
      chapters.push(chapter)
      pc.items.forEach((pi, ii) => {
        if (!pi.label) {
          console.warn(`blueprint: ${pi.kind} without #label skipped in ${fileName}`)
          return
        }
        const item = {
          label: pi.label,
          slug: uniqueSlug(pi.label),
          kind: pi.kind,
          number: `${chNum}.${ii + 1}`,
          chapter,
          displayName: pi.caption || displayNameOf(pi.label),
          leanDeclNames: pi.leanNames,
          stmtUses: pi.uses,
          stmtUsesGiven: pi.usesGiven ?? false,
          proofUses: pi.proof?.uses ?? [],
          proofUsesGiven: pi.proof?.usesGiven ?? false,
          discussion: pi.discussion ?? null,
          codeNone: pi.codeNone ?? false,
        }
        item.title = `${cap(item.kind)} ${item.number} · ${item.displayName}`
        chapter.items.push(item)
        items.push(item)
        itemByLabel.set(pi.label, item)
      })
    }
  }

  const edges = computeStatusesAndEdges(items, itemByLabel, kernel)
  for (const item of items) item.size = cardSize(item)
  return { chapters, items, itemByLabel, edges, kernel, srcDirs }
}
