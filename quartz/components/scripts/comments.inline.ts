type SepoWindow = Window & {
  sepoComments?: {
    setTheme: (theme: string) => void
    open: () => void
    close: () => void
  }
  __sepoCleanup?: () => void
}

const getConfig = () => document.querySelector<HTMLElement>(".sepo-embed")

const themeFor = (cfg: HTMLElement) => {
  const saved = document.documentElement.getAttribute("saved-theme")
  return saved === "dark"
    ? (cfg.dataset.darkTheme ?? "sepo_dark")
    : (cfg.dataset.lightTheme ?? "sepo_light")
}

// Dataset keys forwarded verbatim from the config element onto the sepo.js
// script tag.
const forwardedKeys = [
  "repo",
  "repoId",
  "category",
  "categoryId",
  "mapping",
  "strict",
  "reactionsEnabled",
  "inputPosition",
  "lang",
  "triggerMode",
  "tabs",
  "defaultTab",
  "contentRepo",
  "prNumber",
  "previewPr",
  "previewBranch",
  "previewDomain",
  "previewApi",
  "previewSwitcher",
] as const

const mountSepo = (cfg: HTMLElement) => {
  const host = (cfg.dataset.appHost ?? "https://comment-api.sepo-preview.xyz").replace(/\/+$/, "")

  // Re-injecting the (cached) script re-runs it; sepo.js tears down any
  // previous embed itself, so this is safe across SPA navigations.
  document.getElementById("sepo-embed-script")?.remove()
  const sepoScript = document.createElement("script")
  sepoScript.id = "sepo-embed-script"
  sepoScript.src = `${host}/sepo.js`
  sepoScript.async = true
  sepoScript.crossOrigin = "anonymous"
  for (const key of forwardedKeys) {
    const value = cfg.dataset[key]
    if (value) {
      sepoScript.dataset[key] = value
    }
  }
  // The site's own light/dark toggle decides the widget theme, not the OS
  // scheme sepo.js would otherwise follow.
  sepoScript.dataset.theme = themeFor(cfg)
  document.head.appendChild(sepoScript)
}

document.addEventListener("nav", () => {
  const cfg = getConfig()
  if (!cfg) {
    // Pages without comments (frontmatter-disabled) must not keep the
    // previous page's drawer alive across SPA navigation: run the service
    // runtime's own cleanup and remove its host and script tag.
    ;(window as SepoWindow).__sepoCleanup?.()
    for (const node of Array.from(document.querySelectorAll(".sepo-comments"))) {
      node.remove()
    }
    document.getElementById("sepo-embed-script")?.remove()
    return
  }

  mountSepo(cfg)

  const onThemeChange = () => {
    const theme = themeFor(cfg)
    // Keep the pending script tag current too: if the toggle fires before
    // sepo.js has executed (no sepoComments yet), the script must not boot
    // with a stale data-theme.
    document.getElementById("sepo-embed-script")?.setAttribute("data-theme", theme)
    ;(window as SepoWindow).sepoComments?.setTheme(theme)
  }
  document.addEventListener("themechange", onThemeChange)
  window.addCleanup(() => document.removeEventListener("themechange", onThemeChange))
})
