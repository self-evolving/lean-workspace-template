export interface LiteratureUpdateParts {
  body: string;
  comments: string[];
}

const OPEN_COMMENT_MARKER_PATTERN = /^\s*<!--\s*literature-item-comment\s*-->\s*$/i;
const CLOSE_COMMENT_MARKER_PATTERN = /^\s*<!--\s*\/literature-item-comment\s*-->\s*$/i;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const TRAILING_ITEM_COMMENTS_HEADING_PATTERN = /(?:\n|^)##\s+Item Comments\s*$/i;

interface FenceState {
  marker: "`" | "~";
  length: number;
}

function normalizeMarkdownBlock(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n");
}

function updateFenceState(line: string, state: FenceState | null): FenceState | null {
  const match = line.match(FENCE_PATTERN);
  if (!match) {
    return state;
  }

  const sequence = match[1] || "";
  const marker = sequence[0] as "`" | "~";
  if (!state) {
    return { marker, length: sequence.length };
  }

  if (state.marker === marker && sequence.length >= state.length) {
    return null;
  }
  return state;
}

function stripTrailingItemCommentsHeading(value: string): string {
  return normalizeMarkdownBlock(
    normalizeMarkdownBlock(value).replace(TRAILING_ITEM_COMMENTS_HEADING_PATTERN, ""),
  );
}

export function parseLiteratureUpdate(raw: string): LiteratureUpdateParts {
  const text = String(raw || "").trim();
  if (!text) {
    return { body: "", comments: [] };
  }

  const bodyLines: string[] = [];
  const comments: string[] = [];
  let commentLines: string[] | null = null;
  let fenceState: FenceState | null = null;

  for (const line of text.split(/\r?\n/)) {
    const outsideFence = fenceState === null;
    const isOpenMarker = outsideFence && OPEN_COMMENT_MARKER_PATTERN.test(line);
    const isCloseMarker = outsideFence && CLOSE_COMMENT_MARKER_PATTERN.test(line);

    if (isOpenMarker) {
      if (commentLines) {
        throw new Error("Nested literature item comment marker found before closing the previous block.");
      }
      commentLines = [];
      continue;
    }

    if (isCloseMarker) {
      if (!commentLines) {
        throw new Error("Closing literature item comment marker found without a matching opening marker.");
      }
      const comment = normalizeMarkdownBlock(commentLines.join("\n"));
      if (comment) {
        comments.push(comment);
      }
      commentLines = null;
      continue;
    }

    if (commentLines) {
      commentLines.push(line);
    } else {
      bodyLines.push(line);
    }
    fenceState = updateFenceState(line, fenceState);
  }

  if (commentLines) {
    throw new Error("Opening literature item comment marker found without a matching closing marker.");
  }

  return {
    body: stripTrailingItemCommentsHeading(bodyLines.join("\n")),
    comments,
  };
}
