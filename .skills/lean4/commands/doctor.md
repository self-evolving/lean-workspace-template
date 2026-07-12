---
name: doctor
description: Read-only Lean, Lake, Sepo skill, and workspace diagnostics.
argument-hint: "[env|skill|project|full]"
---

# Lean4 Doctor

Use this note when the user reports Lean/Lake failures, missing tools, skill
setup confusion, or uncertainty about whether the workspace is ready for Lean
work.

## Modes

| Mode      | Checks                                                          |
| --------- | --------------------------------------------------------------- |
| `env`     | Tool versions and PATH-sensitive basics                         |
| `skill`   | `.skills/lean4` prompt files and Sepo skill routing assumptions |
| `project` | Lean project files, blueprint layout, and build health          |
| `full`    | All of the above; default                                       |

## Checks

Run the lightweight checks that apply:

```bash
lean --version
lake --version
python3 --version
git --version
rg --version
```

Project checks:

- `lean-toolchain` exists and names the expected Lean toolchain.
- `lakefile.toml` or `lakefile.lean` exists.
- `lake-manifest.json` exists when dependencies are expected to be pinned.
- `content/blueprint/` and `lean/` contain the expected Lean sources.
- `lake env lean <target-file>` for a focused file, or `lake build` for a full
  project health check when appropriate.
- `rg -n "\\b(sorry|admit)\\b" content lean` for a quick sorry count.

Skill checks:

- `.skills/lean4/SKILL.md` exists.
- Command notes exist under `.skills/lean4/commands/`.
- No upstream runtime assumptions are required: no `setup.sh`, no parser hook,
  no `$LEAN4_SCRIPTS`, no Claude plugin install, no subagent dispatch.

Memory checks:

- If `$MEMORY_DIR` is mounted, note that repository memory is available.
- If it is absent, continue normally and report memory as unavailable rather
  than blocked.

## Output

```markdown
## Lean4 Doctor Report

### Blockers

- ...

### Environment

- ...

### Project

- ...

### Skill

- ...

### Next Action

- ...
```

Lead with blockers and concrete next actions. Do not remove files, clean build
artifacts, modify shell profiles, install tools, or scan user-level directories
unless the user explicitly asks for that separate work.
