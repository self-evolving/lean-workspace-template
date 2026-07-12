import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { VFile } from "vfile"

const defaultOptions = {
  bibliographyFile: "./bibliography.bib",
  papersRoot: "papers",
}

const citationCss = `
#refs.references.csl-bib-body {
  counter-reset: reference;
  margin: 2rem 0 0;
  padding: 1rem 1.1rem;
  border: 1px solid var(--lightgray);
  border-radius: 0.95rem;
  background: color-mix(in srgb, var(--lightgray) 22%, transparent);
  color: var(--darkgray);
  font-size: 0.9rem;
  line-height: 1.55;
}

#refs.references.csl-bib-body::before {
  display: block;
  margin-bottom: 0.75rem;
  color: var(--secondary);
  content: "References";
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.065em;
  line-height: 1.2;
  text-transform: uppercase;
}

#refs.references.csl-bib-body .csl-entry {
  counter-increment: reference;
  position: relative;
  margin: 0;
  padding: 0.85rem 0.85rem 0.85rem 2.65rem;
  border-top: 1px solid color-mix(in srgb, var(--lightgray) 78%, transparent);
  border-radius: 0.65rem;
}

#refs.references.csl-bib-body .csl-entry:first-of-type {
  border-top: 0;
}

#refs.references.csl-bib-body .csl-entry::before {
  position: absolute;
  top: 0.85rem;
  left: 0.35rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.45rem;
  height: 1.45rem;
  border: 1px solid color-mix(in srgb, var(--secondary) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--secondary) 10%, var(--light));
  color: var(--secondary);
  content: counter(reference);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
}

#refs.references.csl-bib-body .csl-entry:target {
  background: color-mix(in srgb, var(--secondary) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--secondary) 28%, transparent);
}

#refs.references.csl-bib-body .csl-entry i {
  color: var(--dark);
}

@media all and (max-width: 600px) {
  #refs.references.csl-bib-body {
    padding: 0.85rem;
    font-size: 0.84rem;
  }

  #refs.references.csl-bib-body .csl-entry {
    padding-right: 0.35rem;
    padding-left: 2.3rem;
  }

  #refs.references.csl-bib-body .csl-entry::before {
    left: 0.2rem;
  }

}

.citation-bib-popover-wrap {
  display: inline-block;
  position: relative;
}

.citation-bib-popup {
  position: absolute;
  z-index: 1000;
  bottom: calc(100% + 0.45rem);
  left: 50%;
  width: min(24rem, calc(100vw - 2rem));
  max-width: max-content;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--lightgray);
  border-radius: 0.65rem;
  background: var(--light);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.16);
  color: var(--darkgray);
  font-size: 0.82rem;
  line-height: 1.45;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(0.2rem);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.citation-bib-popup::after {
  position: absolute;
  top: 100%;
  left: 50%;
  width: 0.65rem;
  height: 0.65rem;
  border-right: 1px solid var(--lightgray);
  border-bottom: 1px solid var(--lightgray);
  background: var(--light);
  content: "";
  transform: translate(-50%, -50%) rotate(45deg);
}

.citation-bib-popover-wrap:hover .citation-bib-popup,
.citation-bib-popover-wrap:focus-within .citation-bib-popup {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.citation-bib-popup-label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--secondary);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.055em;
  line-height: 1.2;
  text-transform: uppercase;
}

.citation-bib-popup-entry {
  display: block;
}

.references .csl-entry a {
  color: var(--secondary);
  overflow-wrap: anywhere;
}
`

function decodeCitekey(rawCitekey) {
  try {
    return decodeURIComponent(rawCitekey)
  } catch {
    return rawCitekey
  }
}

function slugifyCitationKey(citekey) {
  return citekey
    .trim()
    .replace(/^@+/, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s/g, "-")
    .replace(/&/g, "-and-")
    .replace(/%/g, "-percent")
    .replace(/\?/g, "")
    .replace(/#/g, "")
    .toLowerCase()
}

function stripSlashes(value) {
  return value.replace(/^\/+/, "").replace(/\/+$/, "")
}

function joinSegments(...segments) {
  const joined = segments
    .filter((segment) => segment && segment !== "/")
    .map((segment) => stripSlashes(String(segment)))
    .filter(Boolean)
    .join("/")

  return joined.length > 0 ? joined : "."
}

function pathToRoot(slug) {
  const parentSegments = String(slug ?? "")
    .split("/")
    .filter(Boolean)
    .slice(0, -1)

  return parentSegments.length === 0 ? "." : parentSegments.map(() => "..").join("/")
}

function addClasses(existing, classesToAdd) {
  const classes = Array.isArray(existing)
    ? [...existing]
    : typeof existing === "string"
      ? existing.split(/\s+/).filter(Boolean)
      : []

  for (const className of classesToAdd) {
    if (!classes.includes(className)) {
      classes.push(className)
    }
  }

  return classes
}

function addOutgoingLink(file, targetSlug) {
  if (file.data.slug === targetSlug) {
    return
  }

  const existingLinks = Array.isArray(file.data.links) ? file.data.links : []
  file.data.links = [...new Set([...existingLinks, targetSlug])]
}

function citationTarget(citekey, papersRoot) {
  const slug = slugifyCitationKey(citekey)
  if (slug.length === 0) {
    return undefined
  }

  return joinSegments(papersRoot, slug)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractBibTexEntry(bibliography, citekey) {
  const entryStart = new RegExp(`@\\w+\\s*[{(]\\s*${escapeRegExp(citekey)}\\s*,`, "i").exec(
    bibliography,
  )
  if (!entryStart) {
    return undefined
  }

  const start = entryStart.index
  const openIndex = bibliography.slice(start).search(/[{(]/)
  if (openIndex < 0) {
    return undefined
  }

  const absoluteOpenIndex = start + openIndex
  const openChar = bibliography[absoluteOpenIndex]
  const closeChar = openChar === "(" ? ")" : "}"
  let depth = 0

  for (let index = absoluteOpenIndex; index < bibliography.length; index++) {
    const char = bibliography[index]
    if (char === openChar) {
      depth++
    } else if (char === closeChar) {
      depth--
      if (depth === 0) {
        return bibliography.slice(start, index + 1).trim()
      }
    }
  }

  return undefined
}

function readBibliography(filePath) {
  const resolved = path.resolve(process.cwd(), filePath)
  try {
    return fs.readFileSync(resolved, "utf-8")
  } catch {
    return undefined
  }
}

function markdownPathForSlug(ctx, slug) {
  return path.resolve(process.cwd(), ctx.argv?.directory ?? "content", `${slug}.md`)
}

function markdownToHast(markdown) {
  const processor = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true })
  const mdast = processor.parse(markdown)
  return processor.runSync(mdast)
}

function contentForSlug(ctx, slug) {
  const filePath = markdownPathForSlug(ctx, slug)
  const markdown = fs.readFileSync(filePath, "utf-8")
  const parsed = matter(markdown)
  const file = new VFile({ path: filePath, value: markdown })
  file.data = {
    ...file.data,
    slug,
    filePath,
    relativePath: `${slug}.md`,
    frontmatter: parsed.data ?? {},
  }

  return [markdownToHast(parsed.content), file]
}

function shouldPublishByActiveFilters(ctx, content) {
  const filters = ctx.cfg?.plugins?.filters ?? []

  for (const filter of filters) {
    try {
      if (filter.shouldPublish(ctx, content) === false) {
        return false
      }
    } catch {
      return false
    }
  }

  return true
}

function hasPublishablePaperNote(ctx, targetSlug, cache) {
  if (!targetSlug || !ctx.allSlugs.includes(targetSlug)) return false

  if (cache.has(targetSlug)) {
    return cache.get(targetSlug)
  }

  let publishable = false
  try {
    publishable = shouldPublishByActiveFilters(ctx, contentForSlug(ctx, targetSlug))
  } catch {
    publishable = false
  }

  cache.set(targetSlug, publishable)
  return publishable
}

function paperCitekey(file, papersRoot) {
  const slug = file.data.slug
  if (typeof slug !== "string") {
    return undefined
  }

  const normalizedPapersRoot = stripSlashes(papersRoot)
  if (!slug.startsWith(`${normalizedPapersRoot}/`)) {
    return undefined
  }

  const filenameCitekey = slug.split("/").at(-1)
  if (filenameCitekey && filenameCitekey !== "index") {
    return filenameCitekey
  }

  const frontmatterCitekey = file.data.frontmatter?.citekey
  if (typeof frontmatterCitekey === "string" && frontmatterCitekey.trim().length > 0) {
    return frontmatterCitekey.trim()
  }

  return undefined
}

function externalReferenceLink(value, href) {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href,
      target: "_blank",
      rel: ["noopener", "noreferrer"],
    },
    children: [{ type: "text", value }],
  }
}

function linkifyReferenceText(value) {
  const children = []
  const urlPattern = /https?:\/\/[^\s<>"']+/g
  let cursor = 0

  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = match[0]
    const trailingPunctuation = rawUrl.match(/[.,;:!?)]*$/)?.[0] ?? ""
    const url = trailingPunctuation ? rawUrl.slice(0, -trailingPunctuation.length) : rawUrl
    const index = match.index ?? 0

    if (!url) continue

    if (index > cursor) {
      children.push({ type: "text", value: value.slice(cursor, index) })
    }

    children.push(externalReferenceLink(url, url))
    if (trailingPunctuation) {
      children.push({ type: "text", value: trailingPunctuation })
    }
    cursor = index + rawUrl.length
  }

  if (cursor < value.length) {
    children.push({ type: "text", value: value.slice(cursor) })
  }

  return children.length > 0 ? children : [{ type: "text", value }]
}

function isReferencesEntry(node) {
  const className = node?.properties?.className
  const classes = Array.isArray(className)
    ? className
    : typeof className === "string"
      ? className.split(/\s+/)
      : []
  return classes.includes("csl-entry")
}

function linkifyReferenceEntry(node) {
  if (!node || typeof node !== "object" || !Array.isArray(node.children)) return

  node.children = node.children.flatMap((child) => {
    if (child?.type === "text") {
      return linkifyReferenceText(child.value ?? "")
    }

    if (child?.type === "element" && child.tagName !== "a" && child.tagName !== "code") {
      linkifyReferenceEntry(child)
    }

    return [child]
  })
}

function linkifyReferenceEntries(tree) {
  const visit = (node) => {
    if (!node || typeof node !== "object") return

    if (node.type === "element" && isReferencesEntry(node)) {
      linkifyReferenceEntry(node)
      return
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child)
    }
  }

  visit(tree)
}

function paperBibTexSection(_citekey, bibtex) {
  return [
    {
      type: "element",
      tagName: "h2",
      properties: { id: "bibtex" },
      children: [{ type: "text", value: "BibTeX" }],
    },
    {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-bibtex"] },
          children: [{ type: "text", value: bibtex }],
        },
      ],
    },
  ]
}

function hasElementId(tree, id) {
  let found = false

  const visit = (node) => {
    if (found || !node || typeof node !== "object") return

    if (node.type === "element" && node.properties?.id === id) {
      found = true
      return
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child)
    }
  }

  visit(tree)
  return found
}

function appendPaperBibTex(tree, file, bibliography, papersRoot) {
  if (hasElementId(tree, "bibtex")) {
    return
  }

  const citekey = paperCitekey(file, papersRoot)
  if (!citekey || !bibliography) {
    return
  }

  const bibtex = extractBibTexEntry(bibliography, citekey)
  if (!bibtex) {
    return
  }

  tree.children.push(...paperBibTexSection(citekey, bibtex))
}

function cloneWithoutIds(node) {
  if (!node || typeof node !== "object") {
    return node
  }

  const cloned = Array.isArray(node) ? [...node] : { ...node }
  if (cloned.properties && typeof cloned.properties === "object") {
    cloned.properties = { ...cloned.properties }
    delete cloned.properties.id
  }

  if (Array.isArray(cloned.children)) {
    cloned.children = cloned.children.map((child) => cloneWithoutIds(child))
  }

  return cloned
}

function citationPopup(citekey, bibliographyEntry) {
  const entry = cloneWithoutIds(bibliographyEntry)
  entry.tagName = "span"
  entry.properties = {
    ...(entry.properties ?? {}),
    className: addClasses(entry.properties?.className, ["citation-bib-popup-entry"]),
  }

  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["citation-bib-popup"],
      role: "tooltip",
      "data-citekey": citekey,
    },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["citation-bib-popup-label"] },
        children: [{ type: "text", value: "Reference" }],
      },
      entry,
    ],
  }
}

function collectBibliographyEntries(tree) {
  const entries = new Map()

  const visit = (node) => {
    if (!node || typeof node !== "object") {
      return
    }

    if (node.type === "element") {
      const id = typeof node.properties?.id === "string" ? node.properties.id : undefined
      const match = id?.match(/^bib-(.+)$/)
      if (match) {
        entries.set(decodeCitekey(match[1]), node)
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child)
      }
    }
  }

  visit(tree)
  return entries
}

export function LiteratureCitations(userOptions = {}) {
  const options = { ...defaultOptions, ...userOptions }
  const papersRoot = stripSlashes(options.papersRoot ?? defaultOptions.papersRoot)
  const bibliography = readBibliography(options.bibliographyFile)

  return {
    name: "LiteratureCitations",
    htmlPlugins(ctx) {
      const publishablePaperSlugs = new Map()

      return [
        () => (tree, file) => {
          linkifyReferenceEntries(tree)
          const bibliographyEntries = collectBibliographyEntries(tree)

          const transform = (node) => {
            if (!node || typeof node !== "object") {
              return node
            }

            if (node.type === "element" && node.tagName === "a") {
              const properties = (node.properties ??= {})
              const href = typeof properties.href === "string" ? properties.href : undefined
              const match = href?.match(/^#bib-(.+)$/)

              if (match) {
                const citekey = decodeCitekey(match[1])
                const targetSlug = citationTarget(citekey, papersRoot)
                const hasPaperNote = hasPublishablePaperNote(ctx, targetSlug, publishablePaperSlugs)

                if (hasPaperNote) {
                  properties.href = joinSegments(pathToRoot(file.data.slug), targetSlug)
                  properties.className = addClasses(properties.className, [
                    "internal",
                    "internal-link",
                    "citation-paper-link",
                  ])
                  properties["data-slug"] = targetSlug
                  properties["data-citekey"] = citekey
                  properties["data-bib-href"] = href
                  properties.title = `Open paper note for ${citekey}`
                  delete properties["data-no-popover"]
                  delete properties.dataNoPopover

                  addOutgoingLink(file, targetSlug)
                  return node
                }

                const bibliographyEntry = bibliographyEntries.get(citekey)
                if (bibliographyEntry) {
                  properties.className = addClasses(properties.className, ["citation-bib-link"])
                  properties["data-citekey"] = citekey
                  properties.title = `Show bibliography entry for ${citekey}`

                  return {
                    type: "element",
                    tagName: "span",
                    properties: { className: ["citation-bib-popover-wrap"] },
                    children: [node, citationPopup(citekey, bibliographyEntry)],
                  }
                }
              }
            }

            if (Array.isArray(node.children)) {
              node.children = node.children.map((child) => transform(child))
            }

            return node
          }

          transform(tree)
          appendPaperBibTex(tree, file, bibliography, papersRoot)
        },
      ]
    },
    externalResources() {
      return {
        css: [
          {
            content: citationCss,
            inline: true,
          },
        ],
      }
    },
  }
}

export default LiteratureCitations
