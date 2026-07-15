# Workspace Skills

Skills available to Sepo skill runs in this Lean workspace:

- `lean4`: prompt-only Lean 4 support adapted from `cameronfreer/lean4-skills`
  — Sepo-native learning (`learn`), read-only proof review (`review`), and
  workspace diagnostics (`doctor`). Includes the layered mathlib search
  protocol (`commands/learn.md`).
- `migrate-lean-project`: the field-tested procedure for migrating an
  existing Lean 4 project or leanblueprint into this workspace — companion
  code adoption, native-chapter conversion via `npm run migrate:blueprint`,
  first-sync expectations, citations, attribution, and verification. The
  tutorials under `docs/tutorial/quick-start/` are the human-facing walk of
  the same steps.
- `deep-research`: broad investigations combining academic search, web
  browsing, repositories, docs/releases, datasets, and benchmarks. Install
  its pinned tooling first:

  ```bash
  .skills/deep-research/setup.sh
  ```

  The setup script installs `agent-papers-cli` and smoke-checks `paper`,
  `paper-search`, and `paper-search env`; no API keys are required to
  install. At runtime, search and browse commands may need `SERPER_API_KEY`,
  `S2_API_KEY`, or `JINA_API_KEY` in the environment (see the skill's own
  notes).
