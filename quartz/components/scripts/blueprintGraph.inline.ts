type BlueprintGraphNode = {
  id: string
  pageSlug: string
  anchor: string
  href: string
  title: string
  kind: string
  name: string
  status: string
}

type BlueprintGraphEdge = {
  from: string
  to: string
  kind: "statement" | "proof"
}

type BlueprintGraphData = {
  nodes: BlueprintGraphNode[]
  edges: BlueprintGraphEdge[]
  currentPageNodeIds: string[]
}

function decodeHash() {
  const raw = window.location.hash.replace(/^#/, "")
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function parseGraphData(panel: HTMLElement): BlueprintGraphData | null {
  const script = panel.querySelector<HTMLScriptElement>("script.bp-graph-data")
  if (!script?.textContent) return null
  try {
    const parsed = JSON.parse(script.textContent) as BlueprintGraphData
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null
    return parsed
  } catch {
    return null
  }
}

function findHashNode(data: BlueprintGraphData) {
  const hash = decodeHash()
  if (!hash) return null
  return data.nodes.find((node) => node.anchor === hash || node.id === hash)?.id ?? null
}

function linkForNode(node: BlueprintGraphNode, edge?: BlueprintGraphEdge) {
  const item = document.createElement("li")
  const link = document.createElement("a")
  link.href = node.href
  link.textContent = node.title
  item.appendChild(link)

  if (edge) {
    const badge = document.createElement("span")
    badge.className = `bp-graph-edge-kind bp-graph-edge-kind-${edge.kind}`
    badge.textContent = edge.kind
    item.appendChild(badge)
  }

  return item
}

function renderRelationList(
  container: HTMLElement | null,
  title: string,
  entries: { node: BlueprintGraphNode; edge?: BlueprintGraphEdge }[],
  emptyText: string,
) {
  if (!container) return
  container.replaceChildren()

  const heading = document.createElement("h4")
  heading.textContent = title
  container.appendChild(heading)

  if (entries.length === 0) {
    const empty = document.createElement("p")
    empty.textContent = emptyText
    container.appendChild(empty)
    return
  }

  const list = document.createElement("ul")
  for (const entry of entries) {
    list.appendChild(linkForNode(entry.node, entry.edge))
  }
  container.appendChild(list)
}

function setupBlueprintGraph(panel: HTMLElement) {
  if (panel.dataset.blueprintGraphHydrated === "true") return
  const data = parseGraphData(panel)
  if (!data) return

  panel.dataset.blueprintGraphHydrated = "true"
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]))
  const nodeElements = new Map(
    [...panel.querySelectorAll<SVGElement>(".bp-graph-node[data-node-id]")].flatMap((node) => {
      const id = node.dataset.nodeId
      return id ? [[id, node] as const] : []
    }),
  )
  const edgeElements = [
    ...panel.querySelectorAll<SVGElement>(".bp-graph-edge[data-edge-from][data-edge-to]"),
  ]
  const selection = panel.querySelector<HTMLElement>(".bp-graph-selection")
  const usesContainer = panel.querySelector<HTMLElement>(".bp-graph-uses")
  const usedByContainer = panel.querySelector<HTMLElement>(".bp-graph-used-by")
  const pageNodeSet = new Set(data.currentPageNodeIds)
  const headingAnchors = data.nodes
    .map((node) => node.anchor)
    .filter((anchor): anchor is string => Boolean(anchor))
  let scrollActiveId: string | null = null
  let frame = 0

  const pageNodes = data.nodes.filter((node) => pageNodeSet.has(node.id)).map((node) => ({ node }))
  const nearbyNodes = data.nodes
    .filter((node) => !pageNodeSet.has(node.id))
    .map((node) => ({ node }))

  const update = () => {
    const activeId = findHashNode(data) ?? scrollActiveId
    const activeNode = activeId ? nodeById.get(activeId) : null
    const activeEdgeKeys = new Set<string>()
    const relatedNodeIds = new Set<string>()

    if (activeNode) {
      relatedNodeIds.add(activeNode.id)
      for (const edge of data.edges) {
        if (edge.from === activeNode.id || edge.to === activeNode.id) {
          activeEdgeKeys.add(`${edge.from}\u0000${edge.to}`)
          relatedNodeIds.add(edge.from)
          relatedNodeIds.add(edge.to)
        }
      }
    }

    panel.classList.toggle("has-active", Boolean(activeNode))
    if (selection) {
      selection.textContent = activeNode ? activeNode.title : "Chapter graph"
    }

    for (const [id, element] of nodeElements) {
      const isActive = id === activeNode?.id
      const isNeighbor = Boolean(activeNode && !isActive && relatedNodeIds.has(id))
      const isDimmed = Boolean(activeNode && !relatedNodeIds.has(id))
      element.classList.toggle("is-active", isActive)
      element.classList.toggle("is-neighbor", isNeighbor)
      element.classList.toggle("is-dimmed", isDimmed)
    }

    for (const element of edgeElements) {
      const from = element.dataset.edgeFrom ?? ""
      const to = element.dataset.edgeTo ?? ""
      const isActive = activeEdgeKeys.has(`${from}\u0000${to}`)
      element.classList.toggle("is-active", isActive)
      element.classList.toggle("is-dimmed", Boolean(activeNode && !isActive))
    }

    if (!activeNode) {
      renderRelationList(usesContainer, "This page", pageNodes, "No item headings on this page.")
      renderRelationList(usedByContainer, "Nearby", nearbyNodes, "No external neighbors.")
      return
    }

    const uses = data.edges
      .filter((edge) => edge.to === activeNode.id)
      .flatMap((edge) => {
        const node = nodeById.get(edge.from)
        return node ? [{ node, edge }] : []
      })
    const usedBy = data.edges
      .filter((edge) => edge.from === activeNode.id)
      .flatMap((edge) => {
        const node = nodeById.get(edge.to)
        return node ? [{ node, edge }] : []
      })

    renderRelationList(usesContainer, "Uses", uses, "No direct dependencies.")
    renderRelationList(usedByContainer, "Used by", usedBy, "No direct dependents.")
  }

  const updateFromScroll = () => {
    frame = 0
    if (findHashNode(data)) {
      scrollActiveId = null
      update()
      return
    }

    let bestAnchor: string | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const anchor of headingAnchors) {
      const heading = document.getElementById(anchor)
      if (!heading) continue
      const rect = heading.getBoundingClientRect()
      const distance = Math.abs(rect.top - 140)
      if (rect.top < window.innerHeight * 0.75 && distance < bestDistance) {
        bestAnchor = anchor
        bestDistance = distance
      }
    }

    scrollActiveId = bestAnchor
      ? (data.nodes.find((node) => node.anchor === bestAnchor)?.id ?? null)
      : null
    update()
  }

  const scheduleScrollUpdate = () => {
    if (frame) return
    frame = window.requestAnimationFrame(updateFromScroll)
  }

  const onHashChange = () => update()
  window.addEventListener("hashchange", onHashChange)
  window.addEventListener("scroll", scheduleScrollUpdate, { passive: true })
  window.addEventListener("resize", scheduleScrollUpdate)
  window.addCleanup(() => {
    window.removeEventListener("hashchange", onHashChange)
    window.removeEventListener("scroll", scheduleScrollUpdate)
    window.removeEventListener("resize", scheduleScrollUpdate)
    if (frame) window.cancelAnimationFrame(frame)
  })

  updateFromScroll()
}

function setupBlueprintGraphs() {
  document.querySelectorAll<HTMLElement>(".bp-graph[data-blueprint-graph]").forEach((panel) => {
    setupBlueprintGraph(panel)
  })
}

document.addEventListener("nav", setupBlueprintGraphs)
