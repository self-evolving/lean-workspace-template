import { computePosition, flip, inline, shift } from "@floating-ui/dom"
import { normalizeRelativeURLs } from "../../util/path"
import { fetchCanonical } from "./util"

const p = new DOMParser()
let activeAnchor: HTMLAnchorElement | null = null
let activeTargetKey: string | null = null
let activeRequestId = 0

type PopoverTarget = {
  cacheKey: string
  fetchUrl: URL
  hash: string
  id: string
  isCanvasLink: boolean
}

function decodeHash(hash: string) {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

function popoverIdFor(cacheKey: string) {
  return `popover-${encodeURIComponent(cacheKey)}`
}

function getPopoverTarget(link: HTMLAnchorElement): PopoverTarget {
  const targetUrl = new URL(link.href)
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
    isCanvasLink: link.closest(".canvas-page, .canvas-container") !== null,
  }
}

function deactivatePopovers() {
  const allPopoverElements = document.querySelectorAll(".popover")
  allPopoverElements.forEach((popoverElement) => popoverElement.classList.remove("active-popover"))
}

function scrollPopoverToHash(popoverElement: HTMLElement, hash: string) {
  if (hash === "") return

  const popoverInner = popoverElement.querySelector(".popover-inner") as HTMLElement | null
  if (!popoverInner) return

  const targetAnchor = `#popover-internal-${hash.slice(1)}`
  const heading = popoverInner.querySelector(targetAnchor) as HTMLElement | null
  if (heading) {
    // leave ~12px of buffer when scrolling to a heading
    popoverInner.scroll({ top: heading.offsetTop - 12, behavior: "instant" })
  }
}

async function mouseEnterHandler(this: HTMLAnchorElement, { clientX, clientY }: MouseEvent) {
  const link = this
  if (link.dataset.noPopover === "true") {
    clearActivePopover()
    return
  }

  const target = getPopoverTarget(link)
  activeAnchor = link
  activeTargetKey = target.cacheKey
  const requestId = ++activeRequestId
  const isCurrentHover = () =>
    activeAnchor === link && activeTargetKey === target.cacheKey && requestId === activeRequestId

  async function setPosition(popoverElement: HTMLElement) {
    const { x, y } = await computePosition(link, popoverElement, {
      strategy: "fixed",
      middleware: [inline({ x: clientX, y: clientY }), shift(), flip()],
    })
    if (!isCurrentHover()) return

    Object.assign(popoverElement.style, {
      transform: `translate(${x.toFixed()}px, ${y.toFixed()}px)`,
    })
  }

  function showPopover(popoverElement: HTMLElement) {
    if (!isCurrentHover()) return

    deactivatePopovers()
    popoverElement.classList.toggle("canvas-popover", target.isCanvasLink)
    popoverElement.classList.add("active-popover")
    setPosition(popoverElement as HTMLElement)
    scrollPopoverToHash(popoverElement, target.hash)
  }

  const prevPopoverElement = document.getElementById(target.id)

  // dont refetch if there's already a popover
  if (prevPopoverElement?.dataset.targetUrl === target.cacheKey) {
    showPopover(prevPopoverElement as HTMLElement)
    return
  }

  const response = await fetchCanonical(target.fetchUrl).catch((err) => {
    console.error(err)
  })

  if (!isCurrentHover()) return
  if (!response) return
  const [contentType] = (response.headers.get("Content-Type") ?? "").split(";")
  const [contentTypeCategory, typeInfo] = contentType.split("/")

  const popoverElement = document.createElement("div")
  popoverElement.id = target.id
  popoverElement.dataset.targetUrl = target.cacheKey
  popoverElement.classList.add("popover")
  const popoverInner = document.createElement("div")
  popoverInner.classList.add("popover-inner")
  popoverInner.dataset.contentType = contentType ?? undefined
  popoverElement.appendChild(popoverInner)

  switch (contentTypeCategory) {
    case "image":
      const img = document.createElement("img")
      img.src = target.fetchUrl.toString()
      img.alt = target.fetchUrl.pathname

      popoverInner.appendChild(img)
      break
    case "application":
      switch (typeInfo) {
        case "pdf":
          const pdf = document.createElement("iframe")
          pdf.src = target.fetchUrl.toString()
          popoverInner.appendChild(pdf)
          break
        default:
          break
      }
      break
    default:
      const contents = await response.text()
      if (!isCurrentHover()) return

      const html = p.parseFromString(contents, "text/html")
      normalizeRelativeURLs(html, target.fetchUrl)
      // prepend all IDs inside popovers to prevent duplicates
      html.querySelectorAll("[id]").forEach((el) => {
        const targetID = `popover-internal-${el.id}`
        el.id = targetID
      })
      const elts = [...html.getElementsByClassName("popover-hint")].filter(
        (elt) => elt.children.length > 0 || (elt.textContent?.trim().length ?? 0) > 0,
      )
      if (elts.length === 0) return

      elts.forEach((elt) => popoverInner.appendChild(elt))
  }

  if (!isCurrentHover()) return
  if (document.getElementById(target.id)?.dataset.targetUrl === target.cacheKey) {
    return
  }

  document.body.appendChild(popoverElement)
  showPopover(popoverElement)
}

function clearActivePopover() {
  activeAnchor = null
  activeTargetKey = null
  activeRequestId++
  deactivatePopovers()
}

function setupPopovers() {
  const links = [...document.querySelectorAll("a.internal")] as HTMLAnchorElement[]
  for (const link of links) {
    if (link.dataset.popoverBound === "true") continue
    link.dataset.popoverBound = "true"
    link.addEventListener("mouseenter", mouseEnterHandler)
    link.addEventListener("mouseleave", clearActivePopover)
    window.addCleanup(() => {
      link.removeEventListener("mouseenter", mouseEnterHandler)
      link.removeEventListener("mouseleave", clearActivePopover)
      delete link.dataset.popoverBound
    })
  }
}

document.addEventListener("nav", setupPopovers)
document.addEventListener("render", setupPopovers)
