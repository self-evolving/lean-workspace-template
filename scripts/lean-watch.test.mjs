// Drives a real lean-watch process against a temp workspace: fake `lake`/`npm`
// shims on PATH, LEAN_WATCH_ROOT pointing at the temp root, and the ready-file
// handshake. Covers: quiet start when data is fresh, stale notice on a nested
// .lean edit, `s` + Enter re-sync, and live re-arming of the watch set when
// blueprint.config.json changes leanSrcDirs.
// Adapted from the Sepo agent's implementation of #105 (PR #106).

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STALE_NOTICE = "Lean sources changed"
const SYNC_COMPLETE = "re-sync complete"

function writeExecutable(file, src) {
  fs.writeFileSync(file, src)
  fs.chmodSync(file, 0o755)
}

async function waitFor(predicate, message, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await sleep(25)
  }
  assert.fail(typeof message === "function" ? message() : message)
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(1000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL")
    }),
  ])
}

test("nested Lean edits under watched and refreshed source dirs mark statuses stale", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lean-watch-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const sourceDir = path.join(root, "src")
  const nestedDir = path.join(sourceDir, "Nested")
  const refreshedDir = path.join(root, "refreshed", "Nested")
  const dataDir = path.join(root, "content", "blueprint")
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.mkdirSync(refreshedDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  const toolchainFile = path.join(root, "lean-toolchain")
  const configFile = path.join(root, "blueprint.config.json")
  fs.writeFileSync(toolchainFile, "leanprover/lean4:v4.30.0\n")
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      contentRoot: "content",
      blueprints: [{ root: "blueprint", leanSrcDirs: ["src"] }],
    }),
  )

  const leanFile = path.join(nestedDir, "Proof.lean")
  const refreshedLeanFile = path.join(refreshedDir, "Proof.lean")
  const dataFile = path.join(dataDir, "blueprint-data.json")
  fs.writeFileSync(leanFile, "theorem demo : True := by trivial\n")
  fs.writeFileSync(refreshedLeanFile, "theorem refreshed : True := by trivial\n")
  fs.writeFileSync(dataFile, "{}\n")
  // A stray root lean/ dir must NOT be watched by default (it stopped being a
  // convention in #110); its fresh mtime would trip the startup staleness
  // check if it were still a default root.
  const strayLeanDir = path.join(root, "lean")
  fs.mkdirSync(strayLeanDir)
  fs.writeFileSync(path.join(strayLeanDir, "Stray.lean"), "theorem stray : True := by trivial\n")
  const now = Date.now() / 1000
  for (const sourceFile of [leanFile, refreshedLeanFile]) {
    fs.utimesSync(sourceFile, now - 10, now - 10)
  }
  fs.utimesSync(dataFile, now - 5, now - 5)
  // Config/toolchain deliberately NEWER than the generated data: fresh
  // checkouts often land this way, and it must not trigger the stale prompt —
  // only .lean edits mean the kernel data is out of date.
  for (const sourceFile of [toolchainFile, configFile]) {
    fs.utimesSync(sourceFile, now, now)
  }

  const bin = path.join(root, "bin")
  fs.mkdirSync(bin)
  writeExecutable(path.join(bin, "lake"), "#!/bin/sh\nexit 0\n")
  writeExecutable(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n")
  fs.writeFileSync(path.join(bin, "lake.cmd"), "@echo off\r\nexit /b 0\r\n")
  fs.writeFileSync(path.join(bin, "npm.cmd"), "@echo off\r\nexit /b 0\r\n")

  const readyFile = path.join(root, "lean-watch.ready")
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "scripts", "lean-watch.mjs")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LEAN_WATCH_READY_FILE: readyFile,
      LEAN_WATCH_ROOT: root,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: ["pipe", "ignore", "pipe"],
  })
  t.after(() => stopChild(child))

  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const noticeCount = () => stderr.split(STALE_NOTICE).length - 1
  const completeCount = () => stderr.split(SYNC_COMPLETE).length - 1

  await waitFor(() => fs.existsSync(readyFile), "lean watcher did not become ready")
  assert.doesNotMatch(stderr, new RegExp(STALE_NOTICE))
  assert.doesNotMatch(
    stderr,
    /watching[^\n]*\blean\b/,
    "root lean/ must not be a default watch root",
  )

  fs.writeFileSync(leanFile, "theorem demo : True := by\n  trivial\n")

  await waitFor(
    () => noticeCount() === 1,
    () => `nested .lean edit did not produce stale notice; stderr was:\n${stderr}`,
  )

  child.stdin.write("s\n")
  await waitFor(
    () => completeCount() === 1,
    () => `re-sync did not complete; stderr was:\n${stderr}`,
  )

  fs.writeFileSync(
    configFile,
    JSON.stringify({
      contentRoot: "content",
      blueprints: [{ root: "blueprint", leanSrcDirs: ["refreshed"] }],
    }),
  )
  await waitFor(
    () => noticeCount() >= 2,
    () => `blueprint.config.json change did not produce stale notice; stderr was:\n${stderr}`,
  )

  child.stdin.write("s\n")
  await waitFor(
    () => completeCount() === 2,
    () => `second re-sync did not complete; stderr was:\n${stderr}`,
  )

  await sleep(250)
  const before = noticeCount()
  fs.writeFileSync(refreshedLeanFile, "theorem refreshed : True := by\n  trivial\n")
  await waitFor(
    () => noticeCount() > before,
    () => `edit under refreshed source root did not produce stale notice; stderr was:\n${stderr}`,
  )
})

test("a change during a failed build does not re-arm the notice after a clean retry", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lean-watch-retry-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const sourceDir = path.join(root, "src")
  const dataDir = path.join(root, "content", "blueprint")
  fs.mkdirSync(sourceDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(root, "lean-toolchain"), "leanprover/lean4:v4.30.0\n")
  fs.writeFileSync(
    path.join(root, "blueprint.config.json"),
    JSON.stringify({
      contentRoot: "content",
      blueprints: [{ root: "blueprint", leanSrcDirs: ["src"] }],
    }),
  )
  const leanFile = path.join(sourceDir, "Proof.lean")
  const dataFile = path.join(dataDir, "blueprint-data.json")
  fs.writeFileSync(leanFile, "theorem demo : True := by trivial\n")
  fs.writeFileSync(dataFile, "{}\n")
  const now = Date.now() / 1000
  fs.utimesSync(leanFile, now - 10, now - 10)
  fs.utimesSync(dataFile, now, now)

  // `lake` fails slowly while fail-flag exists (leaving a window to edit
  // mid-build), succeeds instantly otherwise. `npm` always succeeds.
  const bin = path.join(root, "bin")
  fs.mkdirSync(bin)
  writeExecutable(
    path.join(bin, "lake"),
    "#!/bin/sh\nif [ -f fail-flag ]; then sleep 1; exit 1; fi\nexit 0\n",
  )
  writeExecutable(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n")

  const readyFile = path.join(root, "lean-watch.ready")
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "scripts", "lean-watch.mjs")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LEAN_WATCH_READY_FILE: readyFile,
      LEAN_WATCH_ROOT: root,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: ["pipe", "ignore", "pipe"],
  })
  t.after(() => stopChild(child))

  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const noticeCount = () => stderr.split(STALE_NOTICE).length - 1
  const failCount = () => stderr.split("lake build failed").length - 1
  const completeCount = () => stderr.split(SYNC_COMPLETE).length - 1

  await waitFor(() => fs.existsSync(readyFile), "lean watcher did not become ready")

  fs.writeFileSync(leanFile, "theorem demo : True := by\n  trivial\n")
  await waitFor(
    () => noticeCount() === 1,
    () => `edit did not produce stale notice; stderr was:\n${stderr}`,
  )

  // Failing attempt, with another edit landing while the build runs.
  fs.writeFileSync(path.join(root, "fail-flag"), "1\n")
  child.stdin.write("s\n")
  await sleep(300)
  fs.writeFileSync(leanFile, "theorem demo : True := by\n  exact trivial\n")
  await waitFor(
    () => failCount() === 1,
    () => `failing lake build was not reported; stderr was:\n${stderr}`,
  )

  // Clean retry: the mid-build edit is part of this attempt, so after it
  // completes the notice count must not move at all. Captured BEFORE the
  // retry so a notice printed alongside the completion message is caught.
  fs.rmSync(path.join(root, "fail-flag"))
  const beforeRetry = noticeCount()
  child.stdin.write("s\n")
  await waitFor(
    () => completeCount() === 1,
    () => `retry did not complete; stderr was:\n${stderr}`,
  )
  await sleep(700)
  assert.equal(
    noticeCount(),
    beforeRetry,
    `stale notice re-armed after a clean retry; stderr was:\n${stderr}`,
  )
})
