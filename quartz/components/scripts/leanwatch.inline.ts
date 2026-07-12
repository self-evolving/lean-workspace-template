// Dev-only staleness pill for Lean proof statuses.
//
// Talks to the lean-watch sidecar's status server (127.0.0.1:3003, spawned by
// `npm run dev` — see scripts/lean-watch.mjs). Shows a pill when node statuses
// are stale, with a Re-sync button that triggers the same `lake build && npm
// run blueprint:sync` as pressing `s` in the dev terminal; the page then
// hot-reloads on its own when the regenerated data lands.
//
// Deployed sites never see any of this: the whole module is gated on the page
// being served from localhost, and even there it goes dormant after two
// failed probes (dev server running without the sidecar).

const STATUS_URL = "http://127.0.0.1:3003"
const POLL_MS = 3000

const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)

type WatchStatus = {
  state: "fresh" | "stale" | "syncing" | "failed"
  phase?: "build" | "extract"
  startedAt?: number
  tookSecs?: number
}

let started = false
let failures = 0
let pill: HTMLDivElement | null = null

const ensurePill = (): HTMLDivElement => {
  if (pill && document.body.contains(pill)) return pill
  pill = document.createElement("div")
  pill.id = "lean-watch-pill"
  pill.style.cssText = [
    "position: fixed",
    "bottom: 1.5rem",
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 999",
    "display: none",
    "align-items: center",
    "gap: 0.75em",
    "padding: 0.75em 1.2em",
    "border-radius: 999px",
    "font-family: var(--bodyFont, sans-serif)",
    "font-size: 0.92rem",
    "white-space: nowrap",
    "max-width: min(92vw, 44rem)",
    "color: var(--dark, #333)",
    "background: var(--light, #fff)",
    "border: 1.5px solid var(--secondary, #6c5ce7)",
    "box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22)",
  ].join(";")
  document.body.appendChild(pill)
  return pill
}

const render = (status: WatchStatus) => {
  const el = ensurePill()
  const show = (html: string) => {
    el.innerHTML = html
    el.style.display = "flex"
  }
  switch (status.state) {
    case "stale":
      show(
        `<span>The Lean proof file has changed — this page may be out of sync.</span>` +
          `<button id="lean-watch-resync" style="border:none;border-radius:999px;` +
          `padding:0.35em 1em;font:inherit;font-weight:600;cursor:pointer;` +
          `background:var(--secondary,#6c5ce7);color:var(--light,#fff)">` +
          `Re-sync</button>`,
      )
      document.getElementById("lean-watch-resync")?.addEventListener("click", () => {
        void fetch(`${STATUS_URL}/sync`, { method: "POST" }).catch(() => {})
        render({ state: "syncing", startedAt: Date.now() })
      })
      break
    case "syncing": {
      const secs = status.startedAt ? Math.round((Date.now() - status.startedAt) / 1000) : 0
      const phase = status.phase === "extract" ? "extracting kernel data" : "building Lean"
      show(
        `<span>Re-syncing proof statuses — ${phase}… ${secs}s` +
          `<span style="opacity:0.65"> (mathlib-sized projects take about a minute)</span></span>`,
      )
      break
    }
    case "failed":
      show(
        `<span>Re-sync failed — see the dev terminal</span>` +
          `<button id="lean-watch-retry" style="border:none;border-radius:999px;` +
          `padding:0.35em 1em;font:inherit;font-weight:600;cursor:pointer;` +
          `background:var(--secondary,#6c5ce7);color:var(--light,#fff)">` +
          `Retry</button>`,
      )
      document.getElementById("lean-watch-retry")?.addEventListener("click", () => {
        void fetch(`${STATUS_URL}/sync`, { method: "POST" }).catch(() => {})
        render({ state: "syncing", startedAt: Date.now() })
      })
      break
    default:
      el.style.display = "none"
  }
}

const poll = async () => {
  try {
    const res = await fetch(`${STATUS_URL}/status`)
    if (!res.ok) throw new Error(String(res.status))
    failures = 0
    render((await res.json()) as WatchStatus)
  } catch {
    failures += 1
    if (pill) pill.style.display = "none"
    if (failures >= 2) return // sidecar not running — go dormant for good
  }
  setTimeout(() => void poll(), POLL_MS)
}

if (isLocal && !started) {
  started = true
  void poll()
}
