export type SepoCommentsContentTab = "discussions" | "issues" | "pulls"

export const sepoCommentsContentTabs: readonly SepoCommentsContentTab[] = [
  "discussions",
  "issues",
  "pulls",
]

type TabPlan =
  | {
      ok: true
      tabs: SepoCommentsContentTab[]
      warning?: string
    }
  | {
      ok: false
      reason: string
    }

type DefaultTabPlan =
  | {
      ok: true
      defaultTab?: SepoCommentsContentTab
    }
  | {
      ok: false
      reason: string
    }

export function deriveSepoCommentsTabs(input: {
  requestedTabs?: SepoCommentsContentTab[]
  hasDiscussionConfig: boolean
}): TabPlan {
  const requestedTabs = input.requestedTabs?.length
    ? [...input.requestedTabs]
    : [...sepoCommentsContentTabs]

  if (input.hasDiscussionConfig || !requestedTabs.includes("discussions")) {
    return { ok: true, tabs: requestedTabs }
  }

  const tabs = requestedTabs.filter((tab) => tab !== "discussions")
  if (tabs.length === 0) {
    return {
      ok: false,
      reason: "SEPO_COMMENTS_TABS includes only discussions, but Discussion IDs are not configured",
    }
  }

  return {
    ok: true,
    tabs,
    warning:
      "discussion IDs are not fully configured; removing the Discussions tab and keeping Issues/Pull requests",
  }
}

export function deriveSepoCommentsDefaultTab(input: {
  explicitDefaultTab?: SepoCommentsContentTab
  tabs: readonly SepoCommentsContentTab[]
  prNumber?: number
}): DefaultTabPlan {
  if (input.explicitDefaultTab && !input.tabs.includes(input.explicitDefaultTab)) {
    return {
      ok: false,
      reason: `SEPO_COMMENTS_DEFAULT_TAB=${input.explicitDefaultTab} is not one of the enabled tabs (${input.tabs.join(", ")})`,
    }
  }

  return {
    ok: true,
    defaultTab:
      input.explicitDefaultTab ??
      (input.prNumber && input.tabs.includes("pulls") ? "pulls" : undefined),
  }
}
