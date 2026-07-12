import assert from "node:assert/strict"
import test from "node:test"
import render from "preact-render-to-string"
import ChangedPageBannerConstructor, {
  changedPageForFileData,
  previewChangedPages,
} from "./ChangedPageBanner.tsx"
import PreviewDeploymentBannerConstructor from "./PreviewDeploymentBanner.tsx"

const originalEnv = {
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  SEPO_PREVIEW_CHANGED_FILES_JSON: process.env.SEPO_PREVIEW_CHANGED_FILES_JSON,
  SEPO_PREVIEW_PR: process.env.SEPO_PREVIEW_PR,
}

function setPreviewEnv(changedFiles) {
  process.env.GITHUB_REPOSITORY = "self-evolving/lean-workspace-template"
  process.env.SEPO_PREVIEW_PR = "63"
  if (changedFiles === undefined) {
    delete process.env.SEPO_PREVIEW_CHANGED_FILES_JSON
  } else {
    process.env.SEPO_PREVIEW_CHANGED_FILES_JSON = JSON.stringify(changedFiles)
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function props(fileData) {
  return {
    fileData,
    children: [],
  }
}

test.afterEach(restoreEnv)

test("changed markdown page renders the changed-page banner", () => {
  setPreviewEnv(["content/docs/quick-start.md"])

  const Banner = ChangedPageBannerConstructor()
  const html = render(
    Banner(props({ relativePath: "docs/quick-start.md", slug: "docs/quick-start" })),
  )

  assert.match(html, /This page is changed in this PR/)
  assert.match(html, /docs\/quick-start\.md/)
  assert.match(html, /\/pull\/63\/files/)
})

test("preview banner lists changed pages for quick navigation", () => {
  setPreviewEnv(["content/index.md", "content/docs/quick-start.md"])

  const Banner = PreviewDeploymentBannerConstructor()
  const html = render(Banner(props({ relativePath: "docs/reference.md", slug: "docs/reference" })))

  assert.match(html, /Changed \(2\)/)
  assert.match(html, /index\.md/)
  assert.match(html, /docs\/quick-start\.md/)
  assert.match(html, /class="sepo-preview-changed-page-link"/)
})

test("preview banner omits changed-pages dropdown without changed page env", () => {
  setPreviewEnv(undefined)

  const Banner = PreviewDeploymentBannerConstructor()
  const html = render(Banner(props({ relativePath: "docs/reference.md", slug: "docs/reference" })))

  assert.doesNotMatch(html, /<details class="sepo-preview-changed-pages"/)
})

test("unchanged markdown page does not render the changed-page banner", () => {
  setPreviewEnv(["content/docs/quick-start.md"])

  const Banner = ChangedPageBannerConstructor()
  const html = render(Banner(props({ relativePath: "docs/other.md", slug: "docs/other" })))

  assert.equal(html, "")
})

test("changed literate lean page maps through lean-aware slug normalization", () => {
  setPreviewEnv(["content/blueprint/Ch01_SumsOfOddNumbers.lean"])

  const changedPage = changedPageForFileData({
    relativePath: "blueprint/Ch01_SumsOfOddNumbers.lean",
    slug: "blueprint/ch01_sumsofoddnumbers",
  })

  assert.deepEqual(changedPage, {
    sourcePath: "blueprint/Ch01_SumsOfOddNumbers.lean",
    slug: "blueprint/ch01_sumsofoddnumbers",
  })
})

test("non-page content changes are ignored", () => {
  setPreviewEnv(["content/docs/quick-start.md", "content/image.png", "quartz/styles/custom.scss"])

  assert.deepEqual(previewChangedPages(), [
    { sourcePath: "docs/quick-start.md", slug: "docs/quick-start" },
  ])
})

test("builds without changed page env do not render the changed-page banner", () => {
  setPreviewEnv(undefined)

  const Banner = ChangedPageBannerConstructor()
  const html = render(
    Banner(props({ relativePath: "docs/quick-start.md", slug: "docs/quick-start" })),
  )

  assert.equal(html, "")
})
