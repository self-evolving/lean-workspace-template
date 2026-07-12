const docsExplorerStateKey = "quartz:docs-explorer:sections"
const docsExplorerScrollKey = "quartz:docs-explorer:scrollTop"

type DocsExplorerState = Record<string, boolean>

function readDocsExplorerState(): DocsExplorerState {
  try {
    return JSON.parse(localStorage.getItem(docsExplorerStateKey) ?? "{}")
  } catch {
    return {}
  }
}

function writeDocsExplorerState(state: DocsExplorerState) {
  try {
    localStorage.setItem(docsExplorerStateKey, JSON.stringify(state))
  } catch {
    // Ignore storage failures in private browsing or locked-down contexts.
  }
}

function getDocsExplorer() {
  return document.querySelector<HTMLElement>(".docs-explorer")
}

function readDocsExplorerScrollTop() {
  try {
    const scrollTop = Number.parseFloat(sessionStorage.getItem(docsExplorerScrollKey) ?? "")
    return Number.isFinite(scrollTop) ? scrollTop : undefined
  } catch {
    return undefined
  }
}

function writeDocsExplorerScrollTop(scrollTop: number) {
  try {
    sessionStorage.setItem(docsExplorerScrollKey, String(scrollTop))
  } catch {
    // Ignore storage failures in private browsing or locked-down contexts.
  }
}

function saveDocsExplorerScroll() {
  const explorer = getDocsExplorer()
  if (!explorer) return

  writeDocsExplorerScrollTop(explorer.scrollTop)
}

function restoreDocsExplorerScroll() {
  const explorer = getDocsExplorer()
  const scrollTop = readDocsExplorerScrollTop()
  if (!explorer || scrollTop === undefined) return

  requestAnimationFrame(() => {
    explorer.scrollTop = scrollTop
  })
}

function docsNavSectionKey(control: HTMLElement) {
  return (
    control.getAttribute("aria-controls") ?? control.dataset.controls ?? control.dataset.title ?? ""
  )
}

function docsNavSectionToggle(control: HTMLElement) {
  const section = control.closest(".docs-nav-section")
  return section?.querySelector<HTMLButtonElement>(".docs-nav-section-toggle")
}

function setDocsNavSectionState(control: HTMLElement, expanded: boolean) {
  const controls = control.getAttribute("aria-controls") ?? control.dataset.controls
  const content = controls ? document.getElementById(controls) : undefined
  const title = control.dataset.title ?? "section"
  const section = control.closest(".docs-nav-section")
  const toggle = docsNavSectionToggle(control)
  const action = section?.querySelector<HTMLButtonElement>(".docs-nav-section-action")

  toggle?.setAttribute("aria-expanded", expanded ? "true" : "false")
  toggle?.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${title}`)
  action?.setAttribute("aria-expanded", expanded ? "true" : "false")
  action?.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${title}`)
  content?.toggleAttribute("hidden", !expanded)
  section?.classList.toggle("expanded", expanded)
  section?.classList.toggle("collapsed", !expanded)
}

function persistDocsNavSectionState(control: HTMLElement, expanded: boolean) {
  const key = docsNavSectionKey(control)
  if (!key) return

  const state = readDocsExplorerState()
  state[key] = expanded
  writeDocsExplorerState(state)
}

function expandDocsNavSection(this: HTMLElement, event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }

  setDocsNavSectionState(this, true)
  persistDocsNavSectionState(this, true)
}

function toggleDocsNavSection(this: HTMLButtonElement) {
  const expanded = this.getAttribute("aria-expanded") !== "true"
  setDocsNavSectionState(this, expanded)
  persistDocsNavSectionState(this, expanded)
}

function setupDocsExplorer() {
  const state = readDocsExplorerState()

  for (const toggle of document.querySelectorAll<HTMLButtonElement>(".docs-nav-section-toggle")) {
    const key = docsNavSectionKey(toggle)
    if (key && state[key] !== undefined) {
      setDocsNavSectionState(toggle, state[key])
    }

    toggle.addEventListener("click", toggleDocsNavSection)
    window.addCleanup(() => toggle.removeEventListener("click", toggleDocsNavSection))
  }

  for (const anchor of document.querySelectorAll<HTMLElement>(
    ".docs-nav-section-anchor[data-controls]",
  )) {
    anchor.addEventListener("click", expandDocsNavSection)
    window.addCleanup(() => anchor.removeEventListener("click", expandDocsNavSection))
  }

  for (const action of document.querySelectorAll<HTMLButtonElement>(".docs-nav-section-action")) {
    action.addEventListener("click", toggleDocsNavSection)
    window.addCleanup(() => action.removeEventListener("click", toggleDocsNavSection))
  }

  const explorer = getDocsExplorer()
  if (explorer) {
    explorer.addEventListener("scroll", saveDocsExplorerScroll, { passive: true })
    window.addCleanup(() => explorer.removeEventListener("scroll", saveDocsExplorerScroll))
  }

  restoreDocsExplorerScroll()
}

document.addEventListener("prenav", saveDocsExplorerScroll)
document.addEventListener("nav", setupDocsExplorer)
