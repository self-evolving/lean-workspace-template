import { frameRegistry } from "../../components/frames/registry"
import { PluginManifest } from "./types"
import { PageFrame } from "../../components/frames/types"
import { getPluginSubpathEntry, toFileUrl } from "./gitLoader"

export async function loadFramesFromPackage(
  pluginName: string,
  manifest: PluginManifest | null,
  subdir?: string,
): Promise<void> {
  if (!manifest?.frames) return

  try {
    const framesPath = getPluginSubpathEntry(pluginName, "./frames", subdir)

    let framesModule: Record<string, unknown>
    if (framesPath) {
      framesModule = await import(toFileUrl(framesPath))
    } else {
      framesModule = await import(`${pluginName}/frames`)
    }

    for (const [exportName, _frameMeta] of Object.entries(manifest.frames)) {
      const frame = framesModule[exportName]
      if (!frame) {
        throw new Error(
          `Frame "${exportName}" declared in manifest but not found in ${pluginName}/frames`,
        )
      }

      const pageFrame = frame as PageFrame
      if (!pageFrame.name || typeof pageFrame.render !== "function") {
        throw new Error(
          `Frame "${exportName}" from ${pluginName} is not a valid PageFrame (missing name or render)`,
        )
      }

      // Register under the frame's declared name
      frameRegistry.register(pageFrame.name, pageFrame, pluginName)
    }
  } catch (err) {
    if (manifest.frames && Object.keys(manifest.frames).length > 0) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Plugin "${pluginName}" declares frames but failed to load them: ${message}`)
    }
  }
}
