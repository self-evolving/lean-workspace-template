---
name: review
description: Read-only Lean proof, build, sorry, and style review for Sepo skill runs.
argument-hint: "[path] [--scope=sorry|file|changed|project] [--line=N]"
---

# Lean4 Review

Use this note for read-only review of Lean files, blueprint proofs, build
status, sorries, custom axioms, and style risks.

## Scope

| Request                | Default scope                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------- |
| No path                | Changed Lean files, preferring pull-request changed-file metadata before local diff |
| File path              | That file                                                                           |
| Directory path         | Lean files under that directory                                                     |
| `--line=N` with a file | The declaration or sorry around that line                                           |
| `--scope=project`      | Entire project, only after explicit confirmation                                    |

For PR-targeted Sepo runs, resolve changed files from target PR metadata first,
such as `gh pr view <number> --json files` or `gh pr diff <number>`. If PR
metadata is unavailable or the run is not PR-targeted, fall back to local
`git diff --name-only`.

If there are no changed Lean files and no target is supplied, inspect the main
blueprint Lean files under `content/blueprint/` before asking for a narrower
target.

## Checks

Run only checks that fit the requested scope and current runtime:

1. Build status.
   - Prefer `lake env lean <file>` for a single file.
   - Use `lake build` for project or multi-file review when clearly warranted.
2. Sorry audit.
   - Use `rg -n "\\b(sorry|admit)\\b" <scope>`.
   - Distinguish intentional examples from proof gaps when context makes that
     clear.
3. Axiom and unsafe audit.
   - Use `rg -n "\\b(axiom|unsafe|set_option)\\b" <scope>`.
   - Flag nonstandard axioms or options that weaken checking.
4. Style and maintainability.
   - Look for statement churn risk, fragile tactic blocks, duplicated helper
     logic, namespace/import issues, long proofs that need helper lemmas, and
     lines that fight Lean/mathlib conventions.
5. Memory/context pass.
   - Check repository memory for known Lean conventions or recent decisions
     before reporting style issues.

## Output

Use a code-review stance:

```markdown
## Lean4 Review Report

Scope: <scope>
Checks: <commands or tools>

### Findings

- [severity] path:line - issue and concrete fix direction

### Notes

- No findings found, or residual risks/test gaps.
```

Findings lead the response and are ordered by severity. If there are no issues,
say so clearly and mention any checks that could not be run.

## Boundaries

Do not edit files, stage changes, commit, or run cleanup. If review produces an
actionable fix plan, recommend a Sepo `/implement` follow-up for the edits.
