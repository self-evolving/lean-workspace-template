import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
// @ts-ignore
import leanWatchScript from "./scripts/leanwatch.inline"
import { classNames } from "../util/lang"

const GITHUB_URL = "https://github.com/self-evolving/lean-workspace-template"

const SepoFooter: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  const year = new Date().getFullYear()

  return (
    <footer class={classNames(displayClass, "sepo-footer")}>
      <p>
        &copy; {year}{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          Lean Workspace Project
        </a>
      </p>
    </footer>
  )
}

// The dev-only lean-watch pill rides the footer into the global postscript
// bundle (so it runs on every page, canvas included); the script itself is
// localhost-gated and dormant on deployed sites.
SepoFooter.afterDOMLoaded = leanWatchScript

export default (() => SepoFooter) satisfies QuartzComponentConstructor
