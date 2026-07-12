import fs from "node:fs"
import path from "node:path"
import { h } from "preact"
import { Fragment, jsx, jsxs } from "preact/jsx-runtime"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { isFolderPath, joinSegments, resolveRelative } from "@quartz-community/utils/path"

const defaultOptions = {
  showFolderCount: true,
  showSubfolders: true,
  orderFromMeta: true,
  prefixFolders: false,
}

const listPageCss = `
ul.section-ul {
  list-style: none;
  margin-top: 2em;
  padding-left: 0;
}

li.section-li {
  margin-bottom: 1em;
}

li.section-li > .section {
  display: grid;
  grid-template-columns: fit-content(8em) 3fr 1fr;
}

@media all and (max-width: 600px) {
  li.section-li > .section > .tags {
    display: none;
  }
}

li.section-li > .section > .desc > h3 > a {
  background-color: transparent;
}

li.section-li > .section .meta {
  margin: 0 1em 0 0;
  opacity: 0.6;
}

.popover .section {
  grid-template-columns: fit-content(8em) 1fr !important;
}

.popover .section > .tags {
  display: none;
}
`

const pageListCss = `
.section h3 {
  margin: 0;
}

.section > .tags {
  margin: 0;
}
`

function childrenToString(children) {
  if (typeof children === "string") return children
  if (Array.isArray(children)) return children.map(childrenToString).join("")
  return String(children ?? "")
}

const customComponents = {
  table: (props) => h("div", { class: "table-container" }, h("table", props)),
  style: ({ children, ...rest }) =>
    h("style", { ...rest, dangerouslySetInnerHTML: { __html: childrenToString(children) } }),
  script: ({ children, ...rest }) =>
    h("script", { ...rest, dangerouslySetInnerHTML: { __html: childrenToString(children) } }),
}

function htmlToJsx(tree) {
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    elementAttributeNameCase: "html",
    components: customComponents,
  })
}

function pageDate(page, cfg) {
  const dates = page?.dates
  if (!dates) return undefined

  const dateType = cfg?.defaultDateType
  if (dateType && dates[dateType]) return dates[dateType]
  return dates.modified ?? dates.created ?? dates.published
}

function byDateAndAlphabeticalFolderFirst(cfg) {
  return (first, second) => {
    const firstIsFolder = isFolderPath(first.slug ?? "")
    const secondIsFolder = isFolderPath(second.slug ?? "")
    if (firstIsFolder && !secondIsFolder) return -1
    if (!firstIsFolder && secondIsFolder) return 1

    const firstDate = pageDate(first, cfg)
    const secondDate = pageDate(second, cfg)
    if (firstDate && secondDate) return secondDate.getTime() - firstDate.getTime()
    if (firstDate && !secondDate) return -1
    if (!firstDate && secondDate) return 1

    const firstTitle = first.frontmatter?.title?.toLowerCase() ?? ""
    const secondTitle = second.frontmatter?.title?.toLowerCase() ?? ""
    return firstTitle.localeCompare(secondTitle)
  }
}

function dateDisplay(date, locale) {
  return h(
    "time",
    { dateTime: date.toISOString() },
    date.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
  )
}

function PageList({ cfg, fileData, allFiles, limit, sort }) {
  const sorter = sort ?? byDateAndAlphabeticalFolderFirst(cfg)
  let list = [...allFiles].sort(sorter)
  if (limit) list = list.slice(0, limit)

  const locale = cfg?.locale ?? "en-US"
  const fileSlug = fileData?.slug ?? ""

  return h(
    "ul",
    { class: "section-ul" },
    list.map((page) => {
      const title = page.frontmatter?.title
      const tags = page.frontmatter?.tags ?? []
      const date = pageDate(page, cfg)

      return h("li", { class: "section-li" }, [
        h("div", { class: "section" }, [
          h("p", { class: "meta" }, date ? dateDisplay(date, locale) : undefined),
          h("div", { class: "desc" }, [
            h("h3", null, [
              h(
                "a",
                {
                  href: resolveRelative(fileSlug, page.slug),
                  class: "internal",
                },
                title,
              ),
            ]),
          ]),
          h(
            "ul",
            { class: "tags" },
            tags.map((tag) =>
              h("li", null, [
                h(
                  "a",
                  {
                    class: "internal tag-link",
                    href: resolveRelative(fileSlug, `tags/${tag}`),
                  },
                  tag,
                ),
              ]),
            ),
          ),
        ]),
      ])
    }),
  )
}

function concatenateResources(...resources) {
  const result = resources.filter((resource) => resource !== undefined).flat()
  return result.length === 0 ? undefined : result
}

function folderPrefixFromSlug(folderSlug) {
  if (folderSlug.endsWith("/index")) return folderSlug.slice(0, -"index".length)
  if (folderSlug.endsWith("/")) return folderSlug
  return `${folderSlug}/`
}

function folderRelFromSlug(folderSlug) {
  if (folderSlug === "index") return ""
  if (folderSlug.endsWith("/index")) return folderSlug.slice(0, -"/index".length)
  return folderSlug.replace(/\/+$/, "")
}

function entrySegmentForFolder(entrySlug, folderSlug) {
  if (!entrySlug) return undefined
  const folderPrefix = folderPrefixFromSlug(folderSlug)
  if (!entrySlug.startsWith(folderPrefix)) return undefined

  const relativePath = entrySlug.slice(folderPrefix.length)
  if (!relativePath || relativePath === "index") return undefined
  return relativePath.split("/")[0]
}

function readMetaOrder(contentRoot, folderSlug) {
  const folderRel = folderRelFromSlug(folderSlug)
  const metaPath = path.join(contentRoot, ...folderRel.split("/").filter(Boolean), "_meta.json")

  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"))
    if (!Array.isArray(parsed.pages)) return undefined

    const order = new Map()
    for (const [index, page] of parsed.pages.entries()) {
      if (typeof page === "string" && page.length > 0) order.set(page, index)
    }
    return order.size > 0 ? order : undefined
  } catch {
    return undefined
  }
}

function metaAwareSort(folderSlug, contentRoot, fallbackSort) {
  const order = readMetaOrder(contentRoot, folderSlug)
  if (!order) return fallbackSort

  return (first, second) => {
    const firstSegment = entrySegmentForFolder(first.slug, folderSlug)
    const secondSegment = entrySegmentForFolder(second.slug, folderSlug)
    const firstOrder = firstSegment ? order.get(firstSegment) : undefined
    const secondOrder = secondSegment ? order.get(secondSegment) : undefined

    if (firstOrder !== undefined && secondOrder !== undefined) return firstOrder - secondOrder
    if (firstOrder !== undefined) return -1
    if (secondOrder !== undefined) return 1
    return fallbackSort(first, second)
  }
}

function mostRecentDatesFromChildren(children) {
  let maybeDates
  for (const child of children) {
    const childDates = child.data?.dates
    if (childDates) {
      maybeDates = mostRecentDatesFromEntries([{ dates: maybeDates }, { dates: childDates }])
    }
  }
  return maybeDates ?? { created: new Date(), modified: new Date(), published: new Date() }
}

function mostRecentDatesFromEntries(entries) {
  let maybeDates
  for (const entry of entries) {
    if (!entry.dates) continue
    if (!maybeDates) {
      maybeDates = { ...entry.dates }
    } else {
      if (entry.dates.created > maybeDates.created) maybeDates.created = entry.dates.created
      if (entry.dates.modified > maybeDates.modified) maybeDates.modified = entry.dates.modified
      if (entry.dates.published > maybeDates.published) maybeDates.published = entry.dates.published
    }
  }
  return maybeDates
}

function pagesFromTrie(folder, showSubfolders) {
  return folder.children
    .map((node) => {
      const nodeData = node.data
      if (nodeData) {
        if (nodeData.unlisted === true) return undefined
        return nodeData
      }

      if (node.isFolder && showSubfolders) {
        return {
          slug: node.slug,
          dates: mostRecentDatesFromChildren(node.children),
          frontmatter: { title: node.displayName, tags: [] },
        }
      }
      return undefined
    })
    .filter((page) => page !== undefined)
}

function pagesFromAllFiles(allFiles, folderSlug, showSubfolders) {
  const folderPrefix = folderPrefixFromSlug(folderSlug)
  const directChildren = []
  const subfolderFiles = new Map()

  for (const file of allFiles) {
    if (file.unlisted === true) continue
    const fileSlug = file.slug
    if (!fileSlug || !fileSlug.startsWith(folderPrefix)) continue

    const relativePath = fileSlug.slice(folderPrefix.length)
    if (!relativePath || relativePath === "index") continue

    const segments = relativePath.split("/")
    if (segments.length === 1) {
      directChildren.push(file)
    } else if (showSubfolders) {
      const subfolderName = segments[0]
      const files = subfolderFiles.get(subfolderName) ?? []
      files.push(file)
      subfolderFiles.set(subfolderName, files)
    }
  }

  for (const [subfolderName, files] of subfolderFiles) {
    const indexFile = files.find((file) => file.slug === `${folderPrefix}${subfolderName}/index`)
    if (indexFile) {
      directChildren.push(indexFile)
      continue
    }

    directChildren.push({
      slug: `${folderPrefix}${subfolderName}/index`,
      dates: mostRecentDatesFromEntries(files),
      frontmatter: { title: subfolderName, tags: [] },
    })
  }

  return directChildren
}

function folderCountText(count) {
  return count === 1 ? "1 item under this folder." : `${count} items under this folder.`
}

function FolderContentComponent(userOptions) {
  const options = { ...defaultOptions, ...userOptions }

  const FolderContent = (props) => {
    const { tree, fileData, allFiles, cfg } = props
    const ctx = props.ctx
    const slug = fileData?.slug
    if (!slug) return null

    const trie = ctx?.trie
    let allPagesInFolder

    if (trie) {
      const folder = trie.findNode(slug.split("/"))
      if (!folder) return null
      allPagesInFolder = pagesFromTrie(folder, options.showSubfolders)
    } else {
      allPagesInFolder = pagesFromAllFiles(allFiles ?? [], slug, options.showSubfolders)
    }

    const contentRoot = path.resolve(ctx?.argv?.directory ?? "content")
    const fallbackSort = options.sort ?? byDateAndAlphabeticalFolderFirst(cfg)
    const sort = options.orderFromMeta
      ? metaAwareSort(slug, contentRoot, fallbackSort)
      : fallbackSort
    const listProps = {
      ...props,
      sort,
      allFiles: allPagesInFolder,
    }

    const cssClasses = fileData?.frontmatter?.cssclasses ?? []
    const classes = Array.isArray(cssClasses) ? cssClasses.join(" ") : String(cssClasses)
    const content = tree?.children?.length === 0 ? fileData?.description : htmlToJsx(tree)
    const pageListContent = PageList(listProps)

    return h("div", { class: "popover-hint" }, [
      h("article", { class: classes }, [
        h("div", { class: "markdown-preview-view markdown-rendered" }, content),
      ]),
      h("div", { class: "page-listing" }, [
        options.showFolderCount
          ? h("p", null, folderCountText(allPagesInFolder.length))
          : undefined,
        h("div", null, pageListContent),
      ]),
    ])
  }

  FolderContent.css = concatenateResources(listPageCss, pageListCss)
  return FolderContent
}

const folderMatcher = ({ slug }) => slug.endsWith("/index")

function getFolders(slug) {
  let folderName = path.posix.dirname(slug ?? "")
  const parentFolderNames = [folderName]
  while (folderName !== ".") {
    folderName = path.posix.dirname(folderName ?? "")
    parentFolderNames.push(folderName)
  }
  return parentFolderNames
}

export function FolderPage(userOptions) {
  const options = { ...defaultOptions, ...userOptions }
  const body = () => FolderContentComponent(options)

  return {
    name: "FolderPage",
    priority: 10,
    match: folderMatcher,
    generate({ content, cfg }) {
      const allFiles = content
        .map((entry) => entry[1].data)
        .filter((data) => data?.unlisted !== true)
      const locale = cfg?.locale ?? "en-US"

      const folders = new Set()
      const folderDisplayNames = new Map()
      for (const file of allFiles) {
        const slug = file?.slug
        if (!slug) continue

        const fileFolders = getFolders(slug).filter((folder) => folder !== "." && folder !== "tags")
        for (const folder of fileFolders) folders.add(folder)

        const relativePath = file?.relativePath
        if (relativePath) {
          const slugParts = path.posix.dirname(slug).split("/").filter(Boolean)
          const pathParts = path.posix.dirname(relativePath).split("/").filter(Boolean)
          for (let index = 0; index < slugParts.length && index < pathParts.length; index++) {
            const slugPart = slugParts[index]
            const pathPart = pathParts[index]
            if (slugPart && pathPart && !folderDisplayNames.has(slugPart)) {
              folderDisplayNames.set(slugPart, pathPart)
            }
          }
        }
      }

      const foldersWithIndex = new Set()
      for (const [, file] of content) {
        const data = file.data
        if (data?.unlisted === true) continue
        const slug = data?.slug
        if (slug && slug.endsWith("/index")) {
          foldersWithIndex.add(slug.slice(0, -"/index".length))
        }
      }

      for (const [, file] of content) {
        const slug = file.data?.slug
        if (!slug || !slug.endsWith("/index")) continue

        const frontmatter = file.data?.frontmatter
        if (!frontmatter || (frontmatter.title && frontmatter.title !== "index")) continue

        const folder = slug.slice(0, -"/index".length)
        const slugSegment = folder.split("/").pop() ?? folder
        const folderName = folderDisplayNames.get(slugSegment) ?? slugSegment
        frontmatter.title = options.prefixFolders ? folderTitle(folderName, locale) : folderName
      }

      const virtualPages = []
      for (const folder of folders) {
        if (foldersWithIndex.has(folder)) continue

        const slug = joinSegments(folder, "index")
        const slugSegment = folder.split("/").pop() ?? folder
        const folderName = folderDisplayNames.get(slugSegment) ?? slugSegment
        const title = options.prefixFolders ? folderTitle(folderName, locale) : folderName

        virtualPages.push({
          slug,
          title,
          data: {},
        })
      }

      return virtualPages
    },
    layout: "folder",
    body,
  }
}

function folderTitle(folderName, _locale) {
  return `Folder: ${folderName}`
}

export default FolderPage
