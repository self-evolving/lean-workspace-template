import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { fileURLToPath } from "node:url"

import {
  computeStatusesAndEdges,
  githubSourceUrl,
  loadBlueprintConfig,
  parsePlanTex,
  repoRelativePath,
} from "./blueprint-model.mjs"
import { weaveLeanToMd } from "./lean-weave.mjs"
import {
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
