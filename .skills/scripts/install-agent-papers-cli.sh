#!/usr/bin/env bash
set -euo pipefail

AGENT_PAPERS_CLI_VERSION="0.2.1"
if [ -n "${PYTHON:-}" ]; then
  python_candidates=("${PYTHON}")
else
  python_candidates=(python3.12 python3.11 python3.10 python3 python)
fi

PYTHON_BIN=""
for candidate in "${python_candidates[@]}"; do
  if command -v "${candidate}" >/dev/null 2>&1 && "${candidate}" - <<'PY' >/dev/null 2>&1
import sys

raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
  then
    PYTHON_BIN="${candidate}"
    break
  fi
done

if [ -z "${PYTHON_BIN}" ]; then
  echo "agent-papers-cli requires Python 3.10 or newer. Set PYTHON to a compatible interpreter." >&2
  exit 1
fi

"${PYTHON_BIN}" -m pip install --disable-pip-version-check "agent-papers-cli==${AGENT_PAPERS_CLI_VERSION}"

installed_version="$("${PYTHON_BIN}" - <<'PY'
from importlib.metadata import version

print(version("agent-papers-cli"))
PY
)"

if [ "${installed_version}" != "${AGENT_PAPERS_CLI_VERSION}" ]; then
  echo "Expected agent-papers-cli ${AGENT_PAPERS_CLI_VERSION}, found ${installed_version}" >&2
  exit 1
fi

scripts_output="$("${PYTHON_BIN}" - <<'PY'
from importlib.metadata import distribution
from pathlib import Path
import site
import sysconfig

candidates = []
dist = distribution("agent-papers-cli")
for installed_file in dist.files or []:
    if Path(str(installed_file)).name in {"paper", "paper-search"}:
        candidates.append(str(Path(dist.locate_file(installed_file)).parent))

candidates.extend([sysconfig.get_path("scripts"), f"{site.getuserbase()}/bin"])
seen = set()
for candidate in candidates:
    if candidate:
        normalized = str(Path(candidate).expanduser().resolve())
        if normalized not in seen:
            seen.add(normalized)
            print(normalized)
PY
)"

scripts_dirs=()
while IFS= read -r scripts_dir; do
  if [ -n "${scripts_dir}" ]; then
    scripts_dirs+=("${scripts_dir}")
  fi
done <<<"${scripts_output}"

PAPER_BIN=""
PAPER_SEARCH_BIN=""
AGENT_PAPERS_CLI_BIN_DIR=""
for scripts_dir in "${scripts_dirs[@]}"; do
  if [ -x "${scripts_dir}/paper" ] && [ -x "${scripts_dir}/paper-search" ]; then
    AGENT_PAPERS_CLI_BIN_DIR="${scripts_dir}"
    PAPER_BIN="${scripts_dir}/paper"
    PAPER_SEARCH_BIN="${scripts_dir}/paper-search"
    break
  fi
done

if [ -z "${AGENT_PAPERS_CLI_BIN_DIR}" ]; then
  echo "Expected paper and paper-search console scripts from ${PYTHON_BIN} after installing agent-papers-cli" >&2
  exit 1
fi

export PATH="${AGENT_PAPERS_CLI_BIN_DIR}:${PATH}"
if [ -n "${GITHUB_PATH:-}" ]; then
  if ! printf '%s\n' "${AGENT_PAPERS_CLI_BIN_DIR}" >>"${GITHUB_PATH}"; then
    echo "Warning: could not append ${AGENT_PAPERS_CLI_BIN_DIR} to GITHUB_PATH" >&2
  fi
fi

for command_name in paper paper-search; do
  command_path="$(command -v "${command_name}")"
  case "${command_path}" in
    "${AGENT_PAPERS_CLI_BIN_DIR}/"*) ;;
    *)
      echo "Expected '${command_name}' from ${AGENT_PAPERS_CLI_BIN_DIR}, found ${command_path}" >&2
      exit 1
      ;;
  esac
done

for command_path in "${PAPER_BIN}" "${PAPER_SEARCH_BIN}"; do
  if [ ! -x "${command_path}" ]; then
    echo "Expected executable console script at ${command_path}" >&2
    exit 1
  fi
done

"${PAPER_BIN}" --help >/dev/null
"${PAPER_SEARCH_BIN}" --help >/dev/null
"${PAPER_SEARCH_BIN}" env >/dev/null

echo "agent-papers-cli ${installed_version} installed; paper and paper-search smoke checks passed."
