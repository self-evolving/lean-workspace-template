export type PopoverTarget = {
  cacheKey: string
  fetchUrl: URL
  hash: string
  id: string
  isCanvasLink: boolean
  targetUrl: URL
}

export const popoverTriggerSelector = "a.internal, [data-popover-href]"

export function decodeHash(hash: string) {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

export function popoverIdFor(cacheKey: string) {
  return `popover-${encodeURIComponent(cacheKey)}`
}

export function popoverHrefFor(trigger: HTMLElement): string {
  if (trigger instanceof HTMLAnchorElement) return trigger.href
  return trigger.dataset.popoverHref ?? ""
}

export function buildPopoverTarget(trigger: HTMLElement, baseHref: string): PopoverTarget {
  const targetUrl = new URL(popoverHrefFor(trigger), baseHref)
  const fetchUrl = new URL(targetUrl)
  const hash = decodeHash(targetUrl.hash)
  fetchUrl.hash = ""
  fetchUrl.search = ""

  const cacheKey = fetchUrl.toString()
  return {
    cacheKey,
    fetchUrl,
    hash,
    id: popoverIdFor(cacheKey),
    isCanvasLink: trigger.closest(".canvas-page, .canvas-container") !== null,
    targetUrl,
  }
}

export function shouldSkipPopoverTrigger(trigger: HTMLElement) {
  return trigger.dataset.noPopover === "true" || popoverHrefFor(trigger) === ""
}

function directChildWithClass(parent: HTMLElement, className: string): HTMLElement | null {
  for (const child of parent.children) {
    if (child instanceof HTMLElement && child.classList.contains(className)) return child
  }

  return null
}

export function syncCanvasPopoverAction(
  popoverElement: HTMLElement,
  target: Pick<PopoverTarget, "isCanvasLink" | "targetUrl">,
) {
  let actionBar = directChildWithClass(popoverElement, "popover-canvas-actions")
  if (!target.isCanvasLink) {
    actionBar?.remove()
    return
  }

  if (!actionBar) {
    actionBar = popoverElement.ownerDocument.createElement("div")
    actionBar.className = "popover-canvas-actions"
    popoverElement.appendChild(actionBar)
  }

  let link = actionBar.querySelector("a.popover-open-page") as HTMLAnchorElement | null
  if (!link) {
    link = popoverElement.ownerDocument.createElement("a")
    link.className = "popover-open-page"
    link.dataset.noPopover = "true"
    link.textContent = "Open page"
    link.title = "Open page"
    link.setAttribute("aria-label", "Open page")
    actionBar.appendChild(link)
  }

  link.href = target.targetUrl.toString()
}

export function bindPopoverTriggers(
  root: Pick<ParentNode, "querySelectorAll">,
  mouseEnterHandler: (this: HTMLElement, event: MouseEvent) => void,
  mouseLeaveHandler: (event: MouseEvent) => void,
  addCleanup: (cleanup: () => void) => void,
) {
  const links = [...root.querySelectorAll<HTMLElement>(popoverTriggerSelector)]
  for (const link of links) {
    if (link.dataset.popoverBound === "true") continue
    link.dataset.popoverBound = "true"
    link.addEventListener("mouseenter", mouseEnterHandler)
    link.addEventListener("mouseleave", mouseLeaveHandler)
    addCleanup(() => {
      link.removeEventListener("mouseenter", mouseEnterHandler)
      link.removeEventListener("mouseleave", mouseLeaveHandler)
      delete link.dataset.popoverBound
    })
  }
}
