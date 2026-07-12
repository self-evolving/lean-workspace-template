import fs from "fs"
import path from "path"
import { classNames } from "../util/lang"
import { FullSlug, resolveRelative } from "../util/path"

type CanvasNode = {
  id?: unknown
  file?: unknown
  subpath?: unknown
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  color?: unknown
  bpTitle?: unknown
  bpKind?: unknown
  bpName?: unknown
  bpStatus?: unknown
}

type CanvasEdge = {
  id?: unknown
  fromNode?: unknown
  toNode?: unknown
  dashed?: unknown
  color?: unknown
}

type BlueprintGraphNode = {
  id: string
  pageSlug: string
  anchor: string
  href: string
  title: string
  kind: string
  name: string
  status: string
  color?: string
  x: number
  y: number
  width: number
  height: number
}

type BlueprintGraphEdge = {
  id: string
  from: string
  to: string
  kind: "statement" | "proof"
}

type BlueprintGraphView = {
  root: string
  currentSlug: string
  title: string
  canvasHref: string
  viewBox: string
  nodes: BlueprintGraphNode[]
  edges: BlueprintGraphEdge[]
  currentPageNodeIds: string[]
}

type BlueprintGraphProps = {
  displayClass?: "mobile-only" | "desktop-only"
  graph: BlueprintGraphView
}

const numberOr = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const textOr = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback

const canvasFileSlug = (file: unknown) =>
  textOr(file)
    .replace(/\\/g, "/")
    .replace(/^content\//, "")
    .replace(/\.(md|lean)$/i, "")
    .replace(/\/index$/, "")

const normalizeAnchor = (subpath: unknown) => textOr(subpath).replace(/^#/, "")

const relativeItemHref = (currentSlug: string, pageSlug: string, anchor: string) => {
  if (!anchor) return resolveRelative(currentSlug as FullSlug, pageSlug as FullSlug)
  if (currentSlug === pageSlug) return `#${anchor}`
  return `${resolveRelative(currentSlug as FullSlug, pageSlug as FullSlug)}#${anchor}`
}

const truncate = (value: string, max = 28) =>
  value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value

function loadBlueprintRoots(repoRoot: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "blueprint.config.json"), "utf8")
    const parsed = JSON.parse(raw) as { blueprints?: Array<{ root?: unknown }> }
    const roots = (Array.isArray(parsed.blueprints) ? parsed.blueprints : [])
      .map((entry: { root?: unknown }) =>
        typeof entry.root === "string" ? entry.root.replace(/^\/+|\/+$/g, "") : null,
      )
      .filter((root): root is string => Boolean(root))
    return roots.length > 0 ? roots : ["blueprint"]
  } catch {
    return ["blueprint"]
  }
}

function activeBlueprintRoot(slug: string, roots: string[]): string | undefined {
  return roots.find((root) => slug === root || slug.startsWith(`${root}/`))
}

function readCanvasGraph(contentDir: string, root: string) {
  const canvasPath = path.join(contentDir, root, "dep-graph.canvas")
  try {
    return JSON.parse(fs.readFileSync(canvasPath, "utf8")) as {
      nodes?: CanvasNode[]
      edges?: CanvasEdge[]
    }
  } catch {
    return null
  }
}

function clusterValues(values: number[], threshold: number) {
  const clusters: number[] = []
  for (const value of [...values].sort((a, b) => a - b)) {
    const last = clusters.at(-1)
    if (last === undefined || value - last > threshold) clusters.push(value)
  }
  return clusters
}

function nearestCluster(value: number, clusters: number[]) {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  clusters.forEach((cluster, index) => {
    const distance = Math.abs(value - cluster)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

function compactGraphNodes(nodes: BlueprintGraphNode[]): BlueprintGraphNode[] {
  const xClusters = clusterValues(
    nodes.map((node) => node.x),
    130,
  )
  const yClusters = clusterValues(
    nodes.map((node) => node.y),
    72,
  )
  const width = 148
  const height = 60
  const columnGap = 34
  const rowGap = 38

  return nodes.map((node) => ({
    ...node,
    x: nearestCluster(node.x, xClusters) * (width + columnGap),
    y: nearestCluster(node.y, yClusters) * (height + rowGap),
    width,
    height,
  }))
}

export function buildBlueprintGraphView(
  contentDir: string,
  slug: string,
): BlueprintGraphView | null {
  const repoRoot = path.resolve(contentDir, "..")
  const root = activeBlueprintRoot(slug, loadBlueprintRoots(repoRoot))
  if (!root) return null

  const canvas = readCanvasGraph(contentDir, root)
  if (!canvas || !Array.isArray(canvas.nodes)) return null

  const allNodes = canvas.nodes.flatMap((node): BlueprintGraphNode[] => {
    const id = textOr(node.id)
    const pageSlug = canvasFileSlug(node.file)
    if (!id || !pageSlug) return []

    const anchor = normalizeAnchor(node.subpath)
    const kind = textOr(node.bpKind, id)
    const name = textOr(node.bpName, textOr(node.bpTitle, id))
    const title = textOr(node.bpTitle, [kind, name].filter(Boolean).join(" · ") || id)
    const status = textOr(node.bpStatus, "status unknown")
    const color = textOr(node.color) || undefined
    const width = numberOr(node.width, 150)
    const height = numberOr(node.height, 64)

    return [
      {
        id,
        pageSlug,
        anchor,
        href: relativeItemHref(slug, pageSlug, anchor),
        title,
        kind,
        name,
        status,
        color,
        x: numberOr(node.x, 0),
        y: numberOr(node.y, 0),
        width,
        height,
      },
    ]
  })
  if (allNodes.length === 0) return null

  const nodeById = new Map(allNodes.map((node) => [node.id, node]))
  const allEdges = (Array.isArray(canvas.edges) ? canvas.edges : []).flatMap(
    (edge, index): BlueprintGraphEdge[] => {
      const from = textOr(edge.fromNode)
      const to = textOr(edge.toNode)
      if (!from || !to || !nodeById.has(from) || !nodeById.has(to)) return []
      return [
        {
          id: textOr(edge.id, `e${index}`),
          from,
          to,
          kind: edge.dashed ? "statement" : "proof",
        },
      ]
    },
  )

  const currentPageNodeIds = allNodes
    .filter((node) => node.pageSlug === slug)
    .map((node) => node.id)
  const currentPageNodeSet = new Set(currentPageNodeIds)
  const visibleNodeIds = new Set(currentPageNodeIds)

  if (slug === root || slug === `${root}/dep-graph.canvas` || currentPageNodeIds.length === 0) {
    for (const node of allNodes) visibleNodeIds.add(node.id)
  } else {
    for (const edge of allEdges) {
      if (currentPageNodeSet.has(edge.from)) visibleNodeIds.add(edge.to)
      if (currentPageNodeSet.has(edge.to)) visibleNodeIds.add(edge.from)
    }
  }

  const visibleNodes = allNodes.filter((node) => visibleNodeIds.has(node.id))
  const edges = allEdges.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  )
  if (visibleNodes.length === 0) return null

  const nodes = compactGraphNodes(visibleNodes)
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  const padding = 32
  const viewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`
  const title = "Blueprint graph"
  const canvasHref = relativeItemHref(slug, `${root}/dep-graph.canvas`, "")

  return {
    root,
    currentSlug: slug,
    title,
    canvasHref,
    viewBox,
    nodes,
    edges,
    currentPageNodeIds,
  }
}

const edgePath = (edge: BlueprintGraphEdge, nodeById: Map<string, BlueprintGraphNode>) => {
  const from = nodeById.get(edge.from)
  const to = nodeById.get(edge.to)
  if (!from || !to) return ""
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height / 2
  const x2 = to.x + to.width / 2
  const y2 = to.y + to.height / 2
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
}

export const BlueprintGraph = ({ displayClass, graph }: BlueprintGraphProps) => {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const dataJson = JSON.stringify(graph).replace(/</g, "\\u003c")
  const pageNodes = graph.nodes.filter((node) => graph.currentPageNodeIds.includes(node.id))
  const nearbyNodes = graph.nodes.filter((node) => !graph.currentPageNodeIds.includes(node.id))
  const markerId = `bp-graph-arrow-${graph.currentSlug.replace(/[^A-Za-z0-9_-]/g, "-")}`

  return (
    <div class={classNames(displayClass, "graph", "bp-graph")} data-blueprint-graph="true">
      <div class="graph-header bp-graph-header">
        <h3>{graph.title}</h3>
        <a
          class="bp-graph-canvas-link"
          href={graph.canvasHref}
          title="Open the full dependency canvas"
        >
          Canvas ↗
        </a>
      </div>
      <div class="bp-graph-outer">
        <svg
          class="bp-graph-svg"
          viewBox={graph.viewBox}
          role="img"
          aria-label="Blueprint item dependency graph"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" class="bp-graph-arrow" />
            </marker>
          </defs>
          <g class="bp-graph-edges">
            {graph.edges.map((edge) => (
              <path
                class={`bp-graph-edge bp-graph-edge-${edge.kind}`}
                data-edge-from={edge.from}
                data-edge-to={edge.to}
                data-edge-kind={edge.kind}
                d={edgePath(edge, nodeById)}
                marker-end={`url(#${markerId})`}
              />
            ))}
          </g>
          <g class="bp-graph-nodes">
            {graph.nodes.map((node) => (
              <a
                href={node.href}
                class="bp-graph-node"
                data-node-id={node.id}
                data-node-anchor={node.anchor}
                data-node-page={node.pageSlug}
                aria-label={`${node.title}: ${node.status}`}
              >
                <title>{`${node.title} — ${node.status}`}</title>
                <rect
                  class="bp-graph-node-card"
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx="9"
                  fill={node.color ?? "var(--lightgray)"}
                  stroke={node.color ?? "var(--gray)"}
                />
                <text
                  class="bp-graph-node-kind"
                  x={node.x + node.width / 2}
                  y={node.y + 25}
                  text-anchor="middle"
                >
                  {truncate(node.kind, 24)}
                </text>
                <text
                  class="bp-graph-node-name"
                  x={node.x + node.width / 2}
                  y={node.y + 44}
                  text-anchor="middle"
                >
                  {truncate(node.name, 27)}
                </text>
              </a>
            ))}
          </g>
        </svg>
      </div>
      <div class="bp-graph-meta">
        <div class="bp-graph-selection">Chapter graph</div>
        <div class="bp-graph-legend" aria-label="Blueprint graph legend">
          <span>
            <span class="bp-graph-line-sample bp-graph-line-statement"></span>statement
          </span>
          <span>
            <span class="bp-graph-line-sample bp-graph-line-proof"></span>proof
          </span>
        </div>
      </div>
      <div class="bp-graph-relations" aria-live="polite">
        <div class="bp-graph-relation bp-graph-uses">
          <h4>This page</h4>
          {pageNodes.length > 0 ? (
            <ul>
              {pageNodes.map((node) => (
                <li>
                  <a href={node.href}>{node.title}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No item headings on this page.</p>
          )}
        </div>
        <div class="bp-graph-relation bp-graph-used-by">
          <h4>Nearby</h4>
          {nearbyNodes.length > 0 ? (
            <ul>
              {nearbyNodes.map((node) => (
                <li>
                  <a href={node.href}>{node.title}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No external neighbors.</p>
          )}
        </div>
      </div>
      <script
        type="application/json"
        class="bp-graph-data"
        dangerouslySetInnerHTML={{ __html: dataJson }}
      />
    </div>
  )
}
