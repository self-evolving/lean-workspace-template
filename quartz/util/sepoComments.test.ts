import assert from "node:assert/strict"
import test, { describe } from "node:test"
import {
  deriveSepoCommentsDefaultTab,
  deriveSepoCommentsTabs,
  sepoCommentsContentTabs,
} from "./sepoComments"

describe("Sepo comments drawer config", () => {
  test("defaults to Issues/Pulls when Discussion IDs are absent", () => {
    const plan = deriveSepoCommentsTabs({ hasDiscussionConfig: false })

    assert.equal(plan.ok, true)
    if (plan.ok) {
      assert.deepEqual(plan.tabs, ["issues", "pulls"])
      assert.match(plan.warning ?? "", /removing the Discussions tab/)
    }
  })

  test("keeps all default tabs when Discussion IDs are present", () => {
    const plan = deriveSepoCommentsTabs({ hasDiscussionConfig: true })

    assert.equal(plan.ok, true)
    if (plan.ok) assert.deepEqual(plan.tabs, [...sepoCommentsContentTabs])
  })

  test("leaves explicit Issues/Pulls-only tabs unchanged without Discussion IDs", () => {
    const plan = deriveSepoCommentsTabs({
      requestedTabs: ["issues", "pulls"],
      hasDiscussionConfig: false,
    })

    assert.deepEqual(plan, { ok: true, tabs: ["issues", "pulls"] })
  })

  test("rejects explicit discussions-only config without Discussion IDs", () => {
    const plan = deriveSepoCommentsTabs({
      requestedTabs: ["discussions"],
      hasDiscussionConfig: false,
    })

    assert.equal(plan.ok, false)
    if (!plan.ok) assert.match(plan.reason, /Discussion IDs are not configured/)
  })

  test("rejects an explicit default tab removed from the effective tabs", () => {
    const tabs = deriveSepoCommentsTabs({ hasDiscussionConfig: false })
    assert.equal(tabs.ok, true)
    if (!tabs.ok) return

    const defaultTab = deriveSepoCommentsDefaultTab({
      explicitDefaultTab: "discussions",
      tabs: tabs.tabs,
    })

    assert.equal(defaultTab.ok, false)
    if (!defaultTab.ok) assert.match(defaultTab.reason, /SEPO_COMMENTS_DEFAULT_TAB=discussions/)
  })

  test("defaults PR previews to pulls when the effective tabs include pulls", () => {
    const plan = deriveSepoCommentsDefaultTab({ tabs: ["issues", "pulls"], prNumber: 42 })

    assert.deepEqual(plan, { ok: true, defaultTab: "pulls" })
  })
})
