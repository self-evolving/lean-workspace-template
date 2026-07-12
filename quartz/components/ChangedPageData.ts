import { FilePath, FullSlug, slugifyFilePath } from "../util/path"
// blueprint-as-source patch: shared .lean page-source slug normalization
// @ts-ignore -- plain mjs, no type declarations
import { leanAwareSlugPath } from "../../scripts/lib/lean-weave.mjs"

const changedFilesEnv = "SEPO_PREVIEW_CHANGED_FILES_JSON"

export type ChangedPage = {
  sourcePath: string
  slug: FullSlug
}

let cachedRaw: string | undefined
let cachedChangedPages: ChangedPage[] | undefined

function envValue(name: string) {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export function normalizeSourcePath(path: string) {
  let normalized = path.trim().replaceAll("\\", "/")
  while (normalized.startsWith("./")) normalized = normalized.slice(2)
  if (normalized.startsWith("content/")) normalized = normalized.slice("content/".length)
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return undefined
  }

  const lower = normalized.toLowerCase()
  if (!lower.endsWith(".md") && !lower.endsWith(".lean")) return undefined
  return normalized
}

function sourcePathToSlug(sourcePath: string) {
  return slugifyFilePath(leanAwareSlugPath(sourcePath) as FilePath)
}

export function previewChangedPages(): ChangedPage[] {
  const raw = envValue(changedFilesEnv)
  if (!raw) {
    cachedRaw = raw
    cachedChangedPages = []
    return cachedChangedPages
  }

  if (raw === cachedRaw && cachedChangedPages) return cachedChangedPages

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${changedFilesEnv} must be a JSON array of changed content paths`, {
      cause: error,
    })
  }

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${changedFilesEnv} must be a JSON array of changed content paths`)
  }

  const changedPages: ChangedPage[] = []
  const seenSources = new Set<string>()
  for (const entry of parsed) {
    const sourcePath = normalizeSourcePath(entry)
    if (!sourcePath || seenSources.has(sourcePath)) continue
    seenSources.add(sourcePath)
    changedPages.push({ sourcePath, slug: sourcePathToSlug(sourcePath) })
  }

  cachedRaw = raw
  cachedChangedPages = changedPages
  return changedPages
}
