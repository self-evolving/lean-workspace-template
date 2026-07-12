import path from "node:path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { FullSlug, resolveRelative } from "../util/path"
import { buildDocsNav, type DocsNavData } from "../util/docsNav.mjs"
import { isActive, pageTocItems, renderNavItem } from "./DocsExplorer.nav"
import style from "./styles/docsExplorer.scss"

// @ts-ignore
import script from "./scripts/docsExplorer.inline"

let docsNavCache: { key: string; data: DocsNavData } | undefined

function docsNavForContentRoot(contentRoot: string, buildId: string, ignorePatterns: string[]) {
  const navRoot = path.resolve(contentRoot)
  const key = `${buildId}:${navRoot}:${JSON.stringify(ignorePatterns)}`

  if (docsNavCache?.key === key) {
    return docsNavCache.data
  }

  const data = buildDocsNav({ docsRoot: navRoot, slugPrefix: "", ignorePatterns })
  docsNavCache = { key, data }
  return data
}

const DocsExplorer: QuartzComponent = ({
  ctx,
  cfg,
  fileData,
  displayClass,
}: QuartzComponentProps) => {
  const currentSlug = fileData.slug as FullSlug
  const docsNavData = docsNavForContentRoot(
    ctx.argv.directory,
    ctx.buildId,
    cfg.ignorePatterns ?? [],
  )
  const rootActive = currentSlug === docsNavData.root.slug

  // A folder declared `{ "folder": ..., "underRoot": true }` in the root _meta.json
  // nests under the root entry: the root renders as an expandable section labeled
  // with the root title, anchored at that folder's index, containing its pages.
  // Without such a folder, the root has no standalone nav entry (the landing page
  // is reachable via the site title) and only its child pages are listed.
  const rootSection = docsNavData.items.find((it) => it.underRoot && it.children?.length)
  const restItems = docsNavData.items.filter((it) => it !== rootSection)
  const activePageToc = pageTocItems(fileData)

  return (
    <nav class={classNames(displayClass, "docs-explorer")} aria-label="Literature navigation">
      <ul class="docs-nav-root">
        {rootSection ? (
          <li
            class={[
              "docs-root-link has-children docs-nav-section expanded",
              rootActive || isActive(currentSlug, rootSection) ? "active" : undefined,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              class={[
                "docs-nav-link docs-nav-section-row",
                currentSlug === rootSection.slug ? "active" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <a
                class="docs-nav-section-anchor"
                href={resolveRelative(currentSlug, rootSection.slug)}
                data-controls="docs-nav-root-pages"
                data-title={docsNavData.root.title}
              >
                <span>{docsNavData.root.title}</span>
              </a>
              <button
                type="button"
                class="docs-nav-section-toggle"
                aria-controls="docs-nav-root-pages"
                aria-expanded={true}
                aria-label={`Collapse ${docsNavData.root.title}`}
                data-title={docsNavData.root.title}
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
            <ul id="docs-nav-root-pages" class="docs-nav-children">
              {rootSection.children!.map((item) =>
                renderNavItem(currentSlug, item, ctx.allSlugs, activePageToc),
              )}
            </ul>
          </li>
        ) : null}
        {restItems.map((item) => renderNavItem(currentSlug, item, ctx.allSlugs, activePageToc))}
      </ul>
    </nav>
  )
}

DocsExplorer.css = style
DocsExplorer.afterDOMLoaded = script

export default (() => DocsExplorer) satisfies QuartzComponentConstructor
