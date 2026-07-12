import { QuartzComponent, FullSlug, QuartzPluginData } from '@quartz-community/types';
import { CanvasPageOptions } from '../types.js';

declare function resolveEmbeddedHtml(fileSlug: FullSlug, canvasSlug: FullSlug, allFiles: QuartzPluginData[], subpath?: string, visited?: Set<string>): string | undefined;
declare const _default: (userOpts?: CanvasPageOptions) => QuartzComponent;

export { _default as CanvasBody, resolveEmbeddedHtml };
