# Memory

## Durable
- For real blueprint migrations, prefer npm run migrate:blueprint; it writes native chapters and leaves Lean/config/index/canvas adoption manual.
- External Lean adoption: run lake update after [[require]]; run cache get only when mathlib is present; delete demo machine files before sync.
- TeX-plan imports intentionally resolve only line-leading \input and warn/skip missing files for partial-source imports.
- Blueprints with \part{} outlines should use --part-folders; expect /blueprint/<part>/<chapter> URLs and one-level folder recursion.
- Blueprint sync bakes declaration snippets into blueprint-data.json; deploy builds must render snippets without .lake checkouts.
- Quartz browser-script regressions are forced through scripts/run-tests.mjs when npm test receives explicit test files; list required suites there.
- Blueprint canvas cards use selection as the primary click; page navigation belongs in explicit open/sidebar/popover actions.
- Handwave is a VS Code editor companion for Lean notes; treat it as complementary to blueprint publishing, not a template replacement.
