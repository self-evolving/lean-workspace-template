// CLI: post a one-time review nudge on non-agent pull requests.
// Usage: node .agent/dist/cli/post-review-nudge.js
// Env: GITHUB_REPOSITORY, PR_NUMBER/TARGET_NUMBER, AGENT_HANDLE,
//      AGENT_REVIEW_LABEL, SEPO_PREVIEW_LABEL
// Outputs: posted, reason, comment_action

import { fetchIssueCommentRecords, gh, upsertPrCommentByMarker } from "../github.js";
import { setOutput } from "../output.js";
import {
  buildReviewNudgeComment,
  evaluateReviewNudge,
  REVIEW_NUDGE_MARKER,
  type ReviewNudgeIssueEvent,
} from "../review-nudge.js";

interface PullApiResponse {
  head?: {
    ref?: unknown;
    sha?: unknown;
  };
  body?: unknown;
  state?: unknown;
  draft?: unknown;
}

interface IssueApiResponse {
  labels?: unknown;
}

function parseJsonObject<T>(raw: string): T {
  const parsed = JSON.parse(raw || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GitHub API returned a non-object response");
  }
  return parsed as T;
}

function flattenPaginatedJson(raw: string): unknown[] {
  const parsed = JSON.parse(raw || "[]") as unknown;
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  const entries: unknown[] = [];

  for (const page of pages) {
    if (Array.isArray(page)) {
      entries.push(...page);
    } else if (page !== null && page !== undefined) {
      entries.push(page);
    }
  }

  return entries;
}

function labelName(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name.trim() : "";
}

function fetchPr(prNumber: number, repo: string): PullApiResponse {
  return parseJsonObject<PullApiResponse>(
    gh(["api", `repos/${repo}/pulls/${prNumber}`]),
  );
}

function fetchIssueLabels(issueNumber: number, repo: string): string[] {
  const issue = parseJsonObject<IssueApiResponse>(
    gh(["api", `repos/${repo}/issues/${issueNumber}`]),
  );
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels.map(labelName).filter(Boolean);
}

function fetchIssueEvents(issueNumber: number, repo: string): ReviewNudgeIssueEvent[] {
  const raw = gh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues/${issueNumber}/events`,
  ]);

  return flattenPaginatedJson(raw)
    .map((entry): ReviewNudgeIssueEvent | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const event = String(record.event || "");
      const label = labelName(record.label);
      return event || label ? { event, labelName: label } : null;
    })
    .filter((event): event is ReviewNudgeIssueEvent => Boolean(event));
}

function requiredPositiveInteger(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireNonEmpty(name: string, value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function main(): void {
  const repo = requireNonEmpty("GITHUB_REPOSITORY", process.env.GITHUB_REPOSITORY || "");
  const prNumber = requiredPositiveInteger(
    "PR_NUMBER",
    process.env.PR_NUMBER || process.env.TARGET_NUMBER || "",
  );
  const agentHandle = process.env.AGENT_HANDLE || "";
  const reviewLabel = process.env.AGENT_REVIEW_LABEL || "";
  const previewLabel = process.env.SEPO_PREVIEW_LABEL || "";

  const pr = fetchPr(prNumber, repo);
  const labels = fetchIssueLabels(prNumber, repo);
  const comments = fetchIssueCommentRecords(prNumber, repo);
  const events = fetchIssueEvents(prNumber, repo);

  const decision = evaluateReviewNudge({
    prNumber,
    headRef: String(pr.head?.ref || ""),
    headSha: String(pr.head?.sha || ""),
    body: String(pr.body || ""),
    state: String(pr.state || ""),
    isDraft: Boolean(pr.draft),
    labels,
    comments,
    events,
    agentHandle,
    reviewLabel,
    previewLabel,
  });

  console.log(`Review nudge decision: ${decision.reason}`);
  setOutput("reason", decision.reason);

  if (!decision.shouldPost) {
    setOutput("posted", "false");
    setOutput("comment_action", "");
    return;
  }

  const body = buildReviewNudgeComment({ agentHandle, reviewLabel, previewLabel });
  const action = upsertPrCommentByMarker(prNumber, repo, REVIEW_NUDGE_MARKER, body);
  console.log(`Review nudge comment ${action}.`);
  setOutput("posted", "true");
  setOutput("comment_action", action);
}

try {
  main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Review nudge failed: ${message}`);
  process.exitCode = 1;
}
