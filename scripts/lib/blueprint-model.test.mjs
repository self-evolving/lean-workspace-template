import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { fileURLToPath } from "node:url"

import {
  bakeSnippets,
  buildSourceModel,
  collectLeanDeclNames,
  computeStatusesAndEdges,
  declSnippet,
  githubSourceUrl,
  loadBlueprintConfig,
  parsePlanTex,
  repoRelativePath,
  stripBlueprintAttributes,
} from "./blueprint-model.mjs"
import { weaveLeanToMd } from "./lean-weave.mjs"
import {
  chapterHref,
  firstLeanDeclName,
  itemDeclForCode,
  itemDisplayTitle,
  itemHeadingTitle,
  itemMetaLabel,
} from "../../quartz/plugins/local/blueprint/index.js"

function item(overrides) {
  return {
    label: "item:default",
    kind: "theorem",
    leanDeclNames: [],
    stmtUses: [],
    stmtUsesGiven: false,
    proofUses: [],
    proofUsesGiven: false,
    ...overrides,
  }
}

function decl(name, { typeUses = [], valueUses = [], hasSorry = false } = {}) {
  return { name, typeUses, valueUses, usedConstants: [...typeUses, ...valueUses], hasSorry }
}

function withWarnings(fn) {
  const originalWarn = console.warn
  const warnings = []
  console.warn = (message) => warnings.push(String(message))
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = originalWarn
  }
}

function model(items, kernelEntries) {
  return {
    items,
    itemByLabel: new Map(items.map((entry) => [entry.label, entry])),
    kernel: new Map(kernelEntries.map((entry) => [entry.name, entry])),
  }
}

function withTempRepo(config, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-config-"))
  try {
    if (config) {
      fs.writeFileSync(path.join(dir, "blueprint.config.json"), JSON.stringify(config, null, 2))
    }
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("loadBlueprintConfig defaults to the content blueprint root", () => {
  withTempRepo(null, (repo) => {
    const cfg = loadBlueprintConfig(repo)

    assert.equal(cfg.contentRoot, "content")
    assert.equal(cfg.contentDir, path.join(repo, "content"))
    assert.equal(cfg.blueprintDir, path.join(repo, "content", "blueprint"))
    assert.equal(cfg.dataPath, path.join(repo, "content", "blueprint", "blueprint-data.json"))
    assert.deepEqual(cfg.leanSrcDirs, [path.join(repo, "content", "blueprint")])
  })
})

test("loadBlueprintConfig resolves a custom content root", () => {
  withTempRepo(
    {
      contentRoot: "site",
      blueprints: [{ root: "blueprint", lakeRoots: ["Demo"] }],
    },
    (repo) => {
      const cfg = loadBlueprintConfig(repo)

      assert.equal(cfg.contentRoot, "site")
      assert.equal(cfg.contentDir, path.join(repo, "site"))
      assert.equal(cfg.blueprintDir, path.join(repo, "site", "blueprint"))
      assert.equal(cfg.dataPath, path.join(repo, "site", "blueprint", "blueprint-data.json"))
      assert.deepEqual(cfg.leanSrcDirs, [path.join(repo, "site", "blueprint")])
    },
  )
})

test("loadBlueprintConfig allows per-blueprint contentRoot overrides", () => {
  withTempRepo(
    {
      contentRoot: "content",
      blueprints: [{ contentRoot: "site", root: "formalization" }],
    },
    (repo) => {
      const cfg = loadBlueprintConfig(repo)

      assert.equal(cfg.contentRoot, "site")
      assert.equal(cfg.blueprintDir, path.join(repo, "site", "formalization"))
      assert.equal(cfg.dataPath, path.join(repo, "site", "formalization", "blueprint-data.json"))
    },
  )
})

test('explicit uses="" prunes inferred dependencies without plan/kernel warning', () => {
  const helper = item({
    label: "def:helper",
    kind: "definition",
    leanDeclNames: ["Demo.helper"],
  })
  const main = item({
    label: "thm:main",
    leanDeclNames: ["Demo.main"],
    stmtUses: [],
    stmtUsesGiven: true,
  })
  const { items, itemByLabel, kernel } = model(
    [helper, main],
    [decl("Demo.helper"), decl("Demo.main", { typeUses: ["Demo.helper"] })],
  )

  const { result: edges, warnings } = withWarnings(() =>
    computeStatusesAndEdges(items, itemByLabel, kernel),
  )

  assert.deepEqual(main.effStmtUses, [])
  assert.deepEqual(edges, [])
  assert.deepEqual(
    warnings.filter((warning) => warning.startsWith("plan/kernel:")),
    [],
  )
})

test("explicit dependencies absent from kernel inference still warn", () => {
  const extra = item({
    label: "def:extra",
    kind: "definition",
    leanDeclNames: ["Demo.extra"],
  })
  const main = item({
    label: "thm:main",
    leanDeclNames: ["Demo.main"],
    stmtUses: ["def:extra"],
    stmtUsesGiven: true,
  })
  const { items, itemByLabel, kernel } = model(
    [extra, main],
    [decl("Demo.extra"), decl("Demo.main")],
  )

  const { warnings } = withWarnings(() => computeStatusesAndEdges(items, itemByLabel, kernel))

  assert.deepEqual(main.effStmtUses, ["def:extra"])
  assert.deepEqual(
    warnings.filter((warning) => warning.startsWith("plan/kernel:")),
    ["plan/kernel: thm:main declares def:extra in uses=, but the kernel did not infer it"],
  )
})

test("repoRelativePath returns a posix path under the repository root", () => {
  const repoRoot = path.join(path.sep, "tmp", "workspace")
  const absPath = path.join(repoRoot, "lean", "Demo", "Main.lean")

  assert.equal(repoRelativePath(repoRoot, absPath), "lean/Demo/Main.lean")
})

test("githubSourceUrl builds line range links", () => {
  assert.equal(
    githubSourceUrl("self-evolving/lean-workspace-template", "lean/Demo.lean", {
      ref: "abc123",
      startLine: 12,
      endLine: 18,
    }),
    "https://github.com/self-evolving/lean-workspace-template/blob/abc123/lean/Demo.lean#L12-L18",
  )
})

test("blueprint prose headings keep reference identity with the title", () => {
  const theorem = { kind: "theorem", number: "1.3", title: "Theorem 1.3 · Sum of odd numbers" }

  assert.equal(itemDisplayTitle(theorem), "Sum of odd numbers")
  assert.equal(itemMetaLabel(theorem), "Theorem 1.3")
  assert.equal(itemHeadingTitle(theorem), "Theorem 1.3 · Sum of odd numbers")
  assert.equal(itemHeadingTitle({ title: "Standalone heading" }), "Standalone heading")
})

test("Lean source-row matching only infers exact declaration-backed code blocks", () => {
  const item = { leanDeclNames: ["Demo.sumOdds", "Demo.sumOdds_succ"] }

  assert.equal(
    firstLeanDeclName("namespace Demo\n\n/-- doc -/\ndef sumOdds : Nat := 0\n"),
    "Demo.sumOdds",
  )
  assert.equal(
    itemDeclForCode(item, "namespace Demo\n\ntheorem sumOdds_succ : True := by trivial"),
    "Demo.sumOdds_succ",
  )
  assert.equal(itemDeclForCode(item, "/-- doc -/\ntheorem sumOdds_succ : True := by trivial"), null)
  assert.equal(itemDeclForCode(item, "namespace Other\n\ndef sumOdds : Nat := 0"), null)
  assert.equal(itemDeclForCode(item, "#check Demo.sumOdds"), null)
  assert.equal(itemDeclForCode(item, "def unrelated : Nat := 0"), null)
})

test("woven Lean blocks carry exact source declaration metadata", () => {
  const { md } = weaveLeanToMd(`/-! # Demo

## Definition: sumOdds {#def:sumOdds lean=next}
-/
namespace Demo

/-- doc -/
def sumOdds : Nat := 0

/-! ## Lemma: sumOdds-succ {#lemma:sumOdds-succ lean=next}
-/
/-- doc -/
theorem sumOdds_succ : True := by
  trivial
`)

  assert.match(md, /```lean sourceDecl="Demo\.sumOdds"/)
  assert.match(md, /```lean sourceDecl="Demo\.sumOdds_succ"/)
})

test("parsePlanTex parses the leanblueprint-convention fixture", () => {
  const fixture = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "leanblueprint-plan.tex",
  )
  const chapters = parsePlanTex(fs.readFileSync(fixture, "utf8"))
  const items = chapters.flatMap((c) => c.items)

  assert.ok(chapters.length >= 1, "at least one \\chapter")
  assert.ok(items.length >= 3, "several items parsed")
  const withLean = items.find((it) => it.leanNames.length > 0)
  assert.ok(withLean, "some item carries \\lean{...}")
  const withUses = items.find((it) => it.uses.length > 0 || (it.proof?.uses.length ?? 0) > 0)
  assert.ok(withUses, "some item carries \\uses{...}")
  for (const it of items) {
    assert.ok(it.label, `item has a \\label (${it.kind})`)
    assert.ok(["definition", "lemma", "proposition", "theorem", "corollary"].includes(it.kind))
  }
})

test("buildSourceModel: part folders recurse one level with global numbering", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-parts-"))
  fs.writeFileSync(
    path.join(dir, "_meta.json"),
    JSON.stringify({ label: "L", pages: ["01-intro", "1-part-one"] }),
  )
  fs.writeFileSync(
    path.join(dir, "01-intro.md"),
    '---\ntitle: "Intro"\n---\n\n## Definition: a {#def:a}\n\nA.\n',
  )
  fs.mkdirSync(path.join(dir, "1-part-one"))
  fs.writeFileSync(
    path.join(dir, "1-part-one", "_meta.json"),
    JSON.stringify({ label: "Part One", pages: ["02-inner"] }),
  )
  fs.writeFileSync(
    path.join(dir, "1-part-one", "02-inner.md"),
    '---\ntitle: "Inner"\n---\n\n## Lemma: b {#lem:b uses="def:a"}\n\nB.\n',
  )
  const model = buildSourceModel({ blueprintDir: dir, dataPath: null, leanSrcDirs: [dir] })
  assert.deepEqual(
    model.chapters.map((c) => [c.num, c.slug]),
    [
      [1, "01-intro"],
      [2, "1-part-one/02-inner"],
    ],
  )
  // cross-folder reference target resolves through the shared label index
  assert.ok(model.itemByLabel.has("def:a"))
  assert.equal(model.itemByLabel.get("lem:b").chapter.slug, "1-part-one/02-inner")
})

test("chapterHref: folder-index root page and cross-folder chapters resolve correctly", () => {
  const flat = { label: "x", chapter: { slug: "01-alpha" } }
  const foldered = { label: "y", chapter: { slug: "1-part/02-beta" } }
  // from the blueprint index (folder-index page: links resolve inside the folder)
  assert.equal(chapterHref("blueprint", flat, "blueprint"), "01-alpha.md#x")
  assert.equal(chapterHref("blueprint", foldered, "blueprint"), "1-part/02-beta.md#y")
  // from a root-level chapter into a part folder and back
  assert.equal(chapterHref("blueprint/01-alpha", foldered, "blueprint"), "1-part/02-beta.md#y")
  assert.equal(chapterHref("blueprint/1-part/02-beta", flat, "blueprint"), "../01-alpha.md#x")
  // same page
  assert.equal(chapterHref("blueprint/01-alpha", flat, "blueprint"), "#x")
})

test("collectLeanDeclNames: headings only, .lean chapters, part folders, fences skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-decls-"))
  fs.writeFileSync(
    path.join(dir, "01-a.md"),
    '## Definition: x {#x lean="B.b, A.a"}\n\n## Lemma: y {#y lean=C.c uses="x"}\n' +
      '\nProse mentioning lean="Prose.ignored" stays out.\n' +
      '\n```md\n## Lemma: fake {#f lean="Fence.ignored"}\n```\n',
  )
  fs.writeFileSync(
    path.join(dir, "02-b.md"),
    '## Definition: z {#z lean="A.a"}\n\n## Definition: w {#w lean=next}\n',
  )
  // literate .lean chapter: explicit lean= headings inside doc blocks count
  fs.writeFileSync(
    path.join(dir, "Ch03_Lit.lean"),
    '/-! # Chapter\n\n## Lemma: lit {#lem:lit lean="D.d"}\n-/\ntheorem d : True := trivial\n',
  )
  // part folder: one level deep, matching the source model
  fs.mkdirSync(path.join(dir, "1-part"))
  fs.writeFileSync(path.join(dir, "1-part", "04-c.md"), '## Definition: q {#q lean="E.e"}\n')
  fs.writeFileSync(path.join(dir, "notes.txt"), 'lean="Ignored.name"\n')
  assert.deepEqual(collectLeanDeclNames(dir), ["A.a", "B.b", "C.c", "D.d", "E.e"])
  // missing directory degrades to an empty list, not a throw
  assert.deepEqual(collectLeanDeclNames(path.join(dir, "nope")), [])
})

test("bakeSnippets + declSnippet fallback: deploys render from baked text", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-bake-"))
  fs.mkdirSync(path.join(dir, "Lib"))
  fs.writeFileSync(
    path.join(dir, "Lib", "Defs.lean"),
    "import Foo\n\n/-- The answer. -/\n@[simp]\ndef answer : Nat := 42\n",
  )
  const data = {
    decls: [
      { name: "Lib.answer", file: "Lib/Defs.lean", startLine: 5, endLine: 5 },
      { name: "Lib.ghost", file: "Lib/Gone.lean", startLine: 1, endLine: 1 },
      { name: "Lib.noloc" },
    ],
  }
  const { baked, missing } = bakeSnippets(data, [dir])
  assert.equal(baked, 1)
  assert.equal(missing, 1)
  // baked snippet extends upward through the attribute and doc comment
  assert.equal(data.decls[0].snippet.startLine, 3)
  assert.match(data.decls[0].snippet.code, /^\/-- The answer\. -\/\n@\[simp\]\ndef answer/)
  assert.equal(data.decls[1].snippet, undefined)

  // site-build time, no checkout: declSnippet falls back to the baked text
  const s = declSnippet(data.decls[0], [path.join(dir, "nonexistent")])
  assert.equal(s.absPath, null)
  assert.equal(s.baseDir, null)
  assert.equal(s.startLine, 3)
  assert.match(s.code, /def answer/)
  // disk still wins when the file is present (fresh edits beat stale bakes)
  const live = declSnippet(data.decls[0], [dir])
  assert.ok(live.absPath)
  // no baked text and no file -> null, as before
  assert.equal(declSnippet(data.decls[1], [path.join(dir, "nonexistent")]), null)
})

test("stripBlueprintAttributes: removes blueprint attrs, keeps co-attributes", () => {
  const real = [
    "@[blueprint",
    '  "first-gap-def"',
    '  (title := "First prime gap")',
    "  (statement := /--",
    "  $P(g)$ is the first prime $p_n$ for which the prime gap",
    "  $p_{n+1}-p_n$ is equal to $g$, or $0$ if no such gap",
    "  exists. -/)]",
    "noncomputable def first_gap (g : ℕ) : ℕ :=",
    "  if h : ∃ n, nth_prime_gap n = g then",
    "    nth_prime (Nat.find h)",
    "  else 0",
  ].join("\n")
  const stripped = stripBlueprintAttributes(real)
  assert.equal(stripped.split("\n")[0], "noncomputable def first_gap (g : ℕ) : ℕ :=")
  assert.ok(!stripped.includes("@[blueprint"))

  // co-attributes survive
  assert.equal(
    stripBlueprintAttributes('@[simp, blueprint "x" (title := "T")]\ndef foo := 1'),
    "@[simp]\ndef foo := 1",
  )
  // brackets inside the statement doc-comment do not truncate the scan
  assert.equal(
    stripBlueprintAttributes(
      '@[blueprint "y"\n  (statement := /-- interval $[0,1]$ and list [a, b] -/)]\ntheorem bar : True := trivial',
    ),
    "theorem bar : True := trivial",
  )
  // regular doc comments and unannotated code pass through unchanged
  const plain = "/-- real docstring -/\ndef plain := 2"
  assert.equal(stripBlueprintAttributes(plain), plain)
})
