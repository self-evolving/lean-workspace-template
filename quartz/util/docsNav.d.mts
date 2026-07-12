import type { FullSlug } from "./path"

export type DocsNavItem = {
  title: string
  slug: FullSlug
  children?: DocsNavItem[]
  /** Generated page kind from _meta.json, used for nav affordances. */
  pageType?: string
  /** Root _meta.json only: this folder's pages nest under the navigator's root entry. */
  underRoot?: boolean
}

export type DocsNavData = {
  root: DocsNavItem
  items: DocsNavItem[]
}

export const defaultDocsRoot: string
export const defaultDocsSlugPrefix: string

export function buildDocsNav(options?: {
  docsRoot?: string
  slugPrefix?: string
  ignorePatterns?: string[]
}): DocsNavData
