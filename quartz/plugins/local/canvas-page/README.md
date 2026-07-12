# @quartz-community/canvas-page

A page type plugin that renders [JSON Canvas](https://jsoncanvas.org) (`.canvas`) files as interactive, pannable and zoomable canvas pages. Supports the full JSON Canvas 1.0 spec, including text nodes with Markdown rendering, file nodes that link to other pages, link nodes for external URLs, group nodes for visual organization, and edges between nodes rendered as SVG paths with optional labels, arrow markers, and colors.

## Installation

```bash
npx quartz plugin add github:quartz-community/canvas-page
```

## Usage

```yaml title="quartz.config.yaml"
plugins:
  - source: github:quartz-community/canvas-page
    enabled: true
```

For advanced use cases, you can override in TypeScript:

```ts title="quartz.ts (override)"
import * as ExternalPlugin from "./.quartz/plugins";

ExternalPlugin.CanvasPage({
  enableInteraction: true,
  defaultFullscreen: false,
});
```

## Features

- **Text nodes**: Render Markdown content including headings, bold, italic, strikethrough, lists, links, and code blocks via GFM support.
- **File nodes**: Link to other pages in your vault with popover previews on hover.
- **Link nodes**: Reference external URLs.
- **Group nodes**: Visual grouping containers with optional labels and background colors.
- **Edges**: SVG connections between nodes with optional labels, arrow markers, and colors. Supports all four sides and both preset colors (1–6) and custom hex colors.
- **Fullscreen mode**: Toggle button to expand the canvas to fill the viewport. Configurable default via `defaultFullscreen`.
- **Preset colors**: Six preset colors (red, orange, yellow, green, cyan, purple) plus custom hex colors for nodes and edges.

## Configuration

| Option              | Type      | Default | Description                                                |
| ------------------- | --------- | ------- | ---------------------------------------------------------- |
| `enableInteraction` | `boolean` | `true`  | Whether to enable pan and zoom interaction on the canvas.  |
| `initialZoom`       | `number`  | `1`     | The initial zoom level when the canvas is first displayed. |
| `minZoom`           | `number`  | `0.1`   | The minimum zoom level allowed when zooming out.           |
| `maxZoom`           | `number`  | `5`     | The maximum zoom level allowed when zooming in.            |
| `defaultFullscreen` | `boolean` | `false` | Whether canvas pages default to fullscreen mode.           |

## Documentation

See the [Quartz documentation](https://quartz.jzhao.xyz/plugins/CanvasPage) for more information.

## License

MIT
