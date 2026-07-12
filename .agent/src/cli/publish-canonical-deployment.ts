// CLI: publish a Sepo canonical site URL through GitHub Deployment status events.
// Usage: node .agent/dist/cli/publish-canonical-deployment.js
// Env: GITHUB_REPOSITORY, GITHUB_TOKEN or GH_TOKEN, URL, SHA, RUN_URL, ENVIRONMENT

import { publishCanonicalDeployment } from "../deployments.js";

function requireEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

try {
  const repo = requireEnv("GITHUB_REPOSITORY");
  const ref = requireEnv("SHA");
  const url = requireEnv("URL");
  const runUrl = requireEnv("RUN_URL");
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
  const environment = String(process.env.ENVIRONMENT || "Production").trim() || "Production";

  const result = publishCanonicalDeployment({
    repo,
    ref,
    url,
    runUrl,
    environment,
    token,
    retry: { attempts: 3, delayMs: 1_000 },
  });

  console.log(`Published GitHub deployment ${result.deploymentId} for ${url}.`);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exitCode = 1;
}
