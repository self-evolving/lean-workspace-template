import { extractReviewSynthesisHeadSha, isReviewSynthesisBody } from "./review-synthesis.js";
import { extractRequestedRouteDecision } from "./triage.js";

export const REVIEW_NUDGE_MARKER = "<!-- sepo-agent-review-nudge -->";
export const DEFAULT_AGENT_HANDLE = "@sepo-agent";
export const DEFAULT_REVIEW_LABEL = "agent/review";
export const DEFAULT_PREVIEW_LABEL = "sepo-preview";

export interface ReviewNudgeComment {
  body: string;
}

export interface ReviewNudgeIssueEvent {
  event: string;
  labelName: string;
}

export interface ReviewNudgeInput {
  prNumber: number | string;
  headRef: string;
  headSha: string;
  body?: string;
  state?: string;
  isDraft?: boolean;
  labels?: string[];
  comments?: ReviewNudgeComment[];
  events?: ReviewNudgeIssueEvent[];
  agentHandle?: string;
  reviewLabel?: string;
  previewLabel?: string;
}

export interface ReviewNudgeDecision {
  shouldPost: boolean;
  reason: string;
}

function normalizeLower(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAgentHandle(handle: string | undefined): string {
  const trimmed = String(handle || "").trim();
  if (!trimmed) return DEFAULT_AGENT_HANDLE;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function normalizedReviewLabel(input: ReviewNudgeInput): string {
  return normalizeLower(input.reviewLabel || DEFAULT_REVIEW_LABEL);
}

function hasReviewLabel(labels: string[] | undefined, reviewLabel: string): boolean {
  return (labels || []).some((label) => normalizeLower(label) === reviewLabel);
}

function hasReviewLabelEvent(events: ReviewNudgeIssueEvent[] | undefined, reviewLabel: string): boolean {
  return (events || []).some((event) => (
    normalizeLower(event.event) === "labeled" &&
    normalizeLower(event.labelName) === reviewLabel
  ));
}

function hasExistingNudge(comments: ReviewNudgeComment[] | undefined): boolean {
  return (comments || []).some((comment) => String(comment.body || "").includes(REVIEW_NUDGE_MARKER));
}

function hasReviewRequestComment(
  comments: ReviewNudgeComment[] | undefined,
  agentHandle: string,
): boolean {
  return (comments || []).some((comment) => {
    const body = String(comment.body || "");
    if (!body || body.includes(REVIEW_NUDGE_MARKER)) return false;
    return extractRequestedRouteDecision(body, agentHandle).route === "review";
  });
}

function hasCurrentReviewSynthesis(
  comments: ReviewNudgeComment[] | undefined,
  headSha: string,
): boolean {
  const normalizedHeadSha = normalizeLower(headSha);
  return (comments || []).some((comment) => {
    const body = String(comment.body || "");
    if (!isReviewSynthesisBody(body)) return false;

    const reviewedHead = normalizeLower(extractReviewSynthesisHeadSha(body));
    return !reviewedHead || (!!normalizedHeadSha && reviewedHead === normalizedHeadSha);
  });
}

export function evaluateReviewNudge(input: ReviewNudgeInput): ReviewNudgeDecision {
  const prNumber = String(input.prNumber || "").trim();
  if (!prNumber) {
    return { shouldPost: false, reason: "missing_pr" };
  }

  if (normalizeLower(input.state) && normalizeLower(input.state) !== "open") {
    return { shouldPost: false, reason: "not_open" };
  }

  if (input.isDraft) {
    return { shouldPost: false, reason: "draft_pr" };
  }

  if (String(input.headRef || "").startsWith("agent/")) {
    return { shouldPost: false, reason: "agent_branch" };
  }

  const reviewLabel = normalizedReviewLabel(input);
  const agentHandle = normalizeAgentHandle(input.agentHandle);

  if (hasReviewLabel(input.labels, reviewLabel)) {
    return { shouldPost: false, reason: "review_label_present" };
  }

  if (hasExistingNudge(input.comments)) {
    return { shouldPost: false, reason: "nudge_already_present" };
  }

  if (hasReviewLabelEvent(input.events, reviewLabel)) {
    return { shouldPost: false, reason: "review_label_seen" };
  }

  const reviewRequestTexts = [
    ...(input.body ? [{ body: input.body }] : []),
    ...(input.comments || []),
  ];
  if (hasReviewRequestComment(reviewRequestTexts, agentHandle)) {
    return { shouldPost: false, reason: "review_requested" };
  }

  if (hasCurrentReviewSynthesis(input.comments, input.headSha)) {
    return { shouldPost: false, reason: "review_synthesis_present" };
  }

  return { shouldPost: true, reason: "no_review_launch_found" };
}

export function buildReviewNudgeComment(input: {
  agentHandle?: string;
  reviewLabel?: string;
  previewLabel?: string;
} = {}): string {
  const agentHandle = normalizeAgentHandle(input.agentHandle);
  const reviewLabel = String(input.reviewLabel || DEFAULT_REVIEW_LABEL).trim() || DEFAULT_REVIEW_LABEL;
  const previewLabel = String(input.previewLabel || DEFAULT_PREVIEW_LABEL).trim() || DEFAULT_PREVIEW_LABEL;

  return [
    "Do you want Sepo to review this PR?",
    "",
    REVIEW_NUDGE_MARKER,
    "",
    `Add the \`${reviewLabel}\` label or comment \`${agentHandle} /review\` to launch an agent review.`,
    `For a preview deployment, add the \`${previewLabel}\` label.`,
  ].join("\n");
}
