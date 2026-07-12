// Re-export shim (local patch): the upstream build duplicated the whole component
// implementation into this subpath bundle. The plugin loader registers CanvasBody from
// here (manifest category includes "component"), which silently overrode the patched
// implementation in ../index.js. Keep a single source of truth instead.
export { CanvasBody, resolveEmbeddedHtml } from "../index.js"
