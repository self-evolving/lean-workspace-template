# Local patches on top of quartz-community/canvas-page @ 2e6d05c

Vendored from the upstream dist (commit pinned previously in `quartz.lock.json`).
All changes live in `dist/index.js` (the bundle Quartz loads). Upstream's `src/`
tree and dev scaffolding were removed (they contained NONE of these patches —
rebuilding from src would silently drop them, and the unpatched TypeScript broke
repo-wide `tsc --noEmit`). For upstream reference, see
https://github.com/quartz-community/canvas-page at commit 2e6d05c.

1. **Blueprint title cards** (`renderNode`, file case): when the target page's
   frontmatter has `blueprint_label` and the node has no `subpath`, render a compact
   card — kind/number line, page title as an internal link (hover popover gives the
   full statement + proof), and a status pill — instead of embedding page HTML.
   New CSS classes: `.canvas-node-card`, `.canvas-card-kind`, `.canvas-card-title`,
   `.canvas-card-status`.

2. **Edge restyle** (`renderEdge`): cubic bezier with side-normal tangents (replaces
   the quadratic S-curve), stroke 1.75 (was 2), default color `var(--gray)` (was
   `--darkgray`), smaller arrowheads (5px markers), and support for a non-spec
   `dashed: true` edge field rendered as `stroke-dasharray: 7 5`. JSON Canvas 1.0 has
   no dash attribute; Obsidian ignores unknown fields, so the .canvas stays portable.

3. **Anchor spreading** (`computeAnchorPlan`, new): edges sharing a node side are
   distributed across the middle 70% of that side (sorted by the opposite endpoint),
   so arrowheads no longer pile up at the side midpoint.

4. **Z-order**: the edges SVG now renders before the nodes layer, so edges pass
   under cards instead of over them.

5. **Hover and click focus** (`renderEdge` + controls button + appended inline
   script + CSS): edge routes carry `data-from`/`data-to` (originally on wrapper
   groups; patch 13 later moved them to the route paths); hovering a file card
   still adds `.canvas-hovering` and `.hover-focus`/`.hover-neighbor`/
   `.hover-edge` when nothing is selected. Clicking canvas nodes toggles a
   multi-selection state that adds `.canvas-selecting` and `.selection-focus`/
   `.selection-neighbor`/`.selection-edge`, dimming everything except selected
   nodes, their direct parents/children, and incident edges. Blank-canvas clicks
   clear the selection; the `.canvas-selection-clear` control appears only while
   one or more nodes are selected as a compact count button that toggles a
   `.canvas-selection-panel` with selected node labels, per-row remove buttons,
   and a clear action. The panel is guarded from canvas pan/zoom interactions.

6. **Legend panel** (`renderLegend`, controls button, inline toggle script, CSS):
   when the canvas JSON carries a top-level `legend` field (fork extension:
   `{title, nodes: [{color,label}], edges: [{dashed,color,label}], note}`), the
   controls stack gains an info button that toggles a fixed panel with concrete
   color swatches (styled like the cards: colored border + tint) and edge samples.
   Dragging on the panel doesn't pan the canvas.

7. **Full-bleed frame**: the site theme styles `.center` as a rounded card
   (border, 16px radius, shadow, 2rem padding, top margin); the frame's
   `.center.canvas-frame` override now also resets padding/border/radius/shadow/
   background so the canvas reaches the page edges. `dist/frames/index.js` is
   replaced by a re-export shim (same rationale and mechanism as patch 8 — the
   frame loader imports the subpath bundle, which upstream ships as a duplicate).

8. **components subpath shim**: `dist/components/index.js` (upstream: a full
   duplicate bundle of the component implementation) is replaced by a re-export
   from `../index.js`. The plugin loader registers CanvasBody from this subpath
   (manifest category includes "component"), so without the shim it silently
   overrides the patched implementation with the unpatched duplicate.
   `resolveEmbeddedHtml` was added to `dist/index.js`'s exports to keep the
   subpath's public API intact.

9. **Self-describing cards (blueprint-as-source)**: a file node may carry
   `bpTitle`/`bpKind`/`bpName`/`bpStatus` fields; the card renders from those
   (no page lookup) and its title link appends the node's `subpath`, landing on
   the item's heading anchor inside its chapter page.

10. **Canvas afterBody slot** (`CanvasFrame`): the frame now renders the
    shared `afterBody` components after the canvas stage, so global page
    integrations like the Sepo comments bot emit their config on canvas pages
    too.

11. **Open file cards in a sidebar preview** (`renderNode` + inline script + CSS):
    internal file-card nodes render a small sidebar button next to the page title.
    Clicking it fetches the same-origin page, extracts the rendered article, and
    shows it in a resizable right-side preview panel with close and “Open”
    controls. Hash/subpath links scroll to the target heading in the preview, and
    internal links inside the preview continue loading in-place.

12. **Canvas sidebar UI fixes** (CSS + preview inline script): the hidden left
    sidebar no longer leaks its open-state shadow into the viewport; the sidebar
    title row aligns the close button with the GitHub action, compact blueprint
    card rows reserve space for their action buttons, and preview hash
    highlighting resolves hidden blueprint label anchors to the visible heading
    with an in-place shaded marker.

13. **Compact SVG edge DOM** (`computeMarkerPlan` + `renderEdgeMarkers` +
    `renderEdge`): arrowhead definitions are emitted once per canvas, direction,
    and resolved stroke color instead of once per edge. The visible route path
    now carries the edge class and data attributes directly, eliminating a
    redundant wrapper and noninteractive SVG hit target per edge. Edges retain
    their individual color, dashed style, direction, labels, and focus classes
    while large canvases avoid thousands of duplicate elements.

14. **Indexed and delegated hover focus** (focus inline script): node neighbors
    and incident edges are indexed once during initialization, and two container
    listeners replace per-card enter/leave listeners. Hover updates now touch
    only the previous and next cards' local graph neighborhoods; they no longer
    sweep every node and edge or rebuild the selection panel. Selection still
    wins visually, while the latent hovered card is restored when selection is
    cleared.

15. **Shared card action icon** (`renderSidebarButton` + CSS): the accessible
    sidebar-preview button is now empty and draws its decorative icon from one
    CSS mask. This removes an identical inline SVG, rectangle, and two paths from
    every file card without changing its label, hit target, color, or click
    behavior.

16. **Frame-coalesced canvas interactions** (base inline script): drag, wheel,
    and pinch events still update pan/zoom state synchronously, but commit the
    latest viewport transform and reset-control state at most once per animation
    frame. Identical transform/display writes are skipped; wheel geometry is read
    once per frame (and invalidated immediately by sidebar/fullscreen geometry
    changes), pinch geometry once per gesture (refreshed after touch-count changes
    or cancellation), and all queued render/layout frames are canceled during
    Quartz navigation cleanup. Initial fitting and discrete controls remain
    synchronous.
