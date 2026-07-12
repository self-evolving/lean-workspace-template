import { QuartzComponent, QuartzComponentConstructor } from "./types"
// @ts-ignore
import script from "./scripts/hypothesis.inline"

export type Options = {
  enabled?: boolean
  openSidebar?: boolean
  showHighlights?: boolean
  commentsMode?: boolean
  groupsAllowlist?: string[]
  theme?: "classic" | "clean"
}

export default ((opts?: Options) => {
  const enabled = opts?.enabled ?? false
  const clientConfig = {
    openSidebar: opts?.openSidebar ?? false,
    showHighlights: opts?.showHighlights ?? true,
    commentsMode: opts?.commentsMode ?? false,
    ...(opts?.groupsAllowlist?.length ? { groupsAllowlist: opts.groupsAllowlist } : {}),
    ...(opts?.theme ? { theme: opts.theme } : {}),
  }
  const serializedConfig = JSON.stringify(clientConfig).replace(/</g, "\\u003c")

  const Hypothesis: QuartzComponent = () => {
    if (!enabled) {
      return <></>
    }

    return (
      <script
        type="application/json"
        class="js-hypothesis-config"
        dangerouslySetInnerHTML={{ __html: serializedConfig }}
      />
    )
  }

  if (enabled) {
    Hypothesis.afterDOMLoaded = script
  }

  return Hypothesis
}) satisfies QuartzComponentConstructor<Options | undefined>
