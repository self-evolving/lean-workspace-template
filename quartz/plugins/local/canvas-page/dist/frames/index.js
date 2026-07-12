// Re-export shim (local patch): same rationale as dist/components/index.js — the
// frame loader imports this subpath bundle, which upstream ships as a full duplicate.
// Re-export from the patched main bundle so there is one source of truth.
export { CanvasFrame } from "../index.js"
