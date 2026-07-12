---
title: "Configuring Sepo"
description: "How the drawer and previews are wired: what works out of the box, and the build-environment knobs."
---

The [drawer](../tutorial/features/sepo-agent-drawer) and
[per-branch previews](../tutorial/features/per-branch-preview) are configured
entirely through build environment variables with fixed names —
`SEPO_COMMENTS_*`, `SEPO_PREVIEW_*`, and `HYPOTHESIS_*`. You rarely set these
yourself: the shipped GitHub Actions workflows derive them before the Quartz
build — repository variables with matching names are forwarded, and everything
else gets a sensible default. The build consumes only these fixed names; older
Giscus-prefixed variables are not read.

## What happens by default

Comments are enabled on a best-effort basis:

- `SEPO_COMMENTS_REPO` defaults to the current repository, and
  `SEPO_COMMENTS_CATEGORY` to `General`.
- Pull-request preview builds get `SEPO_PREVIEW_PR` and `SEPO_PREVIEW_BRANCH`
  baked in — this is what pins the drawer to the PR on previews.
- The workflows resolve the GraphQL IDs the widget needs for Discussions. If
  Discussions are disabled or the IDs cannot be resolved, the build logs a
  warning, drops the Discussions tab, and still ships the drawer with Issues
  and Pull requests.

Two switches change that posture: `SEPO_COMMENTS_ENABLED=true` upgrades
missing required pieces from warnings to build failures, and
`SEPO_COMMENTS_ENABLED=false` opts out of the drawer entirely.

## Knobs

| variable                                             | what it does                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SEPO_COMMENTS_REPO`, `SEPO_COMMENTS_CATEGORY`       | where Discussions live; default to the current repository and `General`                                         |
| `SEPO_COMMENTS_REPO_ID`, `SEPO_COMMENTS_CATEGORY_ID` | pinned public widget IDs; required only for the Discussions tab — setting both skips the workflow lookup        |
| `SEPO_COMMENTS_TABS`                                 | which tabs ship; defaults to `discussions,issues,pulls` (e.g. `discussions` alone for a discussion-only drawer) |
| `SEPO_COMMENTS_DEFAULT_TAB`                          | the tab the drawer opens on                                                                                     |
| `SEPO_COMMENTS_CONTENT_REPO`                         | serve page threads from a different repository (`owner/name` format)                                            |
| `SEPO_COMMENTS_TRIGGER_MODE`                         | how the drawer trigger behaves                                                                                  |
| `SEPO_COMMENTS_APP_HOST`                             | comments service origin; default `https://comment-api.sepo-preview.xyz`; must be an absolute `http(s)` URL      |
| `SEPO_COMMENTS_PREVIEW_SWITCHER`                     | `hover` enables the branch switcher on the main site; omitting it keeps the switcher disabled                   |
| `SEPO_PREVIEW_PR`, `SEPO_PREVIEW_BRANCH`             | preview identity; set automatically by the preview workflow                                                     |
| `SEPO_PREVIEW_DOMAIN`                                | preview-domain identity; `SEPO_PREVIEW_DOMAIN=localhost` makes a local build behave like a preview              |
| `SEPO_PREVIEW_API`                                   | preview API origin used by the switcher; must be an absolute `http(s)` URL                                      |

The drawer runtime itself (`sepo.js`) loads from the comments service at
`SEPO_COMMENTS_APP_HOST` rather than being vendored into this repository, so
widget updates arrive without template changes.
