#!/usr/bin/env node
// Dev sidecar: watches the Lean sources that feed the blueprint and, when they
// change, prints a staleness notice in the dev terminal — press `s` + Enter to
// rerun `lake build && npm run blueprint:sync` right there.
//
// Detection is free (file events plus an initial mtime comparison against the
// generated blueprint-data.json); the expensive part only runs on request.
// Measured on a real mathlib-based blueprint, a full cycle is ~85s — a ~23s
// module compile plus a ~55s extractor environment load that repeats on every
// run — which is why this prompts instead of auto-firing on every save.
//
// Spawned by `npm run dev` (scripts/quartz-build.mjs). Exits quietly when no
// Lean toolchain is present; opt out with `npm run dev -- --no-lean-watch`.
// LEAN_WATCH_ROOT / LEAN_WATCH_READY_FILE exist for the tests, which drive a
// real watcher process against a temp directory (see lean-watch.test.mjs).

import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"
import chokidar from "chokidar"
import { loadBlueprintConfig } from "./lib/blueprint-model.mjs"

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ROOT = path.resolve(process.env.LEAN_WATCH_ROOT ?? DEFAULT_ROOT)
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
const dim = (s) => (process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s)
// stderr, not stdout: the sidecar shares a terminal with the Quartz dev server.
const log = (msg) => console.error(`${dim("[lean-watch]")} ${msg}`)

const probe = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: "ignore", ...opts }).status === 0
const hasLean = probe("elan", ["--version"]) || probe("lake", ["--version"], { cwd: os.tmpdir() })
if (!hasLean) {
  log("no Lean toolchain found — the status re-sync prompt is disabled")
  process.exit(0)
}

const CONFIG_NAMES = ["lakefile.toml", "lakefile.lean", "lean-toolchain", "blueprint.config.json"]

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

// The sources whose changes can move node statuses: the blueprint dir (its
// .lean chapters ARE Lake source), any configured leanSrcDirs, and the build
// configuration itself. Markdown edits never trigger anything here.
// Re-read on blueprint.config.json changes so a leanSrcDirs edit re-arms the
// watcher without a dev-server restart.
let cfg
let srcDirs = []
let configFiles = []
let configSet = new Set()
const loadWatchConfig = () => {
  cfg = loadBlueprintConfig(ROOT)
  const roots = [
    cfg.blueprintDir,
    ...(Array.isArray(cfg.leanSrcDirs) ? cfg.leanSrcDirs.map((d) => path.resolve(ROOT, d)) : []),
  ]
    .map((d) => path.resolve(d))
    .filter((d, i, all) => fs.existsSync(d) && all.indexOf(d) === i)
  // Drop roots nested inside another root — watching "." already covers them.
  srcDirs = roots.filter((d) => !roots.some((o) => o !== d && d.startsWith(o + path.sep)))
  configFiles = CONFIG_NAMES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f))
  configSet = new Set(configFiles)
}
loadWatchConfig()

const isRelevant = (p) => p.endsWith(".lean") || configSet.has(path.resolve(p))
// Prune the walk, not just the events — leanSrcDirs is often "." (the whole
// repo), and descending into node_modules, the Quartz-rewritten public/ tree,
// or .lake (a full mathlib checkout: tens of thousands of files) makes the
// watcher useless: slow ready, real memory, events queued behind giant scans.
// Segment-aware so directories are pruned, not just their files. .lake is
// pruned UNLESS a leanSrcDirs entry explicitly points inside it (the
// dependency path from the external-project tutorial).
const PRUNE_RE = /(^|\/)(node_modules|\.git|public|\.quartz-cache|quartz)(\/|$)/
const insideExplicitLakeRoot = (p) =>
  srcDirs.some(
    (d) => d.includes(`${path.sep}.lake${path.sep}`) && (p === d || p.startsWith(d + path.sep)),
  )
const ignored = (p) => {
  if (PRUNE_RE.test(p)) return true
  if (/(^|\/)\.lake(\/|$)/.test(p))
    return /\/\.lake\/build(\/|$)/.test(p) || !insideExplicitLakeRoot(p)
  return false
}

// Newest .lean mtime under the watched roots — used once at startup to catch
// edits made while the dev server was down. Config files are deliberately
// excluded here (they stay in the live watch): a fresh checkout stamps them
// with clone-time mtimes that can trail the generated data either way, and a
// config file being newer than blueprint-data.json does not mean the kernel
// data is stale.
const latestSourceMtime = () => {
  let latest = 0
  const stack = [...srcDirs]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name)
      if (ignored(p)) continue
      if (entry.isDirectory()) stack.push(p)
      else if (entry.isFile() && p.endsWith(".lean")) latest = Math.max(latest, mtime(p))
    }
  }
  return latest
}

let announced = false
let running = false
let dirtyDuringRun = false
let activeChild = null

// Mirrors the terminal notices for the on-page pill (see the status server
// below and quartz/components/scripts/leanwatch.inline.ts).
let status = { state: "fresh" }
const setStatus = (next) => {
  status = { ...next, updatedAt: Date.now() }
}

const notice = () => {
  if (running) return
  setStatus({ state: "stale" })
  if (announced) return
  announced = true
  log("Lean sources changed — node statuses may be stale.")
  log(`press ${dim("s + Enter")} to re-sync (lake build && npm run blueprint:sync)`)
}

const runStep = (cmd, args) =>
  new Promise((resolve) => {
    activeChild = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" })
    activeChild.on("error", (err) => {
      activeChild = null
      log(`${cmd}: ${err.message}`)
      resolve(1)
    })
    activeChild.on("close", (code) => {
      activeChild = null
      resolve(code ?? 1)
    })
  })

const runSync = async () => {
  if (running) {
    log("a re-sync is already running")
    return
  }
  running = true
  announced = false
  // Each attempt owns its change window: anything edited before this point is
  // part of this build, so a flag left over from an earlier (failed) attempt
  // must not re-arm the stale notice after a clean retry.
  dirtyDuringRun = false
  const t0 = Date.now()
  setStatus({ state: "syncing", phase: "build", startedAt: t0 })
  log("lake build …")
  if ((await runStep("lake", ["build"])) !== 0) {
    running = false
    setStatus({ state: "failed" })
    log("lake build failed — statuses unchanged; fix the error and press s + Enter to retry")
    return
  }
  setStatus({ state: "syncing", phase: "extract", startedAt: t0 })
  log("extracting kernel data … (mathlib-sized projects take about a minute)")
  const code = await runStep(npmCmd, ["run", "blueprint:sync"])
  running = false
  if (code === 0) {
    const secs = Math.round((Date.now() - t0) / 1000)
    setStatus({ state: "fresh", tookSecs: secs })
    log(`re-sync complete in ${secs}s — the page hot-reloads on its own`)
  } else {
    setStatus({ state: "failed" })
    log("blueprint:sync failed — see the output above")
  }
  if (dirtyDuringRun) {
    dirtyDuringRun = false
    notice()
  }
}

// ---- status server: powers the on-page staleness pill --------------------
// Bound to 127.0.0.1 only, and browser requests must come from a localhost
// origin: any other origin is rejected before acting, so a hostile page the
// user happens to have open cannot read the state or trigger builds
// (cross-origin no-cors POSTs execute server-side even when the response is
// unreadable, hence the check up front). Requests without an Origin header —
// curl, scripts — are allowed by design. GET /status reports the state above;
// POST /sync runs the same fixed re-sync as pressing `s`, nothing else
// crosses this boundary.
const STATUS_PORT = Number(process.env.LEAN_WATCH_STATUS_PORT ?? 3003)
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
const statusServer = http.createServer((req, res) => {
  const origin = req.headers.origin
  if (origin !== undefined && !LOCAL_ORIGIN_RE.test(origin)) {
    res.writeHead(403)
    return res.end()
  }
  const cors = {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors)
    return res.end()
  }
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" })
    return res.end(JSON.stringify(status))
  }
  if (req.method === "POST" && req.url === "/sync") {
    const busy = running
    if (!busy) void runSync()
    res.writeHead(busy ? 409 : 202, { ...cors, "Content-Type": "application/json" })
    return res.end(JSON.stringify({ ok: !busy }))
  }
  res.writeHead(404, cors)
  res.end()
})
statusServer.on("error", (err) => {
  log(`status server disabled (${err.code ?? err.message}) — the on-page pill won't appear`)
})
statusServer.listen(STATUS_PORT, "127.0.0.1")
statusServer.unref()

const watcher = chokidar.watch([...srcDirs, ...configFiles], {
  ignored,
  ignoreInitial: true,
  awaitWriteFinish: { pollInterval: 50, stabilityThreshold: 250 },
})

// A leanSrcDirs change in blueprint.config.json re-arms the watch set live.
const refreshWatchConfig = () => {
  const previous = [...srcDirs, ...configFiles]
  loadWatchConfig()
  const next = new Set([...srcDirs, ...configFiles])
  const removed = previous.filter((p) => !next.has(p))
  const added = [...next].filter((p) => !previous.includes(p))
  if (removed.length) watcher.unwatch(removed)
  if (added.length) watcher.add(added)
}

watcher.on("all", (event, p) => {
  if (event === "addDir" || event === "unlinkDir" || !isRelevant(p)) return
  if (path.resolve(p) === path.join(ROOT, "blueprint.config.json")) refreshWatchConfig()
  if (running) {
    dirtyDuringRun = true
    return
  }
  notice()
})
watcher.on("error", (err) => log(`watcher error: ${err.message}`))
watcher.on("ready", () => {
  log(`watching ${srcDirs.map((d) => path.relative(ROOT, d) || ".").join(", ")} for Lean changes`)
  if (process.env.LEAN_WATCH_READY_FILE) {
    try {
      fs.writeFileSync(process.env.LEAN_WATCH_READY_FILE, "ready\n")
    } catch {
      // best-effort test handshake
    }
  }
  if (latestSourceMtime() > mtime(cfg.dataPath)) notice()
})

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on("line", (line) => {
  if (line.trim().toLowerCase() === "s") void runSync()
})

const shutdown = () => {
  if (activeChild && !activeChild.killed) activeChild.kill("SIGTERM")
  void watcher.close().finally(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
