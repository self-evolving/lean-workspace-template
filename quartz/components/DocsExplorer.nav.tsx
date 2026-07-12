import { QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"
import { type DocsNavItem } from "../util/docsNav.mjs"

export type PageTocItem = {
  depth: number
  text: string
  slug: string
}

export function pageTocItems(fileData: QuartzComponentProps["fileData"]): PageTocItem[] {
  const toc = (fileData as Record<string, unknown>).toc
  if (!Array.isArray(toc)) return []

  return toc.flatMap((entry): PageTocItem[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []

    const { depth, text, slug } = entry as Record<string, unknown>
    if (
      typeof depth !== "number" ||
      !Number.isFinite(depth) ||
      depth < 0 ||
      typeof text !== "string" ||
      text.trim().length === 0 ||
      typeof slug !== "string" ||
      slug.trim().length === 0
    ) {
      return []
    }

    const normalizedSlug = slug.trim().replace(/^#/, "")
    return normalizedSlug ? [{ depth, text: text.trim(), slug: normalizedSlug }] : []
  })
}

export function isActive(currentSlug: FullSlug, item: DocsNavItem) {
  if (currentSlug === item.slug) {
    return true
  }

  const folderPrefix = item.slug.endsWith("/index")
    ? item.slug.slice(0, -"index".length)
    : `${item.slug}/`

  return currentSlug.startsWith(folderPrefix)
}

export const docsNavSectionId = (item: DocsNavItem) =>
  `docs-nav-${item.slug.replace(/\/index$/, "").replace(/[^a-z0-9_-]+/gi, "-")}`

function navItemPageTypeLabel(item: DocsNavItem) {
  if (item.pageType === "canvas") return "Canvas page"
  return undefined
}

function renderNavItemPageType(item: DocsNavItem) {
  const label = navItemPageTypeLabel(item)
  if (!label) return null

  return (
    <span
      class={["docs-nav-page-kind", `docs-nav-page-kind-${item.pageType}`].join(" ")}
      aria-label={label}
      title={label}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
        <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
        <path d="M10 6.5h4.5a3 3 0 0 1 3 3V14"></path>
        <path d="M14 17.5H9.5a3 3 0 0 1-3-3V10"></path>
      </svg>
    </span>
  )
}

function renderNavItemLabel(item: DocsNavItem) {
  return (
    <span class="docs-nav-item-label">
      <span class="docs-nav-item-title">{item.title}</span>
      {renderNavItemPageType(item)}
    </span>
  )
}

export function renderActivePageToc(toc: PageTocItem[]) {
  if (toc.length === 0) return null

  const minDepth = Math.min(...toc.map((item) => item.depth))
  return (
    <ul class="docs-nav-page-toc" aria-label="Current page table of contents">
      {toc.map((item) => (
        <li style={`--toc-indent: ${Math.max(0, item.depth - minDepth) * 0.72}rem`}>
          <a class="docs-nav-page-toc-link" href={`#${item.slug}`}>
            <span>{item.text}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function renderNavItem(
  currentSlug: FullSlug,
  item: DocsNavItem,
  allSlugs: FullSlug[],
  activePageToc: PageTocItem[],
) {
  const active = isActive(currentSlug, item)
  const current = currentSlug === item.slug
  const hasChildren = item.children && item.children.length > 0
  const sectionId = hasChildren ? docsNavSectionId(item) : undefined
  const expanded = active
  const itemHref = resolveRelative(currentSlug, item.slug)
  const hasPage = allSlugs.includes(item.slug)
  const currentPageToc = current && !hasChildren ? renderActivePageToc(activePageToc) : null

  return (
    <li
      class={[
        active ? "active" : undefined,
        hasChildren ? "has-children docs-nav-section" : undefined,
        hasChildren ? (expanded ? "expanded" : "collapsed") : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hasChildren ? (
        <>
          <div
            class={["docs-nav-link docs-nav-section-row", current ? "active" : undefined]
              .filter(Boolean)
              .join(" ")}
          >
            {hasPage ? (
              <a
                class="docs-nav-section-anchor"
                href={itemHref}
                data-controls={sectionId}
                data-title={item.title}
              >
                {renderNavItemLabel(item)}
              </a>
            ) : (
              <button
                type="button"
                class="docs-nav-section-anchor docs-nav-section-action"
                aria-controls={sectionId}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
                data-title={item.title}
              >
                {renderNavItemLabel(item)}
              </button>
            )}
            <button
              type="button"
              class="docs-nav-section-toggle"
              aria-controls={sectionId}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
              data-title={item.title}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="fold"
              >
                <path d="M9 5l7 7-7 7"></path>
              </svg>
            </button>
          </div>
          <ul id={sectionId} class="docs-nav-children" hidden={!expanded}>
            {item.children!.map((child) =>
              renderNavItem(currentSlug, child, allSlugs, activePageToc),
            )}
          </ul>
        </>
      ) : (
        <>
          <a
            class={["docs-nav-link", current ? "active" : undefined].filter(Boolean).join(" ")}
            href={itemHref}
          >
            {renderNavItemLabel(item)}
          </a>
          {currentPageToc}
        </>
      )}
    </li>
  )
}
