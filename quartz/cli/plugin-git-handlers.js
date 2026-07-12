import fs from "fs"
import path from "path"
import { execFileSync, execSync } from "child_process"
import { styleText } from "util"
import {
  readPluginsJson,
  writePluginsJson,
  readLockfile,
  writeLockfile,
  extractPluginName,
  readManifestFromPackageJson,
  parseGitSource,
  getGitCommit,
  PLUGINS_DIR,
  LOCKFILE_PATH,
  isLocalSource,
} from "./plugin-data.js"

const INTERNAL_EXPORTS = new Set(["manifest", "default"])

function buildPlugin(pluginDir, name) {
  if (!needsBuild(pluginDir)) {
    console.log(styleText("gray", `  ✓ ${name}: pre-built dist present`))
    linkPeerPlugins(pluginDir)
    return true
  }

  try {
    console.log(styleText("cyan", `  → ${name}: installing dependencies...`))
    execSync("npm install", { cwd: pluginDir, stdio: "ignore" })
    console.log(styleText("cyan", `  → ${name}: building...`))
    execSync("npm run build", { cwd: pluginDir, stdio: "ignore" })
    // Remove devDependencies after build — they are no longer needed and their
    // presence can cause duplicate-singleton issues when a plugin ships its own
    // copy of a shared dependency (e.g. bases-page's ViewRegistry).
    execSync("npm prune --omit=dev", { cwd: pluginDir, stdio: "ignore" })
    // Symlink any peerDependencies that are co-installed Quartz plugins so that
    // Node's module resolution finds the host copy instead of a stale nested one.
    linkPeerPlugins(pluginDir)
    return true
  } catch (error) {
    console.log(styleText("red", `  ✗ ${name}: build failed`))
    return false
  }
}

function needsBuild(pluginDir) {
  const distDir = path.join(pluginDir, "dist")
  return !fs.existsSync(distDir)
}

function getEnabledPluginNames() {
  const pluginsJson = readPluginsJson()
  if (!pluginsJson?.plugins) return null

  return new Set(
    pluginsJson.plugins
      .filter((entry) => entry.enabled !== false)
      .map((entry) => extractPluginName(entry.source)),
  )
}

function getLockfilePluginEntries(lockfile, { enabledOnly = false } = {}) {
  const entries = Object.entries(lockfile.plugins)
  if (!enabledOnly) return entries

  const enabledNames = getEnabledPluginNames()
  if (!enabledNames) return entries

  return entries.filter(
    ([name, entry]) =>
      enabledNames.has(name) || enabledNames.has(extractPluginName(entry.source ?? name)),
  )
}

function throwIfPluginFailures(action, failed) {
  if (failed > 0) {
    throw new Error(`${failed} plugin(s) failed to ${action}`)
  }
}

function pluginPathExists(pluginDir) {
  try {
    fs.lstatSync(pluginDir)
    return true
  } catch {
    return false
  }
}

function removePluginDir(pluginDir) {
  if (!pluginPathExists(pluginDir)) return

  const stat = fs.lstatSync(pluginDir)
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.rmSync(pluginDir, { force: true })
  } else {
    fs.rmSync(pluginDir, { recursive: true, force: true })
  }
}

function validateGitRef(ref, label = "git ref") {
  if (
    typeof ref !== "string" ||
    ref.length === 0 ||
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".lock") ||
    ref.includes("..") ||
    ref.includes("//") ||
    ref.includes("@{") ||
    !/^[A-Za-z0-9._/-]+$/.test(ref)
  ) {
    throw new Error(`Invalid ${label}: ${ref}`)
  }
  return ref
}

function validateGitCommit(commit, label = "git commit") {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new Error(`Invalid ${label}: ${commit}`)
  }
  return commit
}

function git(args, options = {}) {
  return execFileSync("git", args, options)
}

function clonePluginRepo(url, pluginDir, ref) {
  const args = ["clone", "--depth", "1"]
  if (ref) {
    args.push("--branch", validateGitRef(ref, "plugin ref"))
  }
  args.push("--", url, pluginDir)
  git(args, { stdio: "ignore" })
}

/**
 * After pruning devDependencies, peerDependencies that reference other Quartz
 * plugins (e.g. @quartz-community/bases-page) won't be installed as npm
 * packages — they're loaded by v5 as sibling plugins. To make Node's module
 * resolution work, we symlink those peers to the co-installed plugin directory.
 */
function linkPeerPlugins(pluginDir) {
  const pkgPath = path.join(pluginDir, "package.json")
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
  const peers = pkg.peerDependencies ?? {}

  for (const peerName of Object.keys(peers)) {
    // Only handle @quartz-community scoped packages — those are Quartz plugins
    if (!peerName.startsWith("@quartz-community/")) continue

    // Check if this peer is already satisfied (e.g. installed as a regular dep)
    const peerNodeModulesPath = path.join(pluginDir, "node_modules", ...peerName.split("/"))
    if (fs.existsSync(peerNodeModulesPath)) continue

    // Find the sibling plugin by its npm package name
    const siblingPlugin = findPluginByPackageName(peerName)
    if (!siblingPlugin) continue

    // Create the scoped directory if needed
    const scopeDir = path.join(pluginDir, "node_modules", peerName.split("/")[0])
    fs.mkdirSync(scopeDir, { recursive: true })

    // Create a relative symlink to the sibling plugin
    const target = path.relative(scopeDir, siblingPlugin)
    fs.symlinkSync(target, peerNodeModulesPath, "dir")
  }
}

/**
 * Search installed plugins for one whose package.json "name" matches the given
 * npm package name (e.g. "@quartz-community/bases-page").
 */
function findPluginByPackageName(packageName) {
  if (!fs.existsSync(PLUGINS_DIR)) return null

  const plugins = fs.readdirSync(PLUGINS_DIR).filter((entry) => {
    const entryPath = path.join(PLUGINS_DIR, entry)
    return fs.statSync(entryPath).isDirectory()
  })

  for (const pluginDirName of plugins) {
    const pkgPath = path.join(PLUGINS_DIR, pluginDirName, "package.json")
    if (!fs.existsSync(pkgPath)) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
      if (pkg.name === packageName) {
        return path.join(PLUGINS_DIR, pluginDirName)
      }
    } catch {}
  }
  return null
}

function parseExportsFromDts(content) {
  const exports = []
  const exportMatches = content.matchAll(/export\s*{\s*([^}]+)\s*}(?:\s*from\s*['"]([^'"]+)['"])?/g)
  for (const match of exportMatches) {
    const fromModule = match[2]
    if (fromModule?.startsWith("@")) continue

    const names = match[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
    for (const name of names) {
      const cleanName = name.split(" as ").pop()?.trim() || name.trim()
      if (cleanName && !cleanName.startsWith("_") && !INTERNAL_EXPORTS.has(cleanName)) {
        const finalName = cleanName.replace(/^type\s+/, "")
        if (name.includes("type ")) {
          exports.push(`type ${finalName}`)
        } else {
          exports.push(finalName)
        }
      }
    }
  }
  return exports
}

async function regeneratePluginIndex() {
  if (!fs.existsSync(PLUGINS_DIR)) return

  const plugins = fs.readdirSync(PLUGINS_DIR).filter((name) => {
    const pluginPath = path.join(PLUGINS_DIR, name)
    return fs.statSync(pluginPath).isDirectory()
  })

  const exports = []

  for (const pluginName of plugins) {
    const pluginDir = path.join(PLUGINS_DIR, pluginName)
    const distIndex = path.join(pluginDir, "dist", "index.d.ts")

    if (!fs.existsSync(distIndex)) continue

    const dtsContent = fs.readFileSync(distIndex, "utf-8")
    const exportedNames = parseExportsFromDts(dtsContent)

    if (exportedNames.length > 0) {
      const namedExports = exportedNames.filter((e) => !e.startsWith("type "))
      const typeExports = exportedNames.filter((e) => e.startsWith("type ")).map((e) => e.slice(5))

      if (namedExports.length > 0) {
        exports.push(`export { ${namedExports.join(", ")} } from "./${pluginName}"`)
      }
      if (typeExports.length > 0) {
        exports.push(`export type { ${typeExports.join(", ")} } from "./${pluginName}"`)
      }
    }
  }

  const indexContent = exports.join("\n") + "\n"
  const indexPath = path.join(PLUGINS_DIR, "index.ts")
  fs.writeFileSync(indexPath, indexContent)
}

export async function handlePluginInstall({ enabledOnly = false } = {}) {
  const lockfile = readLockfile()

  if (!lockfile) {
    const message = "No quartz.lock.json found. Run 'npx quartz plugin add <repo>' first."
    console.log(styleText("red", `✗ ${message}`))
    throw new Error(message)
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  }

  console.log(
    styleText(
      "cyan",
      enabledOnly
        ? "→ Installing enabled plugins from lockfile..."
        : "→ Installing plugins from lockfile...",
    ),
  )
  let installed = 0
  let failed = 0
  const pluginsToBuild = []

  for (const [name, entry] of getLockfilePluginEntries(lockfile, { enabledOnly })) {
    const pluginDir = path.join(PLUGINS_DIR, name)

    // Local plugin: ensure symlink exists
    if (entry.commit === "local") {
      const localTarget = path.resolve(entry.resolved)
      try {
        if (fs.existsSync(pluginDir)) {
          const stat = fs.lstatSync(pluginDir)
          if (
            stat.isSymbolicLink() &&
            path.resolve(path.dirname(pluginDir), fs.readlinkSync(pluginDir)) === localTarget
          ) {
            console.log(styleText("gray", `  ✓ ${name} (local) already linked`))
            installed++
            continue
          }
          // Wrong target or not a symlink — remove and re-link
          if (stat.isSymbolicLink()) fs.unlinkSync(pluginDir)
          else fs.rmSync(pluginDir, { recursive: true })
        }
        if (!fs.existsSync(localTarget)) {
          console.log(styleText("red", `  ✗ ${name}: local path missing: ${entry.resolved}`))
          failed++
          continue
        }
        fs.mkdirSync(path.dirname(pluginDir), { recursive: true })
        fs.symlinkSync(localTarget, pluginDir, "dir")
        console.log(styleText("green", `  ✓ ${name} (local) linked`))
        pluginsToBuild.push({ name, pluginDir })
        installed++
      } catch {
        console.log(styleText("red", `  ✗ ${name}: failed to link local path`))
        failed++
      }
      continue
    }

    if (fs.existsSync(pluginDir)) {
      try {
        const currentCommit = getGitCommit(pluginDir)
        if (currentCommit === entry.commit && !needsBuild(pluginDir)) {
          console.log(
            styleText("gray", `  ✓ ${name}@${entry.commit.slice(0, 7)} already installed`),
          )
          installed++
          continue
        }
        if (currentCommit !== entry.commit) {
          console.log(styleText("cyan", `  → ${name}: updating to ${entry.commit.slice(0, 7)}...`))
          const fetchArgs = ["fetch", "--depth", "1", "origin"]
          if (entry.ref) {
            fetchArgs.push(validateGitRef(entry.ref, "plugin ref"))
          }
          git(fetchArgs, { cwd: pluginDir, stdio: "ignore" })
          git(["reset", "--hard", validateGitCommit(entry.commit, "locked commit")], {
            cwd: pluginDir,
            stdio: "ignore",
          })
        }
        pluginsToBuild.push({ name, pluginDir })
        installed++
      } catch {
        console.log(styleText("red", `  ✗ ${name}: failed to update`))
        failed++
      }
    } else {
      try {
        console.log(styleText("cyan", `  → ${name}: cloning...`))
        clonePluginRepo(entry.resolved, pluginDir, entry.ref)
        if (entry.commit !== "unknown") {
          const commit = validateGitCommit(entry.commit, "locked commit")
          git(["fetch", "--depth", "1", "origin", commit], {
            cwd: pluginDir,
            stdio: "ignore",
          })
          git(["checkout", commit], { cwd: pluginDir, stdio: "ignore" })
        }
        console.log(styleText("green", `  ✓ ${name}@${entry.commit.slice(0, 7)}`))
        pluginsToBuild.push({ name, pluginDir })
        installed++
      } catch {
        console.log(styleText("red", `  ✗ ${name}: failed to clone`))
        failed++
      }
    }
  }

  if (pluginsToBuild.length > 0) {
    console.log()
    console.log(styleText("cyan", "→ Building plugins..."))
    for (const { name, pluginDir } of pluginsToBuild) {
      if (!buildPlugin(pluginDir, name)) {
        failed++
        installed--
      } else {
        console.log(styleText("green", `  ✓ ${name} built`))
      }
    }
  }

  await regeneratePluginIndex()

  console.log()
  if (failed === 0) {
    console.log(styleText("green", `✓ Installed ${installed} plugin(s)`))
  } else {
    console.log(styleText("red", `✗ Installed ${installed} plugin(s), ${failed} failed`))
    throwIfPluginFailures("install", failed)
  }
}

export async function handlePluginAdd(sources) {
  let lockfile = readLockfile()
  if (!lockfile) {
    lockfile = { version: "1.0.0", plugins: {} }
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  }

  let failed = 0
  const addedPlugins = []
  const builtPlugins = []

  for (const source of sources) {
    try {
      const { name, url, ref, local } = parseGitSource(source)
      const pluginDir = path.join(PLUGINS_DIR, name)

      if (fs.existsSync(pluginDir)) {
        console.log(styleText("yellow", `⚠ ${name} already exists. Use 'update' to refresh.`))
        continue
      }

      if (local) {
        // Local path: create symlink instead of git clone
        const resolvedPath = path.resolve(url)
        if (!fs.existsSync(resolvedPath)) {
          console.log(styleText("red", `✗ Local path does not exist: ${resolvedPath}`))
          failed++
          continue
        }
        console.log(styleText("cyan", `→ Adding ${name} from local path ${resolvedPath}...`))
        fs.mkdirSync(path.dirname(pluginDir), { recursive: true })
        fs.symlinkSync(resolvedPath, pluginDir, "dir")
        lockfile.plugins[name] = {
          source,
          resolved: resolvedPath,
          commit: "local",
          installedAt: new Date().toISOString(),
        }
        addedPlugins.push({ name, pluginDir, source })
        console.log(styleText("green", `✓ Added ${name} (local symlink)`))
      } else {
        console.log(styleText("cyan", `→ Adding ${name} from ${url}...`))

        clonePluginRepo(url, pluginDir, ref)

        const commit = getGitCommit(pluginDir)
        lockfile.plugins[name] = {
          source,
          resolved: url,
          commit,
          ...(ref && { ref }),
          installedAt: new Date().toISOString(),
        }

        addedPlugins.push({ name, pluginDir, source })
        console.log(styleText("green", `✓ Added ${name}@${commit.slice(0, 7)}`))
      }
    } catch (error) {
      console.log(styleText("red", `✗ Failed to add ${source}: ${error}`))
      failed++
    }
  }

  if (addedPlugins.length > 0) {
    console.log()
    console.log(styleText("cyan", "→ Building plugins..."))
    for (const plugin of addedPlugins) {
      const { name, pluginDir } = plugin
      if (buildPlugin(pluginDir, name)) {
        console.log(styleText("green", `  ✓ ${name} built`))
        builtPlugins.push(plugin)
      } else {
        failed++
        delete lockfile.plugins[name]
        removePluginDir(pluginDir)
      }
    }
  }

  if (builtPlugins.length > 0) {
    await regeneratePluginIndex()
    writeLockfile(lockfile)
    const pluginsJson = readPluginsJson()
    if (pluginsJson?.plugins) {
      for (const { pluginDir, source } of builtPlugins) {
        const manifest = readManifestFromPackageJson(pluginDir)
        const newEntry = {
          source,
          enabled: manifest?.defaultEnabled ?? true,
          options: manifest?.defaultOptions ?? {},
          order: manifest?.defaultOrder ?? 50,
        }

        if (manifest?.components) {
          const firstComponentKey = Object.keys(manifest.components)[0]
          const comp = manifest.components[firstComponentKey]
          if (comp?.defaultPosition) {
            newEntry.layout = {
              position: comp.defaultPosition,
              priority: comp.defaultPriority ?? 50,
              display: "all",
            }
          }
        }

        pluginsJson.plugins.push(newEntry)
      }
      writePluginsJson(pluginsJson)
    }
    console.log()
    console.log(styleText("gray", "Updated quartz.lock.json"))
  } else if (addedPlugins.length > 0 || failed > 0) {
    console.log()
    console.log(styleText("gray", "No plugin changes were written"))
  }

  throwIfPluginFailures("add", failed)
}

export async function handlePluginRemove(names) {
  const lockfile = readLockfile()
  if (!lockfile) {
    console.log(styleText("yellow", "⚠ No plugins installed"))
    return
  }

  let removed = false
  for (const name of names) {
    const pluginDir = path.join(PLUGINS_DIR, name)

    if (!lockfile.plugins[name] && !fs.existsSync(pluginDir)) {
      console.log(styleText("yellow", `⚠ ${name} is not installed`))
      continue
    }

    console.log(styleText("cyan", `→ Removing ${name}...`))

    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true })
    }

    delete lockfile.plugins[name]
    console.log(styleText("green", `✓ Removed ${name}`))
    removed = true
  }

  if (removed) {
    await regeneratePluginIndex()
  }

  writeLockfile(lockfile)
  const pluginsJson = readPluginsJson()
  if (pluginsJson?.plugins) {
    pluginsJson.plugins = pluginsJson.plugins.filter(
      (plugin) =>
        !names.includes(extractPluginName(plugin.source)) && !names.includes(plugin.source),
    )
    writePluginsJson(pluginsJson)
  }
  console.log()
  console.log(styleText("gray", "Updated quartz.lock.json"))
}

export async function handlePluginEnable(names) {
  const json = readPluginsJson()
  if (!json) {
    console.log(styleText("red", "✗ No quartz.config.yaml found. Cannot enable plugins."))
    return
  }

  for (const name of names) {
    const entry = json.plugins.find(
      (e) => extractPluginName(e.source) === name || e.source === name,
    )
    if (!entry) {
      console.log(styleText("yellow", `⚠ Plugin "${name}" not found in quartz.config.yaml`))
      continue
    }
    if (entry.enabled) {
      console.log(styleText("gray", `✓ ${name} is already enabled`))
      continue
    }
    entry.enabled = true
    console.log(styleText("green", `✓ Enabled ${name}`))
  }

  writePluginsJson(json)
}

export async function handlePluginDisable(names) {
  const json = readPluginsJson()
  if (!json) {
    console.log(styleText("red", "✗ No quartz.config.yaml found. Cannot disable plugins."))
    return
  }

  for (const name of names) {
    const entry = json.plugins.find(
      (e) => extractPluginName(e.source) === name || e.source === name,
    )
    if (!entry) {
      console.log(styleText("yellow", `⚠ Plugin "${name}" not found in quartz.config.yaml`))
      continue
    }
    if (!entry.enabled) {
      console.log(styleText("gray", `✓ ${name} is already disabled`))
      continue
    }
    entry.enabled = false
    console.log(styleText("green", `✓ Disabled ${name}`))
  }

  writePluginsJson(json)
}

export async function handlePluginConfig(name, options = {}) {
  const json = readPluginsJson()
  if (!json) {
    console.log(styleText("red", "✗ No quartz.config.yaml found."))
    return
  }

  const entry = json.plugins.find((e) => extractPluginName(e.source) === name || e.source === name)
  if (!entry) {
    console.log(styleText("red", `✗ Plugin "${name}" not found in quartz.config.yaml`))
    return
  }

  if (options.set) {
    const eqIndex = options.set.indexOf("=")
    if (eqIndex === -1) {
      console.log(styleText("red", "✗ Invalid format. Use: --set key=value"))
      return
    }
    const key = options.set.slice(0, eqIndex)
    let value = options.set.slice(eqIndex + 1)

    try {
      value = JSON.parse(value)
    } catch {}

    if (!entry.options) entry.options = {}
    entry.options[key] = value
    writePluginsJson(json)
    console.log(styleText("green", `✓ Set ${name}.${key} = ${JSON.stringify(value)}`))
  } else {
    console.log(styleText("bold", `Plugin: ${name}`))
    console.log(`  Source: ${entry.source}`)
    console.log(`  Enabled: ${entry.enabled}`)
    console.log(`  Order: ${entry.order ?? 50}`)
    if (entry.options && Object.keys(entry.options).length > 0) {
      console.log(`  Options:`)
      for (const [k, v] of Object.entries(entry.options)) {
        console.log(`    ${k}: ${JSON.stringify(v)}`)
      }
    } else {
      console.log(`  Options: (none)`)
    }
    if (entry.layout) {
      console.log(`  Layout:`)
      for (const [k, v] of Object.entries(entry.layout)) {
        console.log(`    ${k}: ${JSON.stringify(v)}`)
      }
    }
  }
}

export async function handlePluginCheck() {
  const lockfile = readLockfile()
  if (!lockfile || Object.keys(lockfile.plugins).length === 0) {
    console.log(styleText("gray", "No plugins installed"))
    return
  }

  console.log(styleText("bold", "Checking for plugin updates...\n"))

  const results = []
  for (const [name, entry] of Object.entries(lockfile.plugins)) {
    // Local plugins: show "local" status, skip git checks
    if (entry.commit === "local") {
      results.push({
        name,
        installed: "local",
        latest: "—",
        status: "local",
      })
      continue
    }

    try {
      const lsRemoteRef = entry.ref
        ? `refs/heads/${validateGitRef(entry.ref, "plugin ref")}`
        : "HEAD"
      const latestCommit = git(["ls-remote", "--", entry.resolved, lsRemoteRef], {
        encoding: "utf-8",
      })
        .split("\t")[0]
        .trim()

      const isCurrent = latestCommit === entry.commit
      results.push({
        name,
        installed: entry.commit.slice(0, 7),
        latest: latestCommit.slice(0, 7),
        status: isCurrent ? "up to date" : "update available",
      })
    } catch {
      results.push({
        name,
        installed: entry.commit.slice(0, 7),
        latest: "?",
        status: "check failed",
      })
    }
  }

  const nameWidth = Math.max(6, ...results.map((r) => r.name.length)) + 2
  const header = `${"Plugin".padEnd(nameWidth)}${"Installed".padEnd(12)}${"Latest".padEnd(12)}Status`
  console.log(styleText("bold", header))
  console.log("─".repeat(header.length))

  for (const r of results) {
    const color =
      r.status === "up to date" || r.status === "local"
        ? "green"
        : r.status === "check failed"
          ? "red"
          : "yellow"
    console.log(
      `${r.name.padEnd(nameWidth)}${r.installed.padEnd(12)}${r.latest.padEnd(12)}${styleText(
        color,
        r.status,
      )}`,
    )
  }
}

export async function handlePluginUpdate(names) {
  const lockfile = readLockfile()
  if (!lockfile) {
    console.log(styleText("yellow", "⚠ No plugins installed"))
    return
  }

  const pluginsToUpdate = names?.length ? names : Object.keys(lockfile.plugins)
  const updatedPlugins = []
  let failed = 0

  for (const name of pluginsToUpdate) {
    const entry = lockfile.plugins[name]
    if (!entry) {
      console.log(styleText("red", `✗ ${name} is not installed`))
      failed++
      continue
    }

    const pluginDir = path.join(PLUGINS_DIR, name)
    if (!fs.existsSync(pluginDir)) {
      console.log(
        styleText("red", `✗ ${name} directory missing. Run 'npm run quartz -- plugin restore'.`),
      )
      failed++
      continue
    }

    // Local plugins: just rebuild, no git operations
    if (entry.commit === "local") {
      console.log(styleText("cyan", `→ Rebuilding local plugin ${name}...`))
      updatedPlugins.push({ name, pluginDir, lockfileChanged: false })
      continue
    }

    try {
      console.log(styleText("cyan", `→ Updating ${name}...`))
      const previousEntry = { ...entry }
      const fetchArgs = ["fetch", "--depth", "1", "origin"]
      const resetTarget = entry.ref
        ? `origin/${validateGitRef(entry.ref, "plugin ref")}`
        : "origin/HEAD"
      if (entry.ref) {
        fetchArgs.push(validateGitRef(entry.ref, "plugin ref"))
      }
      git(fetchArgs, {
        cwd: pluginDir,
        stdio: "ignore",
      })
      git(["reset", "--hard", resetTarget], { cwd: pluginDir, stdio: "ignore" })

      const newCommit = getGitCommit(pluginDir)
      if (newCommit !== entry.commit) {
        entry.commit = newCommit
        entry.installedAt = new Date().toISOString()
        updatedPlugins.push({ name, pluginDir, previousEntry, lockfileChanged: true })
        console.log(styleText("green", `✓ Updated ${name} to ${newCommit.slice(0, 7)}`))
      } else {
        console.log(styleText("gray", `✓ ${name} already up to date`))
      }
    } catch (error) {
      console.log(styleText("red", `✗ Failed to update ${name}: ${error}`))
      failed++
    }
  }

  let rebuilt = 0
  let lockfileChanged = false
  if (updatedPlugins.length > 0) {
    console.log()
    console.log(styleText("cyan", "→ Rebuilding updated plugins..."))
    for (const plugin of updatedPlugins) {
      const { name, pluginDir } = plugin
      if (buildPlugin(pluginDir, name)) {
        console.log(styleText("green", `  ✓ ${name} rebuilt`))
        rebuilt++
        lockfileChanged ||= plugin.lockfileChanged
      } else {
        failed++
        if (plugin.previousEntry) {
          lockfile.plugins[name] = plugin.previousEntry
        }
      }
    }
  }

  if (rebuilt > 0) {
    await regeneratePluginIndex()
  }
  if (lockfileChanged) {
    writeLockfile(lockfile)
    console.log()
    console.log(styleText("gray", "Updated quartz.lock.json"))
  }

  throwIfPluginFailures("update", failed)
}

export async function handlePluginList() {
  const lockfile = readLockfile()
  if (!lockfile || Object.keys(lockfile.plugins).length === 0) {
    console.log(styleText("gray", "No plugins installed"))
    return
  }

  console.log(styleText("bold", "Installed Plugins:"))
  console.log()

  for (const [name, entry] of Object.entries(lockfile.plugins)) {
    const pluginDir = path.join(PLUGINS_DIR, name)
    const exists = fs.existsSync(pluginDir)

    // Local plugins: special display
    if (entry.commit === "local") {
      const isLinked = exists && fs.lstatSync(pluginDir).isSymbolicLink()
      const status = isLinked ? styleText("green", "✓") : styleText("red", "✗")
      console.log(`  ${status} ${styleText("bold", name)}`)
      console.log(`    Source: ${entry.source}`)
      console.log(`    Type: local symlink`)
      console.log(`    Target: ${entry.resolved}`)
      console.log(`    Installed: ${new Date(entry.installedAt).toLocaleDateString()}`)
      console.log()
      continue
    }

    let currentCommit = entry.commit

    if (exists) {
      currentCommit = getGitCommit(pluginDir)
    }

    const status = exists
      ? currentCommit === entry.commit
        ? styleText("green", "✓")
        : styleText("yellow", "⚡")
      : styleText("red", "✗")

    console.log(`  ${status} ${styleText("bold", name)}`)
    console.log(`    Source: ${entry.source}`)
    console.log(`    Commit: ${entry.commit.slice(0, 7)}`)
    if (currentCommit !== entry.commit && exists) {
      console.log(`    Current: ${currentCommit.slice(0, 7)} (modified)`)
    }
    console.log(`    Installed: ${new Date(entry.installedAt).toLocaleDateString()}`)
    console.log()
  }
}

export async function handlePluginRestore({ enabledOnly = false } = {}) {
  const lockfile = readLockfile()
  if (!lockfile) {
    const message = "No quartz.lock.json found. Cannot restore."
    console.log(styleText("red", `✗ ${message}`))
    console.log()
    console.log("Run 'npx quartz plugin add <repo>' to install plugins from scratch.")
    throw new Error(message)
  }

  console.log(
    styleText(
      "cyan",
      enabledOnly
        ? "→ Restoring enabled plugins from lockfile..."
        : "→ Restoring plugins from lockfile...",
    ),
  )
  console.log()

  const pluginsDir = path.join(process.cwd(), ".quartz", "plugins")
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true })
  }

  let installed = 0
  let failed = 0
  const restoredPlugins = []

  for (const [name, entry] of getLockfilePluginEntries(lockfile, { enabledOnly })) {
    const pluginDir = path.join(pluginsDir, name)

    // Local plugin: re-symlink and rebuild if the existing link is incomplete.
    if (entry.commit === "local") {
      const localTarget = path.resolve(entry.resolved)
      try {
        if (!fs.existsSync(localTarget)) {
          console.log(styleText("red", `  ✗ ${name}: local path missing: ${entry.resolved}`))
          failed++
          continue
        }

        if (pluginPathExists(pluginDir)) {
          const stat = fs.lstatSync(pluginDir)
          let alreadyLinked = false
          if (stat.isSymbolicLink()) {
            try {
              alreadyLinked = fs.realpathSync(pluginDir) === fs.realpathSync(localTarget)
            } catch {}
          }

          if (alreadyLinked) {
            if (needsBuild(pluginDir)) {
              console.log(styleText("cyan", `→ ${name}: local symlink exists, rebuilding...`))
              restoredPlugins.push({ name, pluginDir })
            } else {
              console.log(styleText("gray", `✓ ${name} already restored (local symlink)`))
            }
            installed++
            continue
          }

          console.log(styleText("cyan", `→ ${name}: replacing existing local plugin...`))
          removePluginDir(pluginDir)
        }

        fs.mkdirSync(path.dirname(pluginDir), { recursive: true })
        fs.symlinkSync(localTarget, pluginDir, "dir")
        console.log(styleText("green", `✓ ${name} restored (local symlink)`))
        restoredPlugins.push({ name, pluginDir })
        installed++
      } catch {
        console.log(styleText("red", `✗ ${name}: failed to restore local symlink`))
        failed++
      }
      continue
    }

    try {
      if (pluginPathExists(pluginDir)) {
        const currentCommit = getGitCommit(pluginDir)
        if (currentCommit === entry.commit) {
          if (needsBuild(pluginDir)) {
            console.log(
              styleText("cyan", `→ ${name}: locked commit present, rebuilding missing dist...`),
            )
            restoredPlugins.push({ name, pluginDir })
          } else {
            console.log(styleText("gray", `✓ ${name}@${entry.commit.slice(0, 7)} already restored`))
          }
          installed++
          continue
        }

        console.log(
          styleText(
            "yellow",
            `⚠ ${name}: existing ${currentCommit.slice(0, 7)} does not match lockfile ${entry.commit.slice(0, 7)}, re-cloning`,
          ),
        )
        removePluginDir(pluginDir)
      }

      console.log(
        styleText("cyan", `→ ${name}: cloning ${entry.resolved}@${entry.commit.slice(0, 7)}...`),
      )
      clonePluginRepo(entry.resolved, pluginDir, entry.ref)
      if (entry.commit !== "unknown") {
        const commit = validateGitCommit(entry.commit, "locked commit")
        git(["fetch", "--depth", "1", "origin", commit], {
          cwd: pluginDir,
          stdio: "ignore",
        })
        git(["checkout", commit], {
          cwd: pluginDir,
          stdio: "ignore",
        })
      }
      console.log(styleText("green", `✓ ${name} restored`))
      restoredPlugins.push({ name, pluginDir })
      installed++
    } catch {
      console.log(styleText("red", `✗ ${name}: failed to restore`))
      failed++
    }
  }

  if (restoredPlugins.length > 0) {
    console.log()
    console.log(styleText("cyan", "→ Building restored plugins..."))
    for (const { name, pluginDir } of restoredPlugins) {
      if (!buildPlugin(pluginDir, name)) {
        failed++
        installed--
      } else {
        console.log(styleText("green", `  ✓ ${name} built`))
      }
    }
  }

  await regeneratePluginIndex()

  console.log()
  if (failed === 0) {
    console.log(styleText("green", `✓ Restored ${installed} plugin(s)`))
  } else {
    console.log(styleText("red", `✗ Restored ${installed} plugin(s), ${failed} failed`))
    throwIfPluginFailures("restore", failed)
  }
}

export async function handlePluginPrune({ dryRun = false } = {}) {
  const lockfile = readLockfile()
  if (!lockfile || Object.keys(lockfile.plugins).length === 0) {
    console.log(styleText("gray", "No plugins installed"))
    return
  }

  const pluginsJson = readPluginsJson()
  const configuredNames = new Set(
    (pluginsJson?.plugins ?? []).map((entry) => extractPluginName(entry.source)),
  )

  const orphans = Object.keys(lockfile.plugins).filter((name) => !configuredNames.has(name))

  if (orphans.length === 0) {
    console.log(styleText("green", "✓ No orphaned plugins found — nothing to prune"))
    return
  }

  console.log(`Found ${orphans.length} orphaned plugin(s):\n`)
  for (const name of orphans) {
    console.log(`  ${styleText("yellow", name)} — in lockfile but not in config`)
  }
  console.log()

  if (dryRun) {
    console.log(styleText("cyan", "Dry run — no changes made. Re-run without --dry-run to prune."))
    return
  }

  let removed = 0
  for (const name of orphans) {
    const pluginDir = path.join(PLUGINS_DIR, name)

    console.log(styleText("cyan", `→ Removing ${name}...`))

    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true })
    }

    delete lockfile.plugins[name]
    console.log(styleText("green", `✓ Removed ${name}`))
    removed++
  }

  if (removed > 0) {
    await regeneratePluginIndex()
  }

  writeLockfile(lockfile)
  console.log()
  console.log(styleText("green", `✓ Pruned ${removed} plugin(s)`))
  console.log(styleText("gray", "Updated quartz.lock.json"))
}

export async function handlePluginResolve({ dryRun = false } = {}) {
  const pluginsJson = readPluginsJson()
  if (!pluginsJson?.plugins || pluginsJson.plugins.length === 0) {
    console.log(styleText("gray", "No plugins configured"))
    return
  }

  let lockfile = readLockfile()
  if (!lockfile) {
    lockfile = { version: "1.0.0", plugins: {} }
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  }

  // Find config entries whose source is a git/local-resolvable URL and not yet in lockfile
  const missing = pluginsJson.plugins.filter((entry) => {
    const name = extractPluginName(entry.source)
    if (lockfile.plugins[name]) return false
    // Only attempt sources that parseGitSource can handle (git URLs + local paths)
    const src = entry.source
    return (
      src.startsWith("github:") ||
      src.startsWith("git+") ||
      src.startsWith("https://") ||
      isLocalSource(src)
    )
  })

  if (missing.length === 0) {
    console.log(styleText("green", "✓ All configured plugins are already installed"))
    return
  }

  console.log(`Found ${missing.length} uninstalled plugin(s) in config:\n`)
  for (const entry of missing) {
    const name = extractPluginName(entry.source)
    console.log(`  ${styleText("yellow", name)} — ${entry.source}`)
  }
  console.log()

  if (dryRun) {
    console.log(
      styleText("cyan", "Dry run — no changes made. Re-run without --dry-run to resolve."),
    )
    return
  }

  const installed = []
  const builtPlugins = []
  let failed = 0

  for (const entry of missing) {
    try {
      const { name, url, ref, local } = parseGitSource(entry.source)
      const pluginDir = path.join(PLUGINS_DIR, name)

      if (fs.existsSync(pluginDir)) {
        if (local) {
          console.log(styleText("yellow", `⚠ ${name} directory already exists, updating lockfile`))
          lockfile.plugins[name] = {
            source: entry.source,
            resolved: url,
            commit: "local",
            installedAt: new Date().toISOString(),
          }
          installed.push({ name, pluginDir, created: false })
          continue
        }
        console.log(styleText("yellow", `⚠ ${name} directory already exists, updating lockfile`))
        const commit = getGitCommit(pluginDir)
        lockfile.plugins[name] = {
          source: entry.source,
          resolved: url,
          commit,
          ...(ref && { ref }),
          installedAt: new Date().toISOString(),
        }
        installed.push({ name, pluginDir, created: false })
        continue
      }

      if (local) {
        // Local path: symlink
        const resolvedPath = path.resolve(url)
        if (!fs.existsSync(resolvedPath)) {
          console.log(styleText("red", `✗ Local path does not exist: ${resolvedPath}`))
          failed++
          continue
        }
        console.log(styleText("cyan", `→ Linking ${name} from ${resolvedPath}...`))
        fs.mkdirSync(path.dirname(pluginDir), { recursive: true })
        fs.symlinkSync(resolvedPath, pluginDir, "dir")
        lockfile.plugins[name] = {
          source: entry.source,
          resolved: resolvedPath,
          commit: "local",
          installedAt: new Date().toISOString(),
        }
        installed.push({ name, pluginDir, created: true })
        console.log(styleText("green", `✓ Linked ${name} (local)`))
      } else {
        console.log(styleText("cyan", `→ Cloning ${name} from ${url}...`))

        clonePluginRepo(url, pluginDir, ref)

        const commit = getGitCommit(pluginDir)
        lockfile.plugins[name] = {
          source: entry.source,
          resolved: url,
          commit,
          ...(ref && { ref }),
          installedAt: new Date().toISOString(),
        }

        installed.push({ name, pluginDir, created: true })
        console.log(styleText("green", `✓ Cloned ${name}@${commit.slice(0, 7)}`))
      }
    } catch (error) {
      console.log(styleText("red", `✗ Failed to resolve ${entry.source}: ${error}`))
      failed++
    }
  }

  if (installed.length > 0) {
    console.log()
    console.log(styleText("cyan", "→ Building plugins..."))
    for (const plugin of installed) {
      const { name, pluginDir } = plugin
      if (!buildPlugin(pluginDir, name)) {
        failed++
        delete lockfile.plugins[name]
        if (plugin.created) {
          removePluginDir(pluginDir)
        }
      } else {
        console.log(styleText("green", `  ✓ ${name} built`))
        builtPlugins.push(plugin)
      }
    }
  }

  if (builtPlugins.length > 0) {
    await regeneratePluginIndex()
    writeLockfile(lockfile)
  }

  console.log()
  if (failed === 0) {
    console.log(styleText("green", `✓ Resolved ${builtPlugins.length} plugin(s)`))
  } else {
    console.log(styleText("red", `✗ Resolved ${builtPlugins.length} plugin(s), ${failed} failed`))
    throwIfPluginFailures("resolve", failed)
  }
  if (builtPlugins.length > 0) {
    console.log(styleText("gray", "Updated quartz.lock.json"))
  }
}
