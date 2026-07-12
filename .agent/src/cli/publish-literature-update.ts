#!/usr/bin/env node
// CLI: create a literature update Discussion and post item blocks as comments.
// Env: GITHUB_REPOSITORY, DISCUSSION_CATEGORY, DISCUSSION_TITLE, BODY_FILE,
//      DISCUSSION_FOOTER (optional)

import { existsSync, readFileSync } from "node:fs";
import { createRepositoryDiscussion, addDiscussionComment } from "../discussion.js";
import { setOutput } from "../output.js";
import { parseLiteratureUpdate } from "../literature-update.js";

interface PublishOutputs {
  discussionUrl: string;
  expectedCommentCount: number;
  postedCommentUrls: string[];
  failedCommentCount: number;
  failedCommentDetails: string[];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim() || "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseRepoSlug(slug: string): { owner: string; repo: string } {
  const [owner, repo, extra] = slug.split("/");
  if (!owner || !repo || extra) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo (got: ${slug || "missing"})`);
  }
  return { owner, repo };
}

function readBodyFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Literature update body file was not produced: ${path}`);
  }
  return readFileSync(path, "utf8").trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function setPublishOutputs(outputs: PublishOutputs): void {
  setOutput("discussion_url", outputs.discussionUrl);
  setOutput("expected_comment_count", String(outputs.expectedCommentCount));
  setOutput("comment_count", String(outputs.postedCommentUrls.length));
  setOutput("failed_comment_count", String(outputs.failedCommentCount));
  setOutput("comment_urls", JSON.stringify(outputs.postedCommentUrls));
  setOutput("failed_comment_details", JSON.stringify(outputs.failedCommentDetails));
}

function main(): number {
  try {
    const { owner, repo } = parseRepoSlug(requiredEnv("GITHUB_REPOSITORY"));
    const category = requiredEnv("DISCUSSION_CATEGORY");
    const title = requiredEnv("DISCUSSION_TITLE");
    const raw = readBodyFile(requiredEnv("BODY_FILE"));
    const footer = process.env.DISCUSSION_FOOTER?.trim() || "";

    const parts = parseLiteratureUpdate(raw);
    if (!parts.body) {
      throw new Error("Literature update discussion body is empty");
    }

    const body = footer ? `${parts.body}\n\n---\n${footer}` : parts.body;
    const discussion = createRepositoryDiscussion(owner, repo, category, title, body);
    if (!discussion.id) {
      throw new Error("GitHub did not return an ID for the created discussion.");
    }

    const commentUrls: string[] = [];
    const expectedCommentCount = parts.comments.length;
    for (const [index, comment] of parts.comments.entries()) {
      try {
        commentUrls.push(addDiscussionComment(discussion.id, comment));
      } catch (err: unknown) {
        const failedCommentCount = expectedCommentCount - commentUrls.length;
        const detail = `comment ${index + 1}/${expectedCommentCount}: ${errorMessage(err)}`;
        setPublishOutputs({
          discussionUrl: discussion.url,
          expectedCommentCount,
          postedCommentUrls: commentUrls,
          failedCommentCount,
          failedCommentDetails: [detail],
        });
        throw new Error(
          [
            `Created literature Discussion ${discussion.url}, but failed while posting item comments.`,
            `Posted ${commentUrls.length}/${expectedCommentCount}; failed ${failedCommentCount}.`,
            detail,
          ].join(" "),
        );
      }
    }

    setPublishOutputs({
      discussionUrl: discussion.url,
      expectedCommentCount,
      postedCommentUrls: commentUrls,
      failedCommentCount: 0,
      failedCommentDetails: [],
    });
    console.log(`Discussion created: ${discussion.url}`);
    console.log(`Posted ${commentUrls.length} literature item comment(s).`);
    return 0;
  } catch (err: unknown) {
    console.error(errorMessage(err));
    return 1;
  }
}

process.exitCode = main();
