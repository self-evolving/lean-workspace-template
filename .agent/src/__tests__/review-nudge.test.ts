import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildReviewNudgeComment,
  evaluateReviewNudge,
  REVIEW_NUDGE_MARKER,
} from "../review-nudge.js";

const baseInput = {
  prNumber: 12,
  headRef: "feature/review-me",
  headSha: "abc123",
  state: "open",
};

test("review nudge posts when no review launch signal exists", () => {
  assert.deepEqual(evaluateReviewNudge(baseInput), {
    shouldPost: true,
    reason: "no_review_launch_found",
  });
});

test("review nudge skips agent branches and draft PRs", () => {
  assert.deepEqual(evaluateReviewNudge({ ...baseInput, headRef: "agent/issue-12" }), {
    shouldPost: false,
    reason: "agent_branch",
  });
  assert.deepEqual(evaluateReviewNudge({ ...baseInput, isDraft: true }), {
    shouldPost: false,
    reason: "draft_pr",
  });
});

test("review nudge skips current or previous review labels", () => {
  assert.deepEqual(evaluateReviewNudge({ ...baseInput, labels: ["agent/review"] }), {
    shouldPost: false,
    reason: "review_label_present",
  });
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      events: [{ event: "labeled", labelName: "agent/review" }],
    }),
    {
      shouldPost: false,
      reason: "review_label_seen",
    },
  );
});

test("review nudge skips explicit review request comments", () => {
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      comments: [{ body: "Please take a look, @sepo-agent /review" }],
    }),
    {
      shouldPost: false,
      reason: "review_requested",
    },
  );
});

test("review nudge skips explicit review requests in the PR body", () => {
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      body: "@sepo-agent /review",
    }),
    {
      shouldPost: false,
      reason: "review_requested",
    },
  );
});

test("review nudge ignores quoted review commands", () => {
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      comments: [{ body: "> @sepo-agent /review" }],
    }),
    {
      shouldPost: true,
      reason: "no_review_launch_found",
    },
  );
});

test("review nudge skips existing nudge comments before parsing body commands", () => {
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      comments: [{ body: `${REVIEW_NUDGE_MARKER}\n\nAdd \`@sepo-agent /review\`.` }],
    }),
    {
      shouldPost: false,
      reason: "nudge_already_present",
    },
  );
});

test("review nudge skips review synthesis comments for the current head", () => {
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      comments: [{
        body: [
          "## AI Review Synthesis",
          "",
          "<!-- sepo-agent-review-synthesis -->",
          "<!-- sepo-agent-review-synthesis-head: abc123 -->",
        ].join("\n"),
      }],
    }),
    {
      shouldPost: false,
      reason: "review_synthesis_present",
    },
  );
});

test("review nudge does not treat stale head synthesis as current", () => {
  assert.deepEqual(
    evaluateReviewNudge({
      ...baseInput,
      comments: [{
        body: [
          "## AI Review Synthesis",
          "",
          "<!-- sepo-agent-review-synthesis -->",
          "<!-- sepo-agent-review-synthesis-head: def456 -->",
        ].join("\n"),
      }],
    }),
    {
      shouldPost: true,
      reason: "no_review_launch_found",
    },
  );
});

test("review nudge comment documents review and preview triggers", () => {
  const body = buildReviewNudgeComment();
  assert.match(body, /Do you want Sepo to review this PR\?/);
  assert.match(body, /`agent\/review`/);
  assert.match(body, /`@sepo-agent \/review`/);
  assert.match(body, /`sepo-preview`/);
  assert.match(body, new RegExp(REVIEW_NUDGE_MARKER));
});
