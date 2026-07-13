import assert from "node:assert/strict";
import test from "node:test";
import render from "preact-render-to-string";

import { CanvasBody } from "./dist/index.js";

const nodes = [
  {
    id: "a",
    type: "file",
    file: "a.md",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    bpTitle: "A",
  },
  {
    id: "b",
    type: "file",
    file: "b.md",
    x: 200,
    y: 0,
    width: 100,
    height: 60,
    bpTitle: "B",
  },
];

function renderCanvas(edges) {
  const Component = CanvasBody();
  return render(
    Component({
      fileData: {
        slug: "blueprint/test.canvas",
        canvasData: { nodes, edges },
      },
      allFiles: [],
    }),
  );
}

test("shares arrow markers by direction and resolved stroke color", () => {
  const html = renderCanvas([
    { id: "one", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" },
    {
      id: "two",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      dashed: true,
    },
    {
      id: "three",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      color: "1",
      label: "colored",
    },
    {
      id: "four",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      fromEnd: "arrow",
      toEnd: "none",
    },
  ]);

  assert.equal(html.match(/<defs/g)?.length, 1);
  assert.equal(html.match(/<marker/g)?.length, 3);
  assert.equal(html.match(/marker-end="url\(#canvas-arrow-[^"]+-end-0\)"/g)?.length, 2);
  assert.match(html, /marker-end="url\(#canvas-arrow-[^"]+-end-1\)"/);
  assert.match(html, /marker-start="url\(#canvas-arrow-[^"]+-start-0\)"/);
  assert.match(html, /stroke-dasharray="7 5"/);
  assert.doesNotMatch(html, /<g class="canvas-edge"/);
  assert.match(html, /<path class="canvas-edge" data-edge-id="one" data-from="a" data-to="b"/);
  assert.match(html, /class="canvas-edge-label-group"/);
});

test("omits marker definitions when no edge has an arrow", () => {
  const html = renderCanvas([
    {
      id: "none",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      fromEnd: "none",
      toEnd: "none",
    },
  ]);

  assert.doesNotMatch(html, /<defs/);
  assert.doesNotMatch(html, /<marker/);
  assert.doesNotMatch(html, /marker-(?:start|end)=/);
});

test("shares the decorative sidebar icon through CSS", () => {
  const Component = CanvasBody();
  const html = render(
    Component({
      fileData: {
        slug: "blueprint/test.canvas",
        canvasData: { nodes, edges: [] },
      },
      allFiles: [],
    }),
  );
  const buttons = [...html.matchAll(/<button class="canvas-open-sidebar"[^>]*>(.*?)<\/button>/g)];

  assert.equal(buttons.length, nodes.length);
  assert.ok(buttons.every((match) => match[1] === ""));
  assert.match(html, /aria-label="Open A in sidebar"/);
  assert.match(Component.css, /\.canvas-open-sidebar::before/);
  assert.match(Component.css, /mask-image: url\("data:image\/svg\+xml/);
});
