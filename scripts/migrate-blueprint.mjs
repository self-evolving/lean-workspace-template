#!/usr/bin/env node
// Native-chapter migration: converts a leanblueprint LaTeX plan into NATIVE
// Lean Workspace chapters — markdown items carrying lean=/uses= that fully
// participate in the kernel-truth pipeline (statuses, edges, and snippets are
// recomputed on every `npm run blueprint:sync`). This is the durable
// counterpart to scripts/import-blueprint.mjs, whose output is a pre-rendered
// snapshot.
//
// Usage:
//   node scripts/migrate-blueprint.mjs --plan=path/to/content.tex \
//        --label="My Project blueprint" [--macros=common.tex,web.tex] \
//        [--chapter-level=chapter|section] [--part-folders] [--out=blueprint] [--dry-run]
//
// \input chains resolve recursively; --macros expands the project's custom
// \newcommand/\DeclareMathOperator shorthands; --chapter-level=section serves
// blueprints built with plastex split-level=1. The migration deliberately does
// NOT touch lakefile.toml, lean-toolchain, blueprint.config.json, or the
// folder's index.md — it prints the follow-up checklist instead (the docs walk
// it: docs/tutorial/quick-start/work-on-external-project.md).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadBlueprintConfig } from "./lib/blueprint-model.mjs"
import {
  PLAN_ENV_KINDS,
  collapse,
  expandMacros,
  parseEnvDirectives,
  parseMacroFiles,
  parsePlanTex,
  resolveInputs,
  stripTexComments,
  yamlScalar,
} from "./lib/tex-plan.mjs"

// Upstream environments without a native item kind are kept as items under the
// closest kind, with a provenance line in the body.
const MAPPED_KINDS = { remark: "definition", example: "definition" }

// ---------------------------------------------------------------- tex -> markdown
const DISPLAY_ENVS = ["equation", "align", "alignat", "gather", "multline", "eqnarray"]

// A display-math body ready for remark-math: blank lines inside a $$ block
// end the paragraph and break the math span, so collapse them away.
const displayBody = (b) => b.replace(/\n[ \t]*\n+/g, "\n").trim()

function texToMd(tex, ctx) {
  if (!tex) return ""
  let s = tex
  // verbatim blocks first — their contents must not reach the math/format
  // passes below
  s = s.replace(/\\begin\{verbatim\}\n?([\s\S]*?)\\end\{verbatim\}/g, (_, b) => {
    const lines = b.split("\n").map((l) => l.trim())
    return "\n```\n" + lines.filter(Boolean).join("\n") + "\n```\n"
  })
  // display math already written as $$..$$: normalize the delimiters onto
  // their own lines — remark-math rejects a closing $$ preceded by content on
  // the same line, and the unclosed block then swallows the rest of the page
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, b) => `\n$$\n${displayBody(b)}\n$$\n`)
  // display math: \[..\] and top-level AMS environments -> $$..$$ (normalized
  // to KaTeX-safe forms — KaTeX numbers nothing here anyway)
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, b) => `\n$$\n${displayBody(b)}\n$$\n`)
  // inline math: \(..\) -> $..$
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, b) => `$${collapse(b)}$`)
  for (const env of DISPLAY_ENVS) {
    const re = new RegExp(`\\\\begin\\{${env}(\\*?)\\}([\\s\\S]*?)\\\\end\\{${env}\\1\\}`, "g")
    s = s.replace(re, (_, star, body) => {
      // Map onto the environments KaTeX supports inside display math:
      // aligned for the &-aligned family, gathered for the centered family,
      // and no environment at all for equation. Architect statements (Lean
      // doc-comments) use these environments freely.
      let inner = body
      if (env === "alignat") inner = inner.replace(/^\s*\{\d+\}/, "")
      inner = displayBody(inner)
      const wrapped =
        env === "equation"
          ? inner
          : env === "gather" || env === "multline"
            ? `\\begin{gathered}\n${inner}\n\\end{gathered}`
            : `\\begin{aligned}\n${inner}\n\\end{aligned}`
      return `\n$$\n${wrapped}\n$$\n`
    })
  }
  // lists
  s = s.replace(/\\begin\{(itemize|enumerate)\}([\s\S]*?)\\end\{\1\}/g, (_, envName, body) => {
    const marker = envName === "enumerate" ? "1." : "-"
    const entries = body
      .split(/\\item\b/)
      .map((x) => x.trim())
      .filter(Boolean)
    return "\n" + entries.map((x) => `${marker} ${collapse(x)}`).join("\n") + "\n"
  })
  // refs -> links to item labels where possible (native cross-ref syntax is
  // [text](#label)); unknown labels degrade to plain text
  const refText = (l) => {
    const t = ctx.itemByLabel.get(l.trim())
    return t ? `[${t.displayName}](#${l.trim()})` : null
  }
  s = s.replace(/\\[Cc]ref\{([^}]*)\}/g, (_, l) => refText(l) ?? collapse(l))
  s = s.replace(
    /(Definition|Lemma|Theorem|Proposition|Corollary|Remark)~?\\ref\{([^}]*)\}/g,
    (_, kind, l) => refText(l) ?? `${kind} ${collapse(l)}`,
  )
  s = s.replace(/\\(?:eq)?ref\{([^}]*)\}/g, (_, l) => refText(l) ?? `(${collapse(l)})`)
  // inline formatting
  s = s
    .replace(/\\texttt\{([^}]*)\}/g, "`$1`")
    .replace(/\\verb\|([^|]*)\|/g, "`$1`")
    .replace(/\\emph\{([^}]*)\}/g, "_$1_")
    .replace(/\\textit\{([^}]*)\}/g, "_$1_")
    .replace(/\\textbf\{([^}]*)\}/g, "**$1**")
    .replace(/\\footnote\{([^}]*)\}/g, " ($1)")
    .replace(/\\cite(?:\[([^\]]*)\])?\{([^}]*)\}/g, (_, note, keys) => {
      // pandoc citation syntax for the citations plugin; the same key
      // sanitization must be applied to bibliography.bib
      const ks = keys
        .split(",")
        .map((k) => sanitizeCiteKey(k))
        .filter(Boolean)
      if (!ks.length) return ""
      return `[${ks.map((k) => `@${k}`).join("; ")}${note ? `, ${note}` : ""}]`
    })
  // leftover structure/marker commands
  s = s
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(
      /\\(?:mathlibok|notready|leanok|noindent|centering|medskip|smallskip|bigskip|newpage|clearpage|pagebreak|nopagebreak|linebreak|allowbreak|vfill|hfill)\b(?:\[[^\]]*\])?/g,
      "",
    )
    .replace(/\\[vh]space\*?\{[^}]*\}/g, "")
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/g, "_(figure: $1)_")
  // ~ is a non-breaking space (KaTeX renders it as a space inside math too)
  s = s.replace(/(?<!\\)~/g, " ")
  // \url after the ~ pass: URL tildes are written $\sim$ in LaTeX and must
  // come out as literal ~ in the autolink, not as spaces
  s = s.replace(/\\url\{([^}]*)\}/g, (_, u) => {
    const clean = u
      .replace(/\\_/g, "_")
      .replace(/\$\\sim\$/g, "~")
      .replace(/\\([%#&])/g, "$1")
    return `<${clean}>`
  })
  return s.replace(/\n{3,}/g, "\n\n").trim()
}

// Sub-chapter headers inside gap prose become bold paragraphs (## is reserved
// for items in native chapters); orphan proof environments — ones that did not
// immediately follow an item — are kept as quoted prose.
function proseToMd(tex, ctx, chapterCmd, stats) {
  let s = tex
  if (chapterCmd === "chapter")
    s = s.replace(/\\section\*?\{([^}]*)\}/g, (_, t) => `\n**${collapse(t)}**\n`)
  s = s.replace(/\\(?:sub)+section\*?\{([^}]*)\}/g, (_, t) => `\n**${collapse(t)}**\n`)
  // Orphan proofs are converted eagerly and stashed behind placeholders: their
  // display math must be quote-prefixed line by line, and running the outer
  // texToMd over the finished blockquote would re-normalize $$ delimiters and
  // strip the "> " prefixes, letting the math escape the quote.
  const stashed = []
  s = s.replace(/\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g, (_, body) => {
    stats.orphanProofs++
    const md = texToMd(parseEnvDirectives(body).tex, ctx)
    const quoted = md
      .split("\n")
      .map((l) => (l.trim() ? `> ${l}` : ">"))
      .join("\n")
    stashed.push(`> **Proof.**\n${quoted}`)
    return `\n@@ORPHAN_PROOF_${stashed.length - 1}@@\n`
  })
  s = texToMd(s, ctx)
  return s.replace(/@@ORPHAN_PROOF_(\d+)@@/g, (_, i) => stashed[Number(i)])
}

// ---------------------------------------------------------------- emit
const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\$[^$]*\$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "chapter"

const KIND_PREFIX_RE =
  /^(def|defn|definition|lem|lemma|thm|theorem|prop|proposition|cor|corollary|rem|remark|eg|ex|example)[:.]/i
const displayNameOf = (label) => label.replace(KIND_PREFIX_RE, "").trim() || label

// BibTeX keys with spaces or non-ascii letters break pandoc-style citation
// parsing; the identical mapping must be applied to the keys in
// bibliography.bib (e.g. "first course" -> first-course, Beiglböck -> Beiglbock).
const sanitizeCiteKey = (k) =>
  k
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_.:+-]/g, "-")

// Convert a parsed plan (see tex-plan.mjs parsePlanTex) into native chapter
// files plus the folder _meta.json. Pure: no fs, no flags — the CLI below and
// the tests both call this.
export function buildNativeChapters(tex, opts = {}) {
  const chapterCmd = opts.chapterCmd ?? "chapter"
  const label = opts.label ?? "Blueprint"
  const macros = opts.macros ?? new Map()

  const stats = { items: 0, withLean: 0, mathlibok: 0, droppedUses: 0, orphanProofs: 0 }
  const warnings = []

  // \begin{thebibliography} ends the blueprint body: the citations plugin
  // renders references from bibliography.bib, and what follows the env in
  // these documents is postamble (addresses etc.). \putbib / \bibliography{}
  // commands are likewise the plugin's job now.
  let texBody = tex
  const bibAt = texBody.search(/\\begin\{thebibliography\}/)
  if (bibAt !== -1) {
    warnings.push("dropping \\begin{thebibliography} block and everything after it")
    texBody = texBody.slice(0, bibAt)
  }
  texBody = texBody.replace(/\\putbib\b|\\bibliography\{[^}]*\}|\\bibliographystyle\{[^}]*\}/g, "")

  const src = expandMacros(stripTexComments(texBody), macros)
  const { chapters, parts } = parsePlanTex(src, {
    chapterCmd,
    kinds: [...PLAN_ENV_KINDS, ...Object.keys(MAPPED_KINDS)],
  })

  const itemByLabel = new Map()
  const allItems = chapters.flatMap((c) => c.items)
  for (const it of allItems) {
    if (!it.label) continue
    it.displayName = it.caption || displayNameOf(it.label)
    if (itemByLabel.has(it.label)) warnings.push(`duplicate label ${it.label}`)
    itemByLabel.set(it.label, it)
  }
  const ctx = { itemByLabel }

  // uses= hygiene: a reference to a label that is not an item would fail the
  // build's cross-reference validation — drop it and say so
  const filterUses = (uses, where) =>
    uses.filter((l) => {
      if (itemByLabel.has(l)) return true
      stats.droppedUses++
      warnings.push(`${where}: uses=${l} is not an item label — dropped`)
      return false
    })

  // chapter titles may be brace-wrapped (\chapter{{Filtrations, ...}} renders
  // as "{Filtrations, ...}") and may carry \ref{} ("Proof of Theorem
  // \ref{thm:G}") — unwrap, and resolve refs to the target's display name as
  // plain text
  const stripWrap = (t) => {
    t = t.trim()
    while (t.startsWith("{") && t.endsWith("}")) {
      let depth = 0
      let fullWrap = true
      for (let i = 0; i < t.length; i++) {
        if (t[i] === "{") depth++
        else if (t[i] === "}") {
          depth--
          if (depth === 0 && i < t.length - 1) {
            fullWrap = false
            break
          }
        }
      }
      if (!fullWrap) break
      t = t.slice(1, -1).trim()
    }
    return t
  }
  const cleanTitle = (t) =>
    collapse(
      stripWrap(t).replace(/\\[Cc]?(?:eq)?ref\{([^}]*)\}/g, (_, l) => {
        const target = itemByLabel.get(l.trim())
        return target ? target.displayName : displayNameOf(l.trim())
      }),
    )

  // --part-folders: group chapters into per-\part subfolders (two-level nav).
  // Part i covers chapters [atChapter_i, atChapter_{i+1}); chapters before the
  // first \part stay at the root. Chapter numbering stays global.
  const usePartFolders = Boolean(opts.partFolders) && parts.length > 0
  if (opts.partFolders && !parts.length)
    warnings.push("--part-folders given but the plan has no \\part{} headings — ignored")
  const partDirs = usePartFolders
    ? parts.map((p, i) => `${i + 1}-${slugify(cleanTitle(p.title))}`)
    : []
  const dirForChapter = (idx) => {
    if (!usePartFolders) return ""
    let pi = -1
    for (let i = 0; i < parts.length; i++) if (parts[i].atChapter <= idx) pi = i
    return pi === -1 ? "" : partDirs[pi]
  }

  const files = []
  const chapterSlugs = [] // relative to the blueprint root (folder-qualified)
  const width = String(chapters.length).length
  chapters.forEach((ch, idx) => {
    const title = cleanTitle(ch.title)
    const dir = dirForChapter(idx)
    const slug = `${String(idx + 1).padStart(width, "0")}-${slugify(title)}`
    chapterSlugs.push(dir ? `${dir}/${slug}` : slug)
    const lines = [
      "---",
      `title: ${yamlScalar(title)}`,
      `type: "blueprint-chapter"`,
      "tags:",
      `  - "blueprint"`,
      "---",
      "",
    ]
    for (const b of ch.blocks) {
      if (b.type === "prose") {
        const md = proseToMd(b.tex, ctx, chapterCmd, stats)
        if (md) lines.push(md, "")
        continue
      }
      const it = b.item
      if (!it.label) {
        // unlabeled environment: nothing can reference it — keep as quoted prose
        const md = texToMd(it.tex, ctx)
        if (md) lines.push(`> **${it.kind}.** ${md}`, "")
        continue
      }
      stats.items++
      if (it.leanNames.length) stats.withLean++
      if (it.mathlibok) stats.mathlibok++
      const kind = MAPPED_KINDS[it.kind] ?? it.kind
      const attrs = [`#${it.label}`]
      if (it.leanNames.length) attrs.push(`lean="${it.leanNames.join(", ")}"`)
      const uses = filterUses(it.uses, it.label)
      if (uses.length) attrs.push(`uses="${uses.join(", ")}"`)
      if (it.discussion != null) attrs.push(`discussion="${it.discussion}"`)
      lines.push(
        `## ${kind[0].toUpperCase() + kind.slice(1)}: ${it.displayName} {${attrs.join(" ")}}`,
        "",
      )
      if (kind !== it.kind) lines.push(`_Stated as a ${it.kind} in the original blueprint._`, "")
      // \mathlibok is counted (stats) but not rendered per item — at
      // real-blueprint scale (142 of brownian-motion's 620 items) the note is
      // noise, and origin-aware extraction gives those items true statuses.
      const stmt = texToMd(it.tex, ctx)
      if (stmt) lines.push(stmt, "")
      if (it.proof) {
        const pUses = filterUses(it.proof.uses, `${it.label} proof`)
        const pBody = texToMd(it.proof.tex, ctx)
        if (pBody || pUses.length) {
          lines.push(`### Proof${pUses.length ? ` {uses="${pUses.join(", ")}"}` : ""}`, "")
          if (pBody) lines.push(pBody, "")
        }
      }
    }
    files.push({
      name: `${slug}.md`,
      dir,
      content: lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n",
    })
  })

  // No dep-graph entry yet: the canvas file does not exist until the first
  // `lake build && npm run blueprint:sync`, and nav validation fails on a
  // dangling entry. The CLI checklist says to add it after that first sync.
  // With part folders, the root nav lists the folders (plus any pre-part
  // root chapters); each folder's _meta.json labels the part.
  // chapterless parts (e.g. a \part heading whose chapters are all commented
  // out) get no folder: an empty folder _meta.json fails nav validation and
  // leaves a dangling root entry
  const partMetas = partDirs
    .map((dir, i) => ({
      dir,
      meta: {
        label: cleanTitle(parts[i].title),
        pages: files.filter((f) => f.dir === dir).map((f) => f.name.replace(/\.md$/, "")),
      },
    }))
    .filter((pm, i) => {
      if (pm.meta.pages.length) return true
      warnings.push(`part "${parts[i].title}" has no chapters — folder skipped`)
      return false
    })
  const livePartDirs = partMetas.map((pm) => pm.dir)
  const rootPages = usePartFolders
    ? [...chapterSlugs.filter((s) => !s.includes("/")), ...livePartDirs]
    : chapterSlugs
  const meta = { label, pages: rootPages }
  return { files, meta, partMetas, parts, stats, warnings }
}

// ---------------------------------------------------------------- cli
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const p = argv.find((a) => a.startsWith(`--${name}=`))
  return p ? p.slice(name.length + 3) : fallback
}

function main() {
  const PLAN = argOf("plan", "")
  const LABEL = argOf("label", "")
  if (!PLAN || !LABEL) {
    console.error(
      'migrate-blueprint: --plan=<content.tex> and --label="Project blueprint" are required',
    )
    process.exit(1)
  }
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  // Resolve the destination through the real config loader so per-blueprint
  // contentRoot/root overrides land the chapters where blueprint:sync and the
  // site build will actually read them. --out overrides only the folder name.
  const cfg = loadBlueprintConfig(ROOT)
  const outName = argOf("out", "")
  const outDir = outName ? path.resolve(cfg.contentDir, outName) : cfg.blueprintDir
  const macroFiles = argOf("macros", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((f) => path.resolve(ROOT, f))

  const tex = resolveInputs(path.resolve(ROOT, PLAN))
  const { files, meta, partMetas, parts, stats, warnings } = buildNativeChapters(tex, {
    chapterCmd: argOf("chapter-level", "chapter"),
    label: LABEL,
    macros: parseMacroFiles(macroFiles),
    partFolders: argv.includes("--part-folders"),
  })

  for (const w of warnings) console.warn(`migrate: ${w}`)
  console.log(
    `migrate: ${files.length} chapters, ${stats.items} items (${stats.withLean} with lean=, ` +
      `${stats.mathlibok} mathlibok), ${stats.droppedUses} non-item uses refs dropped, ` +
      `${stats.orphanProofs} orphan proofs kept as prose`,
  )
  if (parts.length) console.log(`migrate: parts: ${parts.map((p) => p.title).join(" | ")}`)

  if (argv.includes("--dry-run")) {
    console.log(files.map((f) => (f.dir ? `${f.dir}/${f.name}` : f.name)).join("\n"))
    return
  }
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of files) {
    const dirAbs = f.dir ? path.join(outDir, f.dir) : outDir
    fs.mkdirSync(dirAbs, { recursive: true })
    fs.writeFileSync(path.join(dirAbs, f.name), f.content)
  }
  for (const pm of partMetas)
    fs.writeFileSync(
      path.join(outDir, pm.dir, "_meta.json"),
      JSON.stringify(pm.meta, null, 2) + "\n",
    )
  fs.writeFileSync(path.join(outDir, "_meta.json"), JSON.stringify(meta, null, 2) + "\n")
  console.log(
    `migrate: wrote ${files.length} chapter files + ${
      partMetas.length ? `${partMetas.length} part folders + ` : ""
    }_meta.json to ${outDir}`,
  )
  console.log(
    [
      "",
      "Not done for you (see docs/tutorial/quick-start/work-on-external-project.md):",
      "  - adopt the Lean code ([[require]] or copy-in, lean-toolchain, lake update)",
      "  - point blueprint.config.json lakeRoots/leanSrcDirs/repo at it",
      "  - remove the demo chapters + stale lakefile roots if this replaced the demo",
      `  - rewrite ${path.join(path.relative(ROOT, outDir), "index.md")} (landing page + attribution)`,
      "  - after the first `lake build && npm run blueprint:sync` creates the canvas,",
      '    add { "page": "dep-graph", "type": "canvas", "title": "Dependency canvas" }',
      "    back to the top of _meta.json pages",
      "  - items realized outside your lakeRoots (e.g. \\mathlibok, upstreamed to",
      "    mathlib) render without kernel statuses for now",
    ].join("\n"),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
