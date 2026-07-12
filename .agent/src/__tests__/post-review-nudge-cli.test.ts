import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

const repoRoot = resolve(__dirname, "../../..");

function writeFakeGh(tempDir: string, body: string): void {
  writeFileSync(join(tempDir, "gh"), body, { encoding: "utf8", mode: 0o755 });
}

test("post-review-nudge CLI posts a PR nudge when no launch signal exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agent-review-nudge-"));

  try {
    const logPath = join(tempDir, "gh.log");
    const outputPath = join(tempDir, "github-output.txt");
    writeFileSync(outputPath, "", "utf8");
    writeFakeGh(
      tempDir,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
if [ "$1" = "api" ] && [ "$2" = "repos/self-evolving/repo/pulls/7" ]; then
  printf '{"head":{"ref":"feature/review-me","sha":"abc123"},"state":"open","draft":false}\\n'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/self-evolving/repo/issues/7" ]; then
  printf '{"labels":[]}\\n'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "--paginate" ] && [ "$3" = "--slurp" ] && [ "$4" = "repos/self-evolving/repo/issues/7/comments" ]; then
  printf '[[]]\\n'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "--paginate" ] && [ "$3" = "--slurp" ] && [ "$4" = "repos/self-evolving/repo/issues/7/events" ]; then
  printf '[[]]\\n'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  printf '{"data":{"viewer":{"login":"sepo-agent-app"}}}\\n'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "comment" ]; then
  exit 0
fi
printf 'unexpected gh args: %s\\n' "$*" >&2
exit 1
`,
    );

    const result = spawnSync("node", [".agent/dist/cli/post-review-nudge.js"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH || ""}`,
        FAKE_GH_LOG: logPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: "self-evolving/repo",
        PR_NUMBER: "7",
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Review nudge decision: no_review_launch_found/);
    assert.match(result.stdout, /Review nudge comment created/);

    const log = readFileSync(logPath, "utf8");
    assert.match(log, /^api repos\/self-evolving\/repo\/pulls\/7$/m);
    assert.match(log, /^api repos\/self-evolving\/repo\/issues\/7$/m);
    assert.match(log, /^api graphql /m);
    assert.match(log, /^pr comment 7 --body Do you want Sepo to review this PR\?/m);
    assert.match(log, /<!-- sepo-agent-review-nudge -->/);
    assert.match(log, /`agent\/review` label or comment `@sepo-agent \/review`/);
    assert.match(log, /`sepo-preview` label/);

    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /^posted<<.*\ntrue\n/m);
    assert.match(output, /^comment_action<<.*\ncreated\n/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
