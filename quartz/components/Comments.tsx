import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import script from "./scripts/comments.inline"

type Options = {
  provider: "giscus"
  options: {
    repo: `${string}/${string}`
    repoId?: string
    category?: string
    categoryId?: string
    appHost?: string
    lightTheme?: string
    darkTheme?: string
    mapping?: "url" | "title" | "og:title" | "specific" | "number" | "pathname"
    strict?: boolean
    reactionsEnabled?: boolean
    inputPosition?: "top" | "bottom"
    lang?: string
    triggerMode?: "pill" | "bot"
    tabs?: Array<"discussions" | "issues" | "pulls">
    defaultTab?: "discussions" | "issues" | "pulls"
    contentRepo?: `${string}/${string}`
    prNumber?: number
    previewBranch?: string
    previewDomain?: string
    previewApi?: string
    previewSwitcher?: "hover" | "always"
  }
}

function boolToStringBool(b: boolean): string {
  return b ? "1" : "0"
}

export default ((opts: Options) => {
  const Comments: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    // check if comments should be displayed according to frontmatter
    const disableComment: boolean =
      typeof fileData.frontmatter?.comments !== "undefined" &&
      (!fileData.frontmatter?.comments || fileData.frontmatter?.comments === "false")
    if (disableComment) {
      return <></>
    }

    // The drawer (trigger, panel, mascot, widget themes) ships from the Sepo
    // comments service as sepo.js; this component only emits the configuration
    // that comments.inline.ts forwards onto the script tag.
    // prNumber feeds two consumers under different names: data-pr-number
    // deep-links the widget's pulls tab, data-preview-pr pins the preview
    // pill's identity.
    return (
      <div
        class="sepo-embed"
        data-app-host={opts.options.appHost ?? "https://comment-api.sepo-preview.xyz"}
        data-repo={opts.options.repo}
        data-repo-id={opts.options.repoId}
        data-category={opts.options.category}
        data-category-id={opts.options.categoryId}
        data-mapping={opts.options.mapping ?? "url"}
        data-strict={boolToStringBool(opts.options.strict ?? true)}
        data-reactions-enabled={boolToStringBool(opts.options.reactionsEnabled ?? true)}
        data-input-position={opts.options.inputPosition ?? "bottom"}
        data-lang={opts.options.lang ?? "en"}
        data-trigger-mode={opts.options.triggerMode ?? "pill"}
        data-light-theme={opts.options.lightTheme ?? "sepo_light"}
        data-dark-theme={opts.options.darkTheme ?? "sepo_dark"}
        data-tabs={opts.options.tabs?.length ? opts.options.tabs.join(",") : undefined}
        data-default-tab={opts.options.defaultTab}
        data-content-repo={opts.options.contentRepo}
        data-pr-number={opts.options.prNumber ? String(opts.options.prNumber) : undefined}
        data-preview-pr={opts.options.prNumber ? String(opts.options.prNumber) : undefined}
        data-preview-branch={opts.options.previewBranch}
        data-preview-domain={opts.options.previewDomain}
        data-preview-api={opts.options.previewApi}
        data-preview-switcher={opts.options.previewSwitcher}
        hidden
      ></div>
    )
  }

  Comments.afterDOMLoaded = script

  return Comments
}) satisfies QuartzComponentConstructor<Options>
