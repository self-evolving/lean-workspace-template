// GitHub Deployment helpers used by this repository's Sepo site workflows.

import { execFileSync } from "node:child_process";
import { MAX_BUFFER } from "./github.js";

export interface GitHubApiRetryOptions {
  attempts?: number;
  delayMs?: number;
}

export interface PreviewDeploymentPayloadOptions {
  prNumber: number;
  headRef: string;
  headSha: string;
  environment: string;
}

export interface PreviewDeploymentSuccessStatusOptions {
  environment: string;
  url: string;
  runUrl: string;
}

export interface PreviewDeploymentInactiveStatusOptions {
  environment: string;
  runUrl: string;
}

export interface CanonicalDeploymentPayloadOptions {
  ref: string;
  environment: string;
}

export interface CanonicalDeploymentSuccessStatusOptions {
  environment: string;
  url: string;
  runUrl: string;
}

export interface PreviewDeploymentWarning {
  tokenLabel: string;
  stage: "deployment" | "status";
  message: string;
}

export interface PublishPreviewDeploymentOptions extends PreviewDeploymentPayloadOptions {
  repo: string;
  url: string;
  runUrl: string;
  sepoToken?: string;
  fallbackToken?: string;
}

export interface PublishPreviewDeploymentResult {
  deploymentId: string;
  tokenLabel: string;
  warnings: PreviewDeploymentWarning[];
}

export interface PublishCanonicalDeploymentOptions extends CanonicalDeploymentPayloadOptions {
  repo: string;
  url: string;
  runUrl: string;
  token?: string;
  retry?: GitHubApiRetryOptions;
}

export interface PublishCanonicalDeploymentResult {
  deploymentId: string;
}

export interface GitHubDeploymentRecord {
  id: string;
  payload: unknown;
}

export interface InactivatePreviewDeploymentsOptions {
  repo: string;
  prNumber: number;
  headSha: string;
  environment: string;
  runUrl: string;
  token?: string;
}

export class PreviewDeploymentPublishError extends Error {
  warnings: PreviewDeploymentWarning[];

  constructor(message: string, warnings: PreviewDeploymentWarning[]) {
    super(message);
    this.name = "PreviewDeploymentPublishError";
    this.warnings = warnings;
    Object.setPrototypeOf(this, PreviewDeploymentPublishError.prototype);
  }
}

function ghApiCommand(args: string[], token?: string): string {
  return execFileSync("gh", ["api", ...args], {
    env: token ? { ...process.env, GH_TOKEN: token } : process.env,
    stdio: "pipe",
    maxBuffer: MAX_BUFFER,
  }).toString("utf8");
}

function ghApiCommandWithInput(args: string[], payload: unknown, token?: string): string {
  return execFileSync("gh", ["api", ...args], {
    env: token ? { ...process.env, GH_TOKEN: token } : process.env,
    input: `${JSON.stringify(payload)}\n`,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER,
  }).toString("utf8");
}

function commandErrorText(err: unknown): string {
  const record = err as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [record.message, record.stderr, record.stdout]
    .map((part) => {
      if (Buffer.isBuffer(part)) return part.toString("utf8");
      return typeof part === "string" ? part : "";
    })
    .filter(Boolean)
    .join("\n");
}

function commandErrorSummary(err: unknown): string {
  return commandErrorText(err).replace(/\s+/g, " ").trim() || "unknown error";
}

function isTransientGitHubApiError(err: unknown): boolean {
  const text = commandErrorText(err);
  return /\b(429|50[0-9])\b|rate limit|secondary rate limit|timed?\s*out|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|temporarily unavailable/i.test(text);
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function withGitHubApiRetries<T>(operation: () => T, retry?: GitHubApiRetryOptions): T {
  const attempts = Math.max(1, Math.floor(retry?.attempts ?? 1));
  const delayMs = Math.max(0, Math.floor(retry?.delayMs ?? 0));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return operation();
    } catch (err: unknown) {
      if (attempt >= attempts || !isTransientGitHubApiError(err)) {
        throw err;
      }
      sleepSync(delayMs * (2 ** (attempt - 1)));
    }
  }

  throw new Error("unreachable GitHub API retry state");
}

export function buildPreviewDeploymentPayload(opts: PreviewDeploymentPayloadOptions): Record<string, unknown> {
  return {
    ref: opts.headSha,
    environment: opts.environment,
    description: `Sepo site preview for PR #${opts.prNumber}`,
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
    production_environment: false,
    payload: {
      source: "sepo-preview",
      pull_request: opts.prNumber,
      head_ref: opts.headRef,
      head_sha: opts.headSha,
    },
  };
}

export function buildPreviewDeploymentSuccessStatusPayload(
  opts: PreviewDeploymentSuccessStatusOptions,
): Record<string, unknown> {
  return {
    state: "success",
    environment: opts.environment,
    target_url: opts.url,
    environment_url: opts.url,
    log_url: opts.runUrl,
    description: "Sepo preview is ready",
    auto_inactive: false,
  };
}

export function buildPreviewDeploymentInactiveStatusPayload(
  opts: PreviewDeploymentInactiveStatusOptions,
): Record<string, unknown> {
  return {
    state: "inactive",
    environment: opts.environment,
    log_url: opts.runUrl,
    description: "Sepo preview was torn down",
  };
}

export function buildCanonicalDeploymentPayload(opts: CanonicalDeploymentPayloadOptions): Record<string, unknown> {
  return {
    ref: opts.ref,
    environment: opts.environment,
    description: "Sepo canonical site",
    auto_merge: false,
    required_contexts: [],
    transient_environment: false,
    production_environment: true,
    payload: {
      source: "sepo-canonical",
      canonical: true,
    },
  };
}

export function buildCanonicalDeploymentSuccessStatusPayload(
  opts: CanonicalDeploymentSuccessStatusOptions,
): Record<string, unknown> {
  return {
    state: "success",
    environment: opts.environment,
    target_url: opts.url,
    environment_url: opts.url,
    log_url: opts.runUrl,
    description: "Sepo canonical site is ready",
    auto_inactive: true,
  };
}

export function createGitHubDeployment(
  repo: string,
  payload: Record<string, unknown>,
  token?: string,
  retry?: GitHubApiRetryOptions,
): string {
  return withGitHubApiRetries(() => ghApiCommandWithInput([
    "--method",
    "POST",
    `repos/${repo}/deployments`,
    "--input",
    "-",
    "--jq",
    ".id",
  ], payload, token), retry).trim();
}

export function createGitHubDeploymentStatus(
  repo: string,
  deploymentId: string,
  payload: Record<string, unknown>,
  token?: string,
  retry?: GitHubApiRetryOptions,
): void {
  withGitHubApiRetries(() => ghApiCommandWithInput([
    "--method",
    "POST",
    `repos/${repo}/deployments/${deploymentId}/statuses`,
    "--input",
    "-",
  ], payload, token), retry);
}

function previewTokenAttempts(opts: PublishPreviewDeploymentOptions): { token: string; label: string }[] {
  const sepoToken = String(opts.sepoToken || "").trim();
  const fallbackToken = String(opts.fallbackToken || "").trim();
  const attempts: { token: string; label: string }[] = [];

  if (sepoToken) {
    attempts.push({ token: sepoToken, label: "Sepo auth" });
  }
  if (fallbackToken && fallbackToken !== sepoToken) {
    attempts.push({ token: fallbackToken, label: "GITHUB_TOKEN" });
  }

  return attempts;
}

export function publishCanonicalDeployment(opts: PublishCanonicalDeploymentOptions): PublishCanonicalDeploymentResult {
  const createPayload = buildCanonicalDeploymentPayload({
    ref: opts.ref,
    environment: opts.environment,
  });
  const statusPayload = buildCanonicalDeploymentSuccessStatusPayload({
    environment: opts.environment,
    url: opts.url,
    runUrl: opts.runUrl,
  });
  const deploymentId = createGitHubDeployment(opts.repo, createPayload, opts.token, opts.retry);
  createGitHubDeploymentStatus(opts.repo, deploymentId, statusPayload, opts.token, opts.retry);
  return { deploymentId };
}

export function publishPreviewDeployment(opts: PublishPreviewDeploymentOptions): PublishPreviewDeploymentResult {
  const createPayload = buildPreviewDeploymentPayload(opts);
  const statusPayload = buildPreviewDeploymentSuccessStatusPayload({
    environment: opts.environment,
    url: opts.url,
    runUrl: opts.runUrl,
  });
  const warnings: PreviewDeploymentWarning[] = [];

  for (const attempt of previewTokenAttempts(opts)) {
    let deploymentId = "";
    try {
      deploymentId = createGitHubDeployment(opts.repo, createPayload, attempt.token);
    } catch (err: unknown) {
      warnings.push({
        tokenLabel: attempt.label,
        stage: "deployment",
        message: commandErrorSummary(err),
      });
      continue;
    }

    try {
      createGitHubDeploymentStatus(opts.repo, deploymentId, statusPayload, attempt.token);
    } catch (err: unknown) {
      warnings.push({
        tokenLabel: attempt.label,
        stage: "status",
        message: commandErrorSummary(err),
      });
      continue;
    }

    return {
      deploymentId,
      tokenLabel: attempt.label,
      warnings,
    };
  }

  throw new PreviewDeploymentPublishError(
    "Unable to publish GitHub deployment status.",
    warnings,
  );
}

function flattenGhPages(value: unknown): unknown[] {
  if (!Array.isArray(value)) return value ? [value] : [];

  const records: unknown[] = [];
  for (const page of value) {
    if (Array.isArray(page)) {
      records.push(...page);
    } else if (page) {
      records.push(page);
    }
  }
  return records;
}

function normalizeDeploymentRecord(value: unknown): GitHubDeploymentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || "").trim();
  if (!id) return null;
  return {
    id,
    payload: record.payload,
  };
}

export function fetchPreviewDeployments(
  repo: string,
  environment: string,
  token?: string,
): GitHubDeploymentRecord[] {
  const raw = ghApiCommand([
    "--method",
    "GET",
    "--paginate",
    "--slurp",
    `repos/${repo}/deployments`,
    "-f",
    `environment=${environment}`,
    "-f",
    "per_page=100",
  ], token).trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw) as unknown;
  return flattenGhPages(parsed)
    .map(normalizeDeploymentRecord)
    .filter((record): record is GitHubDeploymentRecord => Boolean(record));
}

function parseDeploymentPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function previewDeploymentMatches(
  deployment: GitHubDeploymentRecord,
  prNumber: number,
  headSha: string,
): boolean {
  const payload = parseDeploymentPayload(deployment.payload);
  if (!payload || payload.source !== "sepo-preview") return false;

  if (payload.pull_request != null) {
    return String(payload.pull_request) === String(prNumber);
  }
  return String(payload.head_sha ?? "") === headSha;
}

export function inactivatePreviewDeployments(opts: InactivatePreviewDeploymentsOptions): string[] {
  const deployments = fetchPreviewDeployments(opts.repo, opts.environment, opts.token);
  const matchingIds = deployments
    .filter((deployment) => previewDeploymentMatches(deployment, opts.prNumber, opts.headSha))
    .map((deployment) => deployment.id);
  const statusPayload = buildPreviewDeploymentInactiveStatusPayload({
    environment: opts.environment,
    runUrl: opts.runUrl,
  });

  for (const deploymentId of matchingIds) {
    createGitHubDeploymentStatus(opts.repo, deploymentId, statusPayload, opts.token);
  }

  return matchingIds;
}
