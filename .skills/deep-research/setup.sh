#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${skill_dir}/../scripts/install-agent-papers-cli.sh"
