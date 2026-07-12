import { QuartzPageTypePlugin } from '@quartz-community/types';
export { PageGenerator, PageMatcher, QuartzComponent, QuartzComponentConstructor, QuartzComponentProps, QuartzPageTypePlugin, QuartzPageTypePluginInstance, VirtualPage } from '@quartz-community/types';
import { CanvasPageOptions } from './types.js';
export { CanvasBackgroundStyle, CanvasColor, CanvasData, CanvasEdge, CanvasEnd, CanvasFileNode, CanvasGroupNode, CanvasLinkNode, CanvasNode, CanvasSide, CanvasTextNode } from './types.js';
export { CanvasBody } from './components/index.js';
export { CanvasFrame } from './frames/index.js';

declare const CanvasPage: QuartzPageTypePlugin<CanvasPageOptions>;

export { CanvasPage, CanvasPageOptions };
