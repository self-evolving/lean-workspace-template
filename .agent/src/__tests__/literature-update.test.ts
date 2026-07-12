import test from "node:test";
import assert from "node:assert/strict";
import { parseLiteratureUpdate } from "../literature-update.js";

test("parseLiteratureUpdate separates discussion body from item comments", () => {
  const parsed = parseLiteratureUpdate(`
## Research Update

- Theme one.

## Today's Items

1. **[Paper](https://example.com)** — \`paper\`, arXiv, 2026
   - **Why it matters:** Useful.

## Confidence Notes

High confidence.

## Follow-ups

- Read the paper.

## Item Comments

<!-- literature-item-comment -->
### [Paper](https://example.com)

- **Type:** paper
- **Why it matters:** Useful.
<!-- /literature-item-comment -->

<!-- literature-item-comment -->
### [Repo](https://github.com/example/repo)

- **Type:** github_repo
<!-- /literature-item-comment -->
`);

  assert.match(parsed.body, /## Research Update/);
  assert.match(parsed.body, /## Today's Items/);
  assert.doesNotMatch(parsed.body, /Item Comments/);
  assert.doesNotMatch(parsed.body, /literature-item-comment/);
  assert.equal(parsed.comments.length, 2);
  assert.match(parsed.comments[0] || "", /### \[Paper\]/);
  assert.match(parsed.comments[1] || "", /### \[Repo\]/);
});

test("parseLiteratureUpdate handles updates without item comments", () => {
  const parsed = parseLiteratureUpdate("## Research Update\n\nNo strong new item found.");

  assert.equal(parsed.body, "## Research Update\n\nNo strong new item found.");
  assert.deepEqual(parsed.comments, []);
});

test("parseLiteratureUpdate ignores empty comment blocks", () => {
  const parsed = parseLiteratureUpdate(`
## Research Update

Body.

## Item Comments

<!-- literature-item-comment -->

<!-- /literature-item-comment -->
`);

  assert.equal(parsed.body, "## Research Update\n\nBody.");
  assert.deepEqual(parsed.comments, []);
});

test("parseLiteratureUpdate rejects an unclosed item comment block", () => {
  assert.throws(
    () => parseLiteratureUpdate(`
## Research Update

Body.

## Item Comments

<!-- literature-item-comment -->
### [Paper](https://example.com)
`),
    /without a matching closing marker/,
  );
});

test("parseLiteratureUpdate rejects a stray closing item comment marker", () => {
  assert.throws(
    () => parseLiteratureUpdate(`
## Research Update

Body.

<!-- /literature-item-comment -->
`),
    /without a matching opening marker/,
  );
});

test("parseLiteratureUpdate leaves marker examples inside fenced code in the body", () => {
  const parsed = parseLiteratureUpdate(`
## Research Update

\`\`\`md
<!-- literature-item-comment -->
example only
<!-- /literature-item-comment -->
\`\`\`
`);

  assert.match(parsed.body, /```md/);
  assert.match(parsed.body, /literature-item-comment/);
  assert.deepEqual(parsed.comments, []);
});
