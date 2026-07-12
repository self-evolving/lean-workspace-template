// CLI: mark matching Sepo preview GitHub Deployments inactive after teardown.
// Usage: node .agent/dist/cli/inactivate-preview-deployments.js
// Env: GITHUB_REPOSITORY, GH_TOKEN, PR, SHA, RUN_URL, ENVIRONMENT

import { inactivatePreviewDeployments } from "../deployments.js";

function requireEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePositiveInt(name: string): number {
  const raw = requireEnv(name);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

try {
  const repo = requireEnv("GITHUB_REPOSITORY");
  const prNumber = parsePositiveInt("PR");
  const headSha = requireEnv("SHA");
  const runUrl = requireEnv("RUN_URL");
  const environment = String(process.env.ENVIRONMENT || "Preview").trim() || "Preview";
  const token = String(process.env.GH_TOKEN || "").trim() || undefined;

  const deploymentIds = inactivatePreviewDeployments({
    repo,
    prNumber,
    headSha,
    runUrl,
    environment,
    token,
  });

  if (deploymentIds.length === 0) {
    console.log("No matching preview deployments to mark inactive.");
  } else {
    for (const deploymentId of deploymentIds) {
      console.log(`Marked GitHub deployment ${deploymentId} inactive.`);
    }
  }
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exitCode = 1;
}
