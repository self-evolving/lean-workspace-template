---
title: "Agent automation"
description: "The Sepo agent workflow stack shipped with this template: the global pause switch, preview deployments, and the main-site publish."
---

The template ships the Sepo agent workflow stack as
`.github/workflows/agent-*.yml` — the same files every clone inherits. These
workflows are what answer `@sepo-agent` mentions, run reviews, deploy
previews, and publish the site.

**Pausing everything.** All agent jobs honor one global switch: set the
repository variable `AGENT_ENABLED=false` and every agent workflow becomes a
no-op. The full configuration list lives in
[`.agent/docs/`](https://github.com/self-evolving/lean-workspace-template/tree/main/.agent/docs).

**Preview deployments.** `agent-site-preview.yml` builds a pull request's
branch and publishes the URL as a GitHub _Preview_ deployment status on the
PR (falling back to `GITHUB_TOKEN` if Sepo app auth cannot create the
deployment). When the PR closes, its matching preview deployments are marked
inactive. See [per-branch preview](../tutorial/features/per-branch-preview)
for the user-facing side.

**Main-site publish.** `agent-deploy-site-main.yml` publishes the default
branch to the project's canonical Sepo site URL and records it as a GitHub
_Production_ deployment.
