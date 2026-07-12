#!/usr/bin/env node
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"

const args = process.argv.slice(2)
const quartzArgs = []
let contentRoot = process.env.QUARTZ_CONTENT_ROOT || "content"
let installPlugins = false
let serve = false
let leanWatch = true

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === "--install-plugins") {
    installPlugins = true
  } else if (arg === "--serve") {
    serve = true
  } else if (arg === "--no-lean-watch") {
    leanWatch = false
  } else if (arg === "--content-root") {
    i += 1
    contentRoot = args[i]
  } else if (arg.startsWith("--content-root=")) {
    contentRoot = arg.slice("--content-root=".length)
  } else {
    quartzArgs.push(arg)
  }
}

if (!contentRoot?.trim()) {
  console.error("quartz-build: content root cannot be empty")
  process.exit(1)
}

const runNpm = (npmArgs) => {
  console.log(`> npm ${npmArgs.join(" ")}`)
  const result = spawnSync(npmCmd, npmArgs, { cwd: ROOT, stdio: "inherit" })
  if (result.error?.code === "ENOENT") {
    console.error("quartz-build: `npm` not found")
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (installPlugins) runNpm(["run", "install-plugins"])

// In dev, a sidecar watches the Lean sources and offers a one-key status
// re-sync when they change (it exits by itself when no toolchain is present).
if (serve && leanWatch) {
  const sidecar = spawn(process.execPath, [path.join(ROOT, "scripts", "lean-watch.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  })
  // The sidecar is optional — a spawn failure (EMFILE, EAGAIN, …) must not
  // take the dev server down with it.
  sidecar.on("error", (err) => {
    console.error(`quartz-build: lean-watch disabled (${err.code ?? err.message}) — dev continues`)
  })
  process.on("exit", () => sidecar.kill())
}

runNpm([
  "run",
  "quartz",
  "--",
  "build",
  "-d",
  contentRoot,
  ...(serve ? ["--serve"] : []),
  ...quartzArgs,
])
