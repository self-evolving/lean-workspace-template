// CLI: publish a Sepo preview URL through GitHub Deployment status events.
// Usage: node .agent/dist/cli/publish-preview-deployment.js
// Env: GITHUB_REPOSITORY, SEPO_TOKEN, FALLBACK_TOKEN, URL, PR, SHA, HEAD_REF,
//      RUN_URL, ENVIRONMENT

import {
  PreviewDeploymentPublishError,
  publishPreviewDeployment,
  type PreviewDeploymentWarning,
} from "../deployments.js";

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

function warningMessage(warning: PreviewDeploymentWarning): string {
  const target = warning.stage === "deployment"
    ? "GitHub deployment"
    : "GitHub deployment status";
  return `Failed to create ${target} with ${warning.tokenLabel} token: ${warning.message}`;
}

function printWarning(warning: PreviewDeploymentWarning): void {
  console.warn(`::warning::${warningMessage(warning)}`);
}

try {
  const repo = requireEnv("GITHUB_REPOSITORY");
  const prNumber = parsePositiveInt("PR");
  const headSha = requireEnv("SHA");
  const headRef = requireEnv("HEAD_REF");
  const url = requireEnv("URL");
  const runUrl = requireEnv("RUN_URL");
  const environment = String(process.env.ENVIRONMENT || "Preview").trim() || "Preview";

  const result = publishPreviewDeployment({
    repo,
    prNumber,
    headSha,
    headRef,
    url,
    runUrl,
    environment,
    sepoToken: process.env.SEPO_TOKEN,
    fallbackToken: process.env.FALLBACK_TOKEN,
  });

  for (const warning of result.warnings) {
    printWarning(warning);
  }

  console.log(`Published GitHub deployment ${result.deploymentId} for ${url} using ${result.tokenLabel} token.`);
} catch (err: unknown) {
  if (err instanceof PreviewDeploymentPublishError) {
    for (const warning of err.warnings) {
      printWarning(warning);
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exitCode = 1;
}
