import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { previewDeploymentInfo } from "./PreviewDeploymentBanner"
import { ChangedPage, normalizeSourcePath, previewChangedPages } from "./ChangedPageData"

export type { ChangedPage } from "./ChangedPageData"
export { previewChangedPages } from "./ChangedPageData"

export function changedPageForFileData(
  fileData: QuartzComponentProps["fileData"],
): ChangedPage | undefined {
  if (!previewDeploymentInfo()) return undefined

  const currentSource =
    typeof fileData.relativePath === "string"
      ? normalizeSourcePath(fileData.relativePath)
      : undefined
  const currentSlug = typeof fileData.slug === "string" ? fileData.slug : undefined
  const changedPages = previewChangedPages()

  if (currentSource) {
    const bySource = changedPages.find((page) => page.sourcePath === currentSource)
    if (bySource) return bySource
  }

  if (currentSlug) {
    return changedPages.find((page) => page.slug === currentSlug)
  }

  return undefined
}

export default (() => {
  const ChangedPageBanner: QuartzComponent = (props: QuartzComponentProps) => {
    const info = previewDeploymentInfo()
    const changedPage =
      (props.changedPage as ChangedPage | undefined) ?? changedPageForFileData(props.fileData)
    if (!info || !changedPage) return null

    return (
      <aside class="sepo-changed-page-banner" aria-label="Changed page notice">
        <div class="sepo-changed-page-banner-inner">
          <strong>This page is changed in this PR</strong>
          <span class="sepo-changed-page-banner-source">{changedPage.sourcePath}</span>
          <a href={`${info.prUrl}/files`} target="_blank" rel="noopener noreferrer">
            View diff
          </a>
        </div>
      </aside>
    )
  }

  return ChangedPageBanner
}) satisfies QuartzComponentConstructor
