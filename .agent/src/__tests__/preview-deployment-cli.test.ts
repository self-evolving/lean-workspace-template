import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

const repoRoot = resolve(__dirname, "../../..");

function writeFakeGh(tempDir: string, body: string): void {
  writeFileSync(join(tempDir, "gh"), body, { encoding: "utf8", mode: 0o755 });
}

function runCli(cli: string, tempDir: string, env: Record<string, string>) {
  return spawnSync("node", [`.agent/dist/cli/${cli}.js`], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${tempDir}:${process.env.PATH || ""}`,
      ...env,
    },
    encoding: "utf8",
  });
}

test("publish-preview-deployment CLI creates deployment and status payloads", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-preview-publish-"));

  try {
    const payloadDir = join(tempDir, "payloads");
    const logPath = join(tempDir, "gh.log");
    mkdirSync(payloadDir, { recursive: true });
    writeFakeGh(
      tempDir,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\\n' "$GH_TOKEN" "$*" >> "$FAKE_GH_LOG"
if [[ "$*" == *"repos/self-evolving/repo/deployments --input - --jq .id" ]]; then
  cat > "$FAKE_PAYLOAD_DIR/create.json"
  printf '777\\n'
  exit 0
fi
if [[ "$*" == *"repos/self-evolving/repo/deployments/777/statuses --input -" ]]; then
  cat > "$FAKE_PAYLOAD_DIR/status.json"
  exit 0
fi
printf 'unexpected gh args: %s\\n' "$*" >&2
exit 1
`,
    );

    const result = runCli("publish-preview-deployment", tempDir, {
      FAKE_GH_LOG: logPath,
      FAKE_PAYLOAD_DIR: payloadDir,
      GITHUB_REPOSITORY: "self-evolving/repo",
      SEPO_TOKEN: "sepo-token",
      FALLBACK_TOKEN: "fallback-token",
      URL: "https://preview.example.test",
      PR: "22",
      SHA: "abc123",
      HEAD_REF: "agent/preview",
      RUN_URL: "https://github.com/self-evolving/repo/actions/runs/1",
      ENVIRONMENT: "Preview",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Published GitHub deployment 777 .* using Sepo auth token/);

    const log = readFileSync(logPath, "utf8");
    assert.match(log, /^sepo-token\|api --method POST repos\/self-evolving\/repo\/deployments /m);
    assert.match(log, /^sepo-token\|api --method POST repos\/self-evolving\/repo\/deployments\/777\/statuses /m);
    assert.doesNotMatch(log, /^fallback-token\|/m);

    const createPayload = JSON.parse(readFileSync(join(payloadDir, "create.json"), "utf8"));
    assert.deepEqual(createPayload, {
      ref: "abc123",
      environment: "Preview",
      description: "Sepo site preview for PR #22",
      auto_merge: false,
      required_contexts: [],
      transient_environment: true,
      production_environment: false,
      payload: {
        source: "sepo-preview",
        pull_request: 22,
        head_ref: "agent/preview",
        head_sha: "abc123",
      },
    });

    const statusPayload = JSON.parse(readFileSync(join(payloadDir, "status.json"), "utf8"));
    assert.deepEqual(statusPayload, {
      state: "success",
      environment: "Preview",
      target_url: "https://preview.example.test",
      environment_url: "https://preview.example.test",
      log_url: "https://github.com/self-evolving/repo/actions/runs/1",
      description: "Sepo preview is ready",
      auto_inactive: false,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("publish-preview-deployment CLI falls back to GITHUB_TOKEN", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-preview-publish-"));

  try {
    const payloadDir = join(tempDir, "payloads");
    const logPath = join(tempDir, "gh.log");
    mkdirSync(payloadDir, { recursive: true });
    writeFakeGh(
      tempDir,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\\n' "$GH_TOKEN" "$*" >> "$FAKE_GH_LOG"
if [[ "$*" == *"repos/self-evolving/repo/deployments --input - --jq .id" ]]; then
  if [[ "$GH_TOKEN" == "sepo-token" ]]; then
    cat >/dev/null
    printf 'denied\\n' >&2
    exit 1
  fi
  cat > "$FAKE_PAYLOAD_DIR/fallback-create.json"
  printf '888\\n'
  exit 0
fi
if [[ "$*" == *"repos/self-evolving/repo/deployments/888/statuses --input -" ]]; then
  cat > "$FAKE_PAYLOAD_DIR/fallback-status.json"
  exit 0
fi
printf 'unexpected gh args: %s\\n' "$*" >&2
exit 1
`,
    );

    const result = runCli("publish-preview-deployment", tempDir, {
      FAKE_GH_LOG: logPath,
      FAKE_PAYLOAD_DIR: payloadDir,
      GITHUB_REPOSITORY: "self-evolving/repo",
      SEPO_TOKEN: "sepo-token",
      FALLBACK_TOKEN: "fallback-token",
      URL: "https://preview.example.test",
      PR: "22",
      SHA: "abc123",
      HEAD_REF: "agent/preview",
      RUN_URL: "https://github.com/self-evolving/repo/actions/runs/1",
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /::warning::Failed to create GitHub deployment with Sepo auth token:/);
    assert.match(result.stdout, /Published GitHub deployment 888 .* using GITHUB_TOKEN token/);

    const log = readFileSync(logPath, "utf8").trim().split(/\r?\n/);
    assert.equal(log[0].startsWith("sepo-token|api --method POST repos/self-evolving/repo/deployments "), true);
    assert.equal(log[1].startsWith("fallback-token|api --method POST repos/self-evolving/repo/deployments "), true);
    assert.equal(
      log[2].startsWith("fallback-token|api --method POST repos/self-evolving/repo/deployments/888/statuses "),
      true,
    );
    assert.equal(existsSync(join(payloadDir, "fallback-create.json")), true);
    assert.equal(existsSync(join(payloadDir, "fallback-status.json")), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("publish-canonical-deployment CLI creates production deployment and retries transient failures", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-canonical-publish-"));

  try {
    const payloadDir = join(tempDir, "payloads");
    const logPath = join(tempDir, "gh.log");
    mkdirSync(payloadDir, { recursive: true });
    writeFakeGh(
      tempDir,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$GH_TOKEN" "$*" >> "$FAKE_GH_LOG"
if [[ "$*" == *"repos/self-evolving/repo/deployments --input - --jq .id" ]]; then
  count_file="$FAKE_PAYLOAD_DIR/create.count"
  count=0
  [[ -f "$count_file" ]] && count="$(cat "$count_file")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$count_file"
  if [[ "$count" -eq 1 ]]; then
    cat >/dev/null
    printf 'HTTP 502 Bad Gateway\n' >&2
    exit 1
  fi
  cat > "$FAKE_PAYLOAD_DIR/create.json"
  printf '999\n'
  exit 0
fi
if [[ "$*" == *"repos/self-evolving/repo/deployments/999/statuses --input -" ]]; then
  count_file="$FAKE_PAYLOAD_DIR/status.count"
  count=0
  [[ -f "$count_file" ]] && count="$(cat "$count_file")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$count_file"
  if [[ "$count" -eq 1 ]]; then
    cat >/dev/null
    printf 'HTTP 503 Service Unavailable\n' >&2
    exit 1
  fi
  cat > "$FAKE_PAYLOAD_DIR/status.json"
  exit 0
fi
printf 'unexpected gh args: %s\n' "$*" >&2
exit 1
`,
    );

    const result = runCli("publish-canonical-deployment", tempDir, {
      FAKE_GH_LOG: logPath,
      FAKE_PAYLOAD_DIR: payloadDir,
      GITHUB_REPOSITORY: "self-evolving/repo",
      GITHUB_TOKEN: "github-token",
      URL: "https://site.example.test",
      SHA: "abc123",
      RUN_URL: "https://github.com/self-evolving/repo/actions/runs/1",
      ENVIRONMENT: "Production",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Published GitHub deployment 999 for https:\/\/site\.example\.test/);

    const log = readFileSync(logPath, "utf8").trim().split(/\r?\n/);
    assert.equal(log.filter((line) => line.includes("repos/self-evolving/repo/deployments --input - --jq .id")).length, 2);
    assert.equal(log.filter((line) => line.includes("repos/self-evolving/repo/deployments/999/statuses --input -")).length, 2);

    const createPayload = JSON.parse(readFileSync(join(payloadDir, "create.json"), "utf8"));
    assert.deepEqual(createPayload, {
      ref: "abc123",
      environment: "Production",
      description: "Sepo canonical site",
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: true,
      payload: {
        source: "sepo-canonical",
        canonical: true,
      },
    });

    const statusPayload = JSON.parse(readFileSync(join(payloadDir, "status.json"), "utf8"));
    assert.deepEqual(statusPayload, {
      state: "success",
      environment: "Production",
      target_url: "https://site.example.test",
      environment_url: "https://site.example.test",
      log_url: "https://github.com/self-evolving/repo/actions/runs/1",
      description: "Sepo canonical site is ready",
      auto_inactive: true,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inactivate-preview-deployments CLI matches by PR number, with SHA fallback for legacy payloads", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-preview-inactivate-"));

  try {
    const payloadDir = join(tempDir, "payloads");
    const logPath = join(tempDir, "gh.log");
    mkdirSync(payloadDir, { recursive: true });
    writeFakeGh(
      tempDir,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\\n' "$GH_TOKEN" "$*" >> "$FAKE_GH_LOG"
if [[ "$*" == *"repos/self-evolving/repo/deployments -f environment=Preview -f per_page=100" ]]; then
  cat <<'JSON'
[[{"id":101,"payload":{"source":"sepo-preview","pull_request":22,"head_sha":"old"}},
  {"id":102,"payload":{"source":"sepo-preview","pull_request":13,"head_sha":"abc123"}},
  {"id":103,"payload":{"source":"other","pull_request":22,"head_sha":"abc123"}},
  {"id":104,"sha":"abc123","payload":{"source":"sepo-preview","pull_request":13,"head_sha":"other"}},
  {"id":105,"payload":{"source":"sepo-preview","head_sha":"abc123"}}]]
JSON
  exit 0
fi
if [[ "$*" == *"repos/self-evolving/repo/deployments/"*"/statuses --input -" ]]; then
  id="$(printf '%s\\n' "$*" | sed -E 's#.*deployments/([^/]+)/statuses.*#\\1#')"
  cat > "$FAKE_PAYLOAD_DIR/inactive-$id.json"
  exit 0
fi
printf 'unexpected gh args: %s\\n' "$*" >&2
exit 1
`,
    );

    const result = runCli("inactivate-preview-deployments", tempDir, {
      FAKE_GH_LOG: logPath,
      FAKE_PAYLOAD_DIR: payloadDir,
      GH_TOKEN: "github-token",
      GITHUB_REPOSITORY: "self-evolving/repo",
      PR: "22",
      SHA: "abc123",
      RUN_URL: "https://github.com/self-evolving/repo/actions/runs/2",
      ENVIRONMENT: "Preview",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Marked GitHub deployment 101 inactive/);
    assert.match(result.stdout, /Marked GitHub deployment 105 inactive/);
    assert.doesNotMatch(result.stdout, /102|103|104/);

    const log = readFileSync(logPath, "utf8");
    assert.match(log, /^github-token\|api --method GET --paginate --slurp repos\/self-evolving\/repo\/deployments /m);
    assert.match(log, /^github-token\|api --method POST repos\/self-evolving\/repo\/deployments\/101\/statuses /m);
    assert.match(log, /^github-token\|api --method POST repos\/self-evolving\/repo\/deployments\/105\/statuses /m);
    assert.doesNotMatch(log, /deployments\/102\/statuses/);
    assert.doesNotMatch(log, /deployments\/103\/statuses/);
    assert.doesNotMatch(log, /deployments\/104\/statuses/);

    assert.equal(existsSync(join(payloadDir, "inactive-102.json")), false);
    assert.equal(existsSync(join(payloadDir, "inactive-105.json")), true);
    const inactivePayload = JSON.parse(readFileSync(join(payloadDir, "inactive-101.json"), "utf8"));
    assert.deepEqual(inactivePayload, {
      state: "inactive",
      environment: "Preview",
      log_url: "https://github.com/self-evolving/repo/actions/runs/2",
      description: "Sepo preview was torn down",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inactivate-preview-deployments CLI exits cleanly when nothing matches", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-preview-inactivate-"));

  try {
    const logPath = join(tempDir, "gh.log");
    writeFakeGh(
      tempDir,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\\n' "$GH_TOKEN" "$*" >> "$FAKE_GH_LOG"
if [[ "$*" == *"repos/self-evolving/repo/deployments -f environment=Preview -f per_page=100" ]]; then
  printf '[[{"id":201,"payload":{"source":"sepo-preview","pull_request":9,"head_sha":"def456"}}]]\\n'
  exit 0
fi
if [[ "$*" == *"/statuses --input -" ]]; then
  printf 'status should not be created\\n' >&2
  exit 1
fi
printf 'unexpected gh args: %s\\n' "$*" >&2
exit 1
`,
    );

    const result = runCli("inactivate-preview-deployments", tempDir, {
      FAKE_GH_LOG: logPath,
      GH_TOKEN: "github-token",
      GITHUB_REPOSITORY: "self-evolving/repo",
      PR: "22",
      SHA: "abc123",
      RUN_URL: "https://github.com/self-evolving/repo/actions/runs/2",
      ENVIRONMENT: "Preview",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /No matching preview deployments to mark inactive/);

    const log = readFileSync(logPath, "utf8");
    assert.match(log, /^github-token\|api --method GET --paginate --slurp repos\/self-evolving\/repo\/deployments /m);
    assert.doesNotMatch(log, /statuses --input -/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
