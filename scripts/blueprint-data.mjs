#!/usr/bin/env node
// Config-aware wrapper for the kernel extractor: reads blueprint.config.json and
// runs `lake exe blueprint-data <outPath> <lakeRoots...>` — the same invocation CI
// uses, so the documented local loop (`npm run blueprint:sync`) can never drift
// from the extractor's CLI contract.
//
// Output is streamed, and when the extractor goes quiet a heartbeat prints the
// elapsed time — on mathlib-sized projects a healthy run can be silent for minutes
// and is otherwise indistinguishable from a hung one (a real local run was killed
// for exactly that reason while the same extraction later succeeded in CI).

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { loadBlueprintConfig } from "./lib/blueprint-model.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cfg = loadBlueprintConfig(ROOT)

if (!cfg.lakeRoots?.length) {
  console.error(
    "blueprint-data: blueprint.config.json lakeRoots is empty — list the blueprint's root modules",
  )
  process.exit(1)
}

const out = path.relative(ROOT, cfg.dataPath)
const args = ["exe", "blueprint-data", out, ...cfg.lakeRoots]
console.log(`> lake ${args.join(" ")}`)

// Whether the lakefile actually requires mathlib (comment lines don't count:
// the shipped lakefile mentions mathlib in a "how to add it" comment).
const needsMathlib = (() => {
  try {
    return /"mathlib"/.test(
      fs
        .readFileSync(path.join(ROOT, "lakefile.toml"), "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"))
        .join("\n"),
    )
  } catch {
    return false
  }
})()

const fmt = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
}

const startedAt = Date.now()
let lastOutputAt = Date.now()
let lastBeatAt = 0
const QUIET_MS = 30_000

const child = spawn("lake", args, { cwd: ROOT, stdio: ["inherit", "pipe", "pipe"] })
child.stdout.on("data", (chunk) => {
  lastOutputAt = Date.now()
  process.stdout.write(chunk)
})
child.stderr.on("data", (chunk) => {
  lastOutputAt = Date.now()
  process.stderr.write(chunk)
})

let hintedCache = false
const heartbeat = setInterval(() => {
  const now = Date.now()
  if (now - lastOutputAt < QUIET_MS || now - lastBeatAt < QUIET_MS) return
  lastBeatAt = now
  process.stderr.write(
    `blueprint-data: still working (${fmt(now - startedAt)} elapsed, no new output — large projects are slow, this is usually fine)\n`,
  )
  if (!hintedCache && needsMathlib) {
    hintedCache = true
    process.stderr.write(
      "blueprint-data: if mathlib is compiling from source here, stop this (Ctrl-C) and run `lake exe cache get` first — it downloads prebuilt binaries in minutes\n",
    )
  }
}, 5_000)

child.on("error", (err) => {
  clearInterval(heartbeat)
  if (err.code === "ENOENT") {
    console.error(
      "blueprint-data: `lake` not found — install elan (https://github.com/leanprover/elan) and ensure ~/.elan/bin is on PATH",
    )
  } else {
    console.error(`blueprint-data: ${err.message}`)
  }
  process.exit(1)
})
child.on("close", (code) => {
  clearInterval(heartbeat)
  process.exit(code ?? 1)
})
