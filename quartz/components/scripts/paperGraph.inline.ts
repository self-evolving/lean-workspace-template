// Keep the community graph renderer, but provide its d3/Pixi globals from the
// build bundle and add the small paper-node restyling hook this template needs.
// @ts-expect-error d3 does not publish types, but the runtime module bundles correctly.
import * as d3 from "d3"
import * as PIXI from "pixi.js"
import { getFullSlugFromUrl, simplifySlug } from "@quartz-community/utils"

type GraphDetails = {
  tags?: string[]
}

declare const fetchData: Promise<Record<string, GraphDetails>>

const browserGlobal = globalThis as typeof globalThis & {
  d3?: typeof d3
  PIXI?: typeof PIXI
}

const d3CdnSrc = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"
const pixiCdnSrc = "https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.js"
const paperGraphPatchKey = "__sepoPaperGraphPatched"
const graphCircleKey = "__sepoGraphCircle"
const graphStyledKey = "__sepoPaperGraphStyled"
const paperSlugs = new Set<string>()
const pendingGraphLabels: PIXI.Text[] = []

function markBundledScript(src: string) {
  // The community graph script skips its CDN loader when a matching script tag
  // already exists. These inert markers make it use the bundled globals above.
  if (document.querySelector(`script[src="${src}"]`)) return

  const marker = document.createElement("script")
  marker.type = "application/json"
  marker.src = src
  marker.dataset.quartzBundled = "true"
  marker.textContent = "{}"
  document.head.appendChild(marker)
}

function currentSlug() {
  let slug = String(getFullSlugFromUrl())
  const base = document.body?.dataset?.basepath ?? ""
  if (base && slug.startsWith(base.replace(/^\//, ""))) {
    slug = slug.slice(base.replace(/^\//, "").length)
    if (slug.startsWith("/")) slug = slug.slice(1)
  }
  return simplifySlug((slug || "index") as Parameters<typeof simplifySlug>[0])
}

function resolveColor(value: string, fallback: string) {
  if (!value) return fallback

  const el = document.createElement("div")
  el.style.color = value
  el.style.position = "absolute"
  el.style.visibility = "hidden"
  document.body.appendChild(el)
  const resolved = getComputedStyle(el).color
  el.remove()

  return resolved || fallback
}

function isPaperNode(slug: string, details: GraphDetails) {
  const normalized = simplifySlug(slug)
  const tags = Array.isArray(details.tags) ? details.tags : []
  return normalized.startsWith("papers/") || tags.includes("paper")
}

function shouldHideGraphTags() {
  const containers = document.querySelectorAll<HTMLElement>(
    ".graph-container, .global-graph-container",
  )

  for (const container of containers) {
    try {
      const cfg = JSON.parse(container.dataset.cfg ?? "{}")
      if (cfg.showTags === false) return true
    } catch {
      // Ignore invalid config and leave the upstream graph data untouched.
    }
  }

  return false
}

function prepareGraphData() {
  fetchData.then((data) => {
    for (const [slug, details] of Object.entries(data)) {
      const normalized = simplifySlug(slug)

      if (isPaperNode(normalized, details)) {
        paperSlugs.add(normalized)
      }
    }
  })
}

function hideGraphTagNode(gfx: PIXI.Graphics, label?: PIXI.Text) {
  gfx.visible = false
  gfx.eventMode = "none"

  if (label) {
    label.visible = false
    label.alpha = 0
  }
}

function renderGraphNode(gfx: unknown) {
  const patched = gfx as PIXI.Graphics & { label?: unknown }
  const id = patched.label
  if (typeof id !== "string") return

  const label = pendingGraphLabels.shift()
  if (id.startsWith("tags/") && shouldHideGraphTags()) {
    hideGraphTagNode(patched, label)
    return
  }

  restylePaperNode(patched)
}

function restylePaperNode(gfx: unknown) {
  const patched = gfx as PIXI.Graphics & {
    label?: unknown
    [graphCircleKey]?: { x: number; y: number; radius: number }
    [graphStyledKey]?: boolean
  }
  const id = patched.label
  const circle = patched[graphCircleKey]
  if (typeof id !== "string" || !paperSlugs.has(id) || !circle || patched[graphStyledKey]) return

  const styles = getComputedStyle(document.documentElement)
  const light = resolveColor(styles.getPropertyValue("--light").trim(), "#f5f5f5")
  const tertiary = resolveColor(styles.getPropertyValue("--tertiary").trim(), "#82aaff")
  const secondary = resolveColor(styles.getPropertyValue("--secondary").trim(), "#c792ea")
  const stroke = id === currentSlug() ? secondary : tertiary

  patched.clear()
  patched.circle(circle.x, circle.y, circle.radius)
  patched.fill({ color: light })
  patched.stroke({ width: 2, color: stroke, alpha: 0.9 })
  patched[graphStyledKey] = true
}

function patchPixiForPaperNodes(Pixi: typeof PIXI) {
  const graphicsPrototype = Pixi.Graphics.prototype as PIXI.Graphics & {
    [paperGraphPatchKey]?: boolean
  }
  if (graphicsPrototype[paperGraphPatchKey]) return

  browserGlobal.d3 = browserGlobal.d3 ?? d3
  browserGlobal.PIXI = browserGlobal.PIXI ?? Pixi

  const originalCircle = Pixi.Graphics.prototype.circle
  Pixi.Graphics.prototype.circle = function (
    this: PIXI.Graphics & { [graphCircleKey]?: { x: number; y: number; radius: number } },
    x: number,
    y: number,
    radius: number,
    ...rest: Parameters<typeof originalCircle> extends [number, number, number, ...infer Rest]
      ? Rest
      : unknown[]
  ) {
    this[graphCircleKey] = { x, y, radius }
    return originalCircle.call(this, x, y, radius, ...rest)
  }

  const originalAddChild = Pixi.Container.prototype.addChild
  Pixi.Container.prototype.addChild = function (...children: PIXI.ContainerChild[]) {
    const result = originalAddChild.apply(this, children)
    for (const child of children) {
      if (child instanceof Pixi.Text) {
        pendingGraphLabels.push(child)
      } else {
        renderGraphNode(child)
      }
    }
    return result
  }

  graphicsPrototype[paperGraphPatchKey] = true
}

browserGlobal.d3 = browserGlobal.d3 ?? d3
browserGlobal.PIXI = browserGlobal.PIXI ?? PIXI
markBundledScript(d3CdnSrc)
markBundledScript(pixiCdnSrc)
prepareGraphData()
patchPixiForPaperNodes(browserGlobal.PIXI)
