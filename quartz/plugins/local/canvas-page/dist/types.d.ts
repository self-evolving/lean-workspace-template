export { BuildCtx, FilePath, FullSlug, GlobalConfiguration, PageGenerator, PageMatcher, ProcessedContent, QuartzComponent, QuartzComponentConstructor, QuartzComponentProps, QuartzPageTypePlugin, QuartzPageTypePluginInstance, QuartzPluginData, VirtualPage } from '@quartz-community/types';

/**
 * Preset color values (1-6) or hex color strings (#RRGGBB).
 * Presets: 1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple
 */
type CanvasColor = "1" | "2" | "3" | "4" | "5" | "6" | `#${string}`;
/** Side of a node where an edge connects */
type CanvasSide = "top" | "right" | "bottom" | "left";
/** End shape of an edge endpoint */
type CanvasEnd = "none" | "arrow";
/** Background style for group nodes */
type CanvasBackgroundStyle = "cover" | "ratio" | "repeat";
/** Common properties shared by all node types */
interface CanvasNodeBase {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: CanvasColor;
}
/** Text node — contains Markdown text */
interface CanvasTextNode extends CanvasNodeBase {
    type: "text";
    text: string;
}
/** File node — references a file in the vault */
interface CanvasFileNode extends CanvasNodeBase {
    type: "file";
    file: string;
    subpath?: string;
}
/** Link node — references an external URL */
interface CanvasLinkNode extends CanvasNodeBase {
    type: "link";
    url: string;
}
/** Group node — visual grouping container */
interface CanvasGroupNode extends CanvasNodeBase {
    type: "group";
    label?: string;
    background?: string;
    backgroundStyle?: CanvasBackgroundStyle;
}
/** Union of all node types */
type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;
/** A connection between two nodes */
interface CanvasEdge {
    id: string;
    fromNode: string;
    fromSide?: CanvasSide;
    fromEnd?: CanvasEnd;
    toNode: string;
    toSide?: CanvasSide;
    toEnd?: CanvasEnd;
    color?: CanvasColor;
    label?: string;
}
/** Top-level JSON Canvas document structure */
interface CanvasData {
    nodes?: CanvasNode[];
    edges?: CanvasEdge[];
}
interface CanvasPageOptions {
    /** Enable pan/zoom interaction on the canvas. Default: true */
    enableInteraction?: boolean;
    /** Initial zoom level. Default: 1 */
    initialZoom?: number;
    /** Minimum zoom level. Default: 0.1 */
    minZoom?: number;
    /** Maximum zoom level. Default: 5 */
    maxZoom?: number;
}
/** Preset color map: preset number → CSS color value */
declare const CANVAS_PRESET_COLORS: Record<string, string>;

export { CANVAS_PRESET_COLORS, type CanvasBackgroundStyle, type CanvasColor, type CanvasData, type CanvasEdge, type CanvasEnd, type CanvasFileNode, type CanvasGroupNode, type CanvasLinkNode, type CanvasNode, type CanvasPageOptions, type CanvasSide, type CanvasTextNode };
