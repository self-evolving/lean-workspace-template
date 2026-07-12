import { Date, getDate } from "./Date"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { trieFromAllFiles } from "../util/ctx"
import { FullSlug, resolveRelative, simplifySlug } from "../util/path"
import style from "./styles/docPageHeader.scss"
import { execFileSync } from "child_process"
import fs from "fs"
import path from "path"

type HeaderCrumb = {
  label: string
  href: string
}

const LIBRARY_ROOT = "index" as FullSlug

const titleCase = (segment: string) =>
  segment.replaceAll("-", " ").replace(/\b\w/g, (char) => char.toUpperCase())

const titleFromSlug = (slug: string) => {
  const parts = slug.split("/").filter((part) => part.length > 0 && part !== "index")
  return titleCase(parts.at(-1) ?? "Literature Notes")
}

const displayName = (name: string) => name.replaceAll("-", " ")

const textValue = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (typeof value === "number") {
    return String(value)
  }

  return undefined
}

const textList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = textValue(item)
      return text ? [text] : []
    })
  }

  const text = textValue(value)
  return text ? [text] : []
}

const formatAuthors = (authors: string[]) =>
  authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ")

const doiHref = (doi: string) => {
  const normalized = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
  return `https://doi.org/${normalized}`
}

let cachedSourceRef: string | undefined
function sourceRef(fallback = "main") {
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

function githubSourceUrl(
  repo: string | null | undefined,
  repoPath: string | null | undefined,
  { ref = sourceRef(), startLine }: { ref?: string; startLine?: number } = {},
) {
  if (!repo || !repoPath) return null
  const normalizedRepo = repo
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\/+$/, "")
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalizedRepo)) return null

  const cleanPath = repoPath
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")
  if (!cleanPath) return null

  const start = Number(startLine)
  const fragment = Number.isInteger(start) && start > 0 ? `#L${start}` : ""
  return `https://github.com/${normalizedRepo}/blob/${encodeURIComponent(ref)}/${cleanPath}${fragment}`
}

function loadBlueprintSourceConfig(repoRoot: string) {
  const defaults = { root: "blueprint", repo: null as string | null }
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "blueprint.config.json"), "utf8")
    const entry = (JSON.parse(raw).blueprints ?? [])[0] ?? {}
    return {
      root: typeof entry.root === "string" ? entry.root : defaults.root,
      repo: typeof entry.repo === "string" ? entry.repo : defaults.repo,
    }
  } catch {
    return defaults
  }
}

const SourceIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M6.5 3.5h-3v9h9v-3" />
    <path d="M8.5 3.5h4v4" />
    <path d="m6.5 9.5 6-6" />
  </svg>
)

const DocPageHeader: QuartzComponent = ({
  cfg,
  fileData,
  allFiles,
  displayClass,
  ctx,
}: QuartzComponentProps) => {
  const slug = fileData.slug!
  const frontmatterTitle =
    typeof fileData.frontmatter?.title === "string" ? fileData.frontmatter.title : undefined
  const title =
    frontmatterTitle && !frontmatterTitle.startsWith("Folder: ")
      ? frontmatterTitle
      : titleFromSlug(slug)
  const date = getDate(cfg, fileData)
  const trie = (ctx.trie ??= trieFromAllFiles(allFiles))
  const pathNodes = trie.ancestryChain(slug.split("/")) ?? []
  const ancestorNodes = pathNodes.slice(1, -1)

  const crumbs: HeaderCrumb[] = [
    {
      label: "Home",
      href: resolveRelative(slug, LIBRARY_ROOT),
    },
    ...ancestorNodes
      .filter((node) => !["index"].includes(node.slugSegment))
      .map((node) => ({
        label: displayName(node.displayName),
        href: resolveRelative(slug, simplifySlug(node.slug)),
      })),
  ]

  const frontmatter = fileData.frontmatter
  const isPaper = frontmatter?.type === "paper"
  const authors = textList(frontmatter?.authors)
  const metadataLine = [
    authors.length > 0 ? formatAuthors(authors) : undefined,
    textValue(frontmatter?.year),
    textValue(frontmatter?.venue),
  ]
    .filter(Boolean)
    .join(" · ")
  const citekey = textValue(frontmatter?.citekey)
  const doi = textValue(frontmatter?.doi)
  const url = textValue(frontmatter?.url)
  const paperLinks = [
    doi ? { label: "DOI", href: doiHref(doi) } : undefined,
    url ? { label: "Source", href: url } : undefined,
  ].filter((link): link is { label: string; href: string } => Boolean(link))
  const hasPaperMeta = isPaper && metadataLine
  const hasPaperHeaderMeta = isPaper && (citekey || paperLinks.length > 0)
  const repoRoot = path.resolve(ctx.argv.directory, "..")
  const blueprintCfg = loadBlueprintSourceConfig(repoRoot)
  const relativePath = typeof fileData.relativePath === "string" ? fileData.relativePath : undefined
  const isBlueprintPage = slug === blueprintCfg.root || slug.startsWith(`${blueprintCfg.root}/`)
  const pageSourceHref =
    isBlueprintPage && relativePath
      ? githubSourceUrl(blueprintCfg.repo, path.posix.join("content", relativePath), {
          ref: sourceRef(),
          startLine: 1,
        })
      : null
  const pageSourceLabel = relativePath?.endsWith(".lean")
    ? "View Lean chapter source"
    : "View page source"

  return (
    <header class={classNames(displayClass, "doc-page-header")}>
      <div class="doc-header-topline">
        <nav class="doc-breadcrumb" aria-label="Breadcrumb">
          <ol>
            {crumbs.map((crumb) => (
              <li>
                <a href={crumb.href}>{crumb.label}</a>
              </li>
            ))}
          </ol>
        </nav>
        {date && (
          <>
            <span class="meta-sep">·</span>
            <span class="doc-page-date">
              <Date date={date} locale={cfg.locale} />
            </span>
          </>
        )}
        {hasPaperHeaderMeta && citekey && (
          <>
            <span class="meta-sep">·</span>
            <span class="doc-paper-citekey">@{citekey}</span>
          </>
        )}
        {hasPaperHeaderMeta && paperLinks.length > 0 && (
          <>
            <span class="meta-sep">·</span>
            <span class="doc-paper-source-links" aria-label="Paper sources">
              {paperLinks.map((link) => (
                <a
                  class="doc-paper-source-link"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.label}
                  aria-label={link.label}
                >
                  <SourceIcon />
                </a>
              ))}
            </span>
          </>
        )}
        {pageSourceHref && (
          <>
            <span class="meta-sep">·</span>
            <span class="doc-source-links" aria-label="Page source">
              <a
                class="doc-source-link"
                href={pageSourceHref}
                target="_blank"
                rel="noopener noreferrer"
                title={pageSourceLabel}
                aria-label={pageSourceLabel}
              >
                <SourceIcon />
              </a>
            </span>
          </>
        )}
      </div>
      <h1 class="article-title doc-page-title">{title}</h1>
      {hasPaperMeta && (
        <div class="doc-paper-meta">
          <p class="doc-paper-byline">{metadataLine}</p>
        </div>
      )}
    </header>
  )
}

DocPageHeader.css = style

export default (() => DocPageHeader) satisfies QuartzComponentConstructor
