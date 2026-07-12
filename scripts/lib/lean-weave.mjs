// Literate .lean chapter weave: split top-level /-! ... -/ doc blocks from the
// code between them and emit markdown. Dependency-light on purpose — imported by
// the Quartz core parser (quartz/processors/parse.ts) as well as the model lib.

// ---------------------------------------------------------------- lean chapter weave
// Split a literate .lean chapter into top-level /-! ... -/ doc blocks and the code
// between them. Doc-block text passes through as markdown; code segments become
// ```lean fences. The segment before the first doc block (imports/preamble) is
// skipped. `lean=next` on an item heading binds to the first declaration in the
// following code segment (namespace-tracked). Constraint: doc blocks must not
// contain a literal `-/`.
const DECL_RE =
  /^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|unsafe|partial|scoped)\s+)*(?:def|theorem|lemma|abbrev|inductive|structure|class|instance|opaque)\s+([A-Za-z_«][^\s({\[:]*)/m

export function weaveLeanToMd(src) {
  // sequential split on /-! ... -/
  const segments = [] // alternating { type: "code" | "doc", text }
  let pos = 0
  while (pos < src.length) {
    const open = src.indexOf("/-!", pos)
    if (open === -1) {
      segments.push({ type: "code", text: src.slice(pos) })
      break
    }
    segments.push({ type: "code", text: src.slice(pos, open) })
    const close = src.indexOf("-/", open + 3)
    if (close === -1) {
      console.warn("weave: unterminated /-! doc block")
      segments.push({ type: "doc", text: src.slice(open + 3) })
      break
    }
    segments.push({ type: "doc", text: src.slice(open + 3, close) })
    pos = close + 2
  }

  // namespace tracking across code segments (for lean=next qualification)
  const nsStack = []
  const trackNamespaces = (code) => {
    for (const line of code.split("\n")) {
      const ns = line.match(/^\s*namespace\s+([A-Za-z_«][\w«»'.]*)/)
      if (ns) {
        nsStack.push(ns[1])
        continue
      }
      const end = line.match(/^\s*end(?:\s+([A-Za-z_«][\w«»'.]*))?\s*$/)
      if (end && nsStack.length && (!end[1] || nsStack[nsStack.length - 1] === end[1])) {
        nsStack.pop()
      }
    }
  }
  const firstDeclIn = (code) => {
    const m = code.match(DECL_RE)
    if (!m) return null
    const name = m[1]
    return nsStack.length && !name.includes(".") ? `${nsStack.join(".")}.${name}` : name
  }
  const firstDeclInWithContext = (code) => {
    const match = code.match(DECL_RE)
    if (!match) return null
    const saved = [...nsStack]
    trackNamespaces(code.slice(0, match.index ?? 0))
    const decl = firstDeclIn(code)
    nsStack.length = 0
    nsStack.push(...saved)
    return decl
  }

  const out = []
  let title = null
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.type === "code") {
      const isPreamble = i === 0
      const sourceDecl = firstDeclInWithContext(seg.text)
      trackNamespaces(seg.text)
      const code = seg.text.replace(/^\n+|\n+$/g, "")
      if (!isPreamble && code.trim()) {
        const meta = sourceDecl ? ` sourceDecl="${sourceDecl}"` : ""
        out.push("```lean" + meta + "\n" + code + "\n```")
      }
      continue
    }
    // doc block: trim the stray indent left by stripping the `/-!` opener, then
    // resolve lean=next against the upcoming code segment
    let text = seg.text.replace(/^[ \t]+/, "").replace(/^\n+|\n+$/g, "")
    if (/\blean=next\b/.test(text)) {
      const nextCode = segments[i + 1]?.type === "code" ? segments[i + 1].text : ""
      // qualification must account for namespaces opened up to (and inside) the next segment;
      // track on a temporary copy so we don't double-apply
      const saved = [...nsStack]
      trackNamespaces(nextCode.slice(0, nextCode.match(DECL_RE)?.index ?? nextCode.length))
      const decl = firstDeclIn(nextCode)
      nsStack.length = 0
      nsStack.push(...saved)
      if (decl) text = text.replace(/\blean=next\b/g, `lean="${decl}"`)
      else console.warn("weave: lean=next with no following declaration")
    }
    if (!title) {
      const t = text.match(/^#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m)
      if (t) title = t[1].trim()
    }
    out.push(text)
  }

  const md = out.join("\n\n") + "\n"
  return { md, title: title ?? "Untitled chapter" }
}

// Synthetic frontmatter for woven chapters (parse pipeline + docsNav both need titles).
export function weaveWithFrontmatter(src) {
  const { md, title } = weaveLeanToMd(src)
  // the H1 becomes the frontmatter title; drop it from the body to avoid
  // rendering the title twice
  const body = md.replace(/^ {0,3}#\s+[^\n]*\n?/m, "")
  const fm = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ntype: "blueprint-chapter"\ntags:\n  - "blueprint"\n---\n\n`
  return fm + body
}

// Title for a raw .lean chapter (used by docsNav without weaving the whole file).
// Tolerates leading whitespace: the first doc-block line is typically
// "/-! # Title", so the block content starts with a space.
export function leanChapterTitle(src) {
  const open = src.indexOf("/-!")
  if (open === -1) return null
  const close = src.indexOf("-/", open + 3)
  const block = src.slice(open + 3, close === -1 ? undefined : close)
  const t = block.match(/^\s*#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m)
  return t ? t[1].trim() : null
}

// Page-source path normalization shared by the whole build pipeline (initial
// parse, incremental rebuilds, navigation): literate .lean chapters slug exactly
// like markdown pages, lowercased — crawl-links lowercases link targets and
// module filenames are CamelCase.
export function leanAwareSlugPath(fp) {
  return fp.endsWith(".lean") ? fp.toLowerCase().replace(/\.lean$/, ".md") : fp
}
