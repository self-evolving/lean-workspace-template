// TeX-plan toolkit: parsing helpers for leanblueprint-convention LaTeX sources
// (\chapter/\section structure, theorem-like environments carrying \label,
// \lean, \uses, \leanok). Shared by scripts/import-blueprint.mjs (snapshot
// imports) and scripts/migrate-blueprint.mjs (native-chapter migration).
// Dependency-free besides node:fs/node:path.

import fs from "node:fs"
import path from "node:path"

export const PLAN_ENV_KINDS = ["definition", "lemma", "proposition", "theorem", "corollary"]

export const collapse = (s) => s.replace(/\s+/g, " ").trim()

// Strip % comments, respecting \% escapes. Line-based: leanblueprint sources
// do not rely on verbatim-% edge cases.
export function stripTexComments(src) {
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

// Read a balanced {...} group starting at src[openIdx] === "{".
// Returns { inner, end } (end = index just past the closing brace) or null.
export function readBalanced(src, openIdx) {
  if (src[openIdx] !== "{") return null
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{" && src[i - 1] !== "\\") depth++
    else if (src[i] === "}" && src[i - 1] !== "\\") {
      depth--
      if (depth === 0) return { inner: src.slice(openIdx + 1, i), end: i + 1 }
    }
  }
  return null
}

// Recursively inline \input{...} (leanblueprint's recommended multi-file
// layout is a content.tex that is a pure sequence of \input). Only resolves
// line-leading \input directives; missing files warn and drop out.
export function resolveInputs(file, depth = 0) {
  if (depth > 8) throw new Error(`\\input nesting too deep at ${file}`)
  const dir = path.dirname(file)
  const src = fs.readFileSync(file, "utf8")
  return src.replace(/^([^\S\n]*)\\input\{([^}]+)\}/gm, (_, _ws, target) => {
    const f = target.endsWith(".tex") ? target : `${target}.tex`
    const resolved = path.resolve(dir, f)
    if (!fs.existsSync(resolved)) {
      console.warn(`tex-plan: \\input{${target}} not found (from ${file}) — skipped`)
      return ""
    }
    return resolveInputs(resolved, depth + 1)
  })
}

// Parse \newcommand{\X}[n][default]{body} / \renewcommand / \providecommand
// and \DeclareMathOperator{\X}{body} definitions out of macro sources.
export function parseMacroSources(sources) {
  const table = new Map() // name (no backslash) -> { nargs, optDefault, body }
  for (const raw of sources) {
    const src = stripTexComments(raw)
    const re =
      /\\(?:re)?(?:new|provide)command\*?\s*\{?\\([A-Za-z@]+)\}?\s*(?:\[(\d)\])?\s*(?:\[([^\]]*)\])?\s*\{/g
    let m
    while ((m = re.exec(src))) {
      const body = readBalanced(src, re.lastIndex - 1)
      if (!body) continue
      table.set(m[1], { nargs: Number(m[2] || 0), optDefault: m[3] ?? null, body: body.inner })
      re.lastIndex = body.end
    }
    const opRe = /\\DeclareMathOperator\*?\s*\{\\([A-Za-z@]+)\}\s*\{/g
    while ((m = opRe.exec(src))) {
      const body = readBalanced(src, opRe.lastIndex - 1)
      if (!body) continue
      table.set(m[1], { nargs: 0, optDefault: null, body: `\\operatorname{${body.inner}}` })
      opRe.lastIndex = body.end
    }
  }
  return table
}

export function parseMacroFiles(files) {
  const sources = []
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.warn(`tex-plan: macros file ${f} not found — skipped`)
      continue
    }
    sources.push(fs.readFileSync(f, "utf8"))
  }
  return parseMacroSources(sources)
}

// Textual macro expansion, word-boundary aware, iterated for nested macros.
// Only expands names present in the table — standard LaTeX stays untouched.
export function expandMacros(src, table) {
  if (!table || !table.size) return src
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    let out = ""
    let i = 0
    while (i < src.length) {
      if (src[i] !== "\\") {
        out += src[i++]
        continue
      }
      const m = /^\\([A-Za-z@]+)/.exec(src.slice(i))
      const def = m && table.get(m[1])
      if (!def) {
        out += src[i]
        i++
        continue
      }
      let j = i + m[0].length
      const args = []
      if (def.optDefault !== null) {
        const close = src[j] === "[" ? src.indexOf("]", j) : -1
        if (close !== -1) {
          args.push(src.slice(j + 1, close))
          j = close + 1
        } else args.push(def.optDefault) // no [arg] (or unterminated): use the default
      }
      while (args.length < def.nargs) {
        while (/\s/.test(src[j])) j++
        if (src[j] === "{") {
          const g = readBalanced(src, j)
          if (!g) break
          args.push(g.inner)
          j = g.end
        } else if (src[j] === "\\") {
          // unbraced control-sequence argument (\norm\mu): the whole \mu is the arg
          const cs = /^\\[A-Za-z@]+|^\\./.exec(src.slice(j))
          if (!cs) break
          args.push(cs[0])
          j += cs[0].length
        } else {
          args.push(src[j])
          j++
        }
      }
      if (args.length < def.nargs) {
        out += src.slice(i, j)
        i = j
        continue
      }
      out += def.body.replace(/#(\d)/g, (_, d) => args[Number(d) - 1] ?? "")
      i = j
      changed = true
    }
    src = out
    if (!changed) break
  }
  return src
}

// Pull the leanblueprint directives out of an environment body; the remainder
// is the statement/proof TeX. Marker macros (\leanok, \mathlibok, \notready)
// are recorded/stripped so they never leak into rendered prose.
export function parseEnvDirectives(body) {
  const out = { label: null, leanNames: [], leanok: false, mathlibok: false, uses: [] }
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
  body = body.replace(/\\leanok\b/g, () => ((out.leanok = true), ""))
  body = body.replace(/\\mathlibok\b/g, () => ((out.mathlibok = true), ""))
  body = body.replace(/\\notready\b/g, "")
  out.tex = body.replace(/\n{3,}/g, "\n\n").trim()
  return out
}

// Parse a (comment-stripped, macro-expanded, \input-resolved) plan source into
// chapters. Chapters carry both `items` (the theorem-like environments) and
// `blocks` (items interleaved with the prose between them, in order) so
// callers can reproduce the narrative or ignore it. `\part{}` headings are
// collected separately. Heading titles may nest one brace level
// (\section{Proof of Theorem \ref{thm:G}}).
//
// opts.chapterCmd — "chapter" (default) or "section", for blueprints built
// with plastex split-level=1 where \section is the chapter unit.
// opts.kinds — environment names treated as items (default PLAN_ENV_KINDS).
export function parsePlanTex(src, opts = {}) {
  const chapterCmd = opts.chapterCmd ?? "chapter"
  const kinds = opts.kinds ?? PLAN_ENV_KINDS
  const chapters = []
  const parts = []
  let current = null
  // heading titles may nest braces two levels deep (\chapter{A \frac{\sqrt{n}}{2}});
  // deeper nesting is vanishingly rare in section titles and would fall through,
  // attaching the chapter's items to the previous chapter
  const T1 = "(?:[^{}]|\\{[^{}]*\\})*"
  const T = `(?:[^{}]|\\{${T1}\\})*`
  const re = new RegExp(
    `\\\\part\\{(${T})\\}|\\\\${chapterCmd}\\*?\\{(${T})\\}|\\\\begin\\{(${kinds.join("|")})\\}(?:\\[([^\\]]*)\\])?([\\s\\S]*?)\\\\end\\{\\3\\}`,
    "g",
  )
  let m
  let lastEnd = 0
  const pushGap = (endIdx) => {
    const gap = src.slice(lastEnd, endIdx)
    if (!current || !gap.trim()) return
    current.blocks.push({ type: "prose", tex: gap })
  }
  while ((m = re.exec(src))) {
    pushGap(m.index)
    if (m[1] !== undefined) {
      parts.push({ title: collapse(m[1]), atChapter: chapters.length })
    } else if (m[2] !== undefined) {
      current = { title: collapse(m[2]), blocks: [], items: [] }
      chapters.push(current)
    } else {
      if (!current) {
        current = { title: "Blueprint", blocks: [], items: [] }
        chapters.push(current)
      }
      const item = {
        kind: m[3],
        caption: m[4] ? collapse(m[4]) : null,
        ...parseEnvDirectives(m[5]),
      }
      // an immediately-following proof environment belongs to this item
      const rest = src.slice(re.lastIndex)
      const pm = rest.match(/^\s*\\begin\{proof\}([\s\S]*?)\\end\{proof\}/)
      if (pm) {
        item.proof = parseEnvDirectives(pm[1])
        re.lastIndex += pm[0].length
      }
      current.blocks.push({ type: "item", item })
      current.items.push(item)
    }
    lastEnd = re.lastIndex
  }
  pushGap(src.length)
  return { chapters, parts }
}

// YAML scalar for frontmatter: single-quoted, so backslashes (LaTeX math in
// titles) survive — double-quoted YAML treats \m etc. as escape sequences.
export const yamlScalar = (s) => `'${String(s).replace(/'/g, "''")}'`
