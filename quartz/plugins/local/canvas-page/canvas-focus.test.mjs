import assert from "node:assert/strict";
import test from "node:test";
import { CanvasBody } from "./dist/index.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = false) {
    const capture = options === true || options?.capture === true;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, capture });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener, options = false) {
    const capture = options === true || options?.capture === true;
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener || entry.capture !== capture),
    );
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      target: init.target ?? this,
      relatedTarget: init.relatedTarget ?? null,
      button: init.button ?? 0,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      defaultPrevented: init.defaultPrevented ?? false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      ...init,
    };

    for (const { listener } of [...(this.listeners.get(type) ?? [])]) {
      listener.call(this, event);
    }
    return event;
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }
}

class FakeClassList {
  constructor(tokens = []) {
    this.tokens = new Set(tokens);
    this.mutationCalls = 0;
  }

  add(...tokens) {
    this.mutationCalls++;
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens) {
    this.mutationCalls++;
    for (const token of tokens) this.tokens.delete(token);
  }

  toggle(token, force) {
    this.mutationCalls++;
    if (force === true || (force === undefined && !this.tokens.has(token))) {
      this.tokens.add(token);
      return true;
    }
    this.tokens.delete(token);
    return false;
  }

  contains(token) {
    return this.tokens.has(token);
  }

  reset() {
    this.mutationCalls = 0;
  }

  toString() {
    return [...this.tokens].join(" ");
  }
}

function dataProperty(attribute) {
  return attribute
    .slice(5)
    .split("-")
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");
}

function matchesSelector(element, selector) {
  return selector.split(",").some((candidate) => {
    const simple = candidate.trim();
    if (!simple) return false;

    const attributes = [...simple.matchAll(/\[([^\]=]+)(?:=[^\]]+)?\]/g)].map((match) => match[1]);
    const classes = [...simple.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
    const tag = simple.match(/^[a-z][\w-]*/i)?.[0];

    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (classes.some((className) => !element.classList.contains(className))) return false;
    return attributes.every((attribute) => {
      if (attribute.startsWith("data-")) {
        return element.dataset[dataProperty(attribute)] !== undefined;
      }
      return element.getAttribute(attribute) !== null;
    });
  });
}

class FakeElement extends FakeEventTarget {
  constructor(tagName = "div", classNames = []) {
    super();
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList(classNames);
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.childMutationCalls = 0;
    this.attributeMutationCalls = 0;
    this.propertyMutationCalls = 0;
    this._hidden = false;
    this._id = "";
    this._textContent = "";
    this._title = "";
    this._type = "";
  }

  set className(value) {
    this.classList.tokens = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return this.classList.toString();
  }

  set hidden(value) {
    this.propertyMutationCalls++;
    this._hidden = Boolean(value);
  }

  get hidden() {
    return this._hidden;
  }

  set id(value) {
    this.propertyMutationCalls++;
    this._id = String(value);
  }

  get id() {
    return this._id;
  }

  set textContent(value) {
    this.propertyMutationCalls++;
    this._textContent = String(value);
  }

  get textContent() {
    if (this.children.length > 0) return this.children.map((child) => child.textContent).join("");
    return this._textContent;
  }

  set title(value) {
    this.propertyMutationCalls++;
    this._title = String(value);
  }

  get title() {
    return this._title;
  }

  set type(value) {
    this.propertyMutationCalls++;
    this._type = String(value);
  }

  get type() {
    return this._type;
  }

  setAttribute(name, value) {
    this.attributeMutationCalls++;
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    this.childMutationCalls++;
    for (const child of children) {
      if (!(child instanceof FakeElement)) throw new TypeError("fake DOM only accepts elements");
      child.parentElement = this;
      this.children.push(child);
    }
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  replaceChildren(...children) {
    this.childMutationCalls++;
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  resetMutationCounters() {
    this.classList.reset();
    this.childMutationCalls = 0;
    this.attributeMutationCalls = 0;
    this.propertyMutationCalls = 0;
    for (const child of this.children) child.resetMutationCounters();
  }

  domMutationCalls() {
    return this.childMutationCalls + this.attributeMutationCalls + this.propertyMutationCalls;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(roots) {
    super();
    this.roots = roots;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const root of this.roots) {
      if (root.matches(selector)) matches.push(root);
      matches.push(...root.querySelectorAll(selector));
    }
    return matches;
  }
}

function element(classNames, { tag = "div", dataset = {}, text = "" } = {}) {
  const result = new FakeElement(tag, classNames.split(/\s+/).filter(Boolean));
  Object.assign(result.dataset, dataset);
  result._textContent = text;
  return result;
}

function fileNode(id, label) {
  const node = element("canvas-node canvas-node-file", { dataset: { nodeId: id } });
  const title = element("canvas-card-title", { tag: "a", text: label });
  const firstChild = element("node-child");
  const secondChild = element("node-child");
  node.append(title, firstChild, secondChild);
  return { node, firstChild, secondChild };
}

function edge(id, from, to) {
  return element("canvas-edge", { dataset: { edgeId: id, from, to } });
}

function extractFocusIife() {
  const afterDOMLoaded = CanvasBody().afterDOMLoaded;
  assert.equal(typeof afterDOMLoaded, "string");
  const start = afterDOMLoaded.indexOf(";(() => {");
  const end = afterDOMLoaded.indexOf("\n;(() => {", start + 1);
  assert.notEqual(start, -1, "focus IIFE must be appended to CanvasBody.afterDOMLoaded");
  assert.notEqual(end, -1, "legend IIFE must delimit the appended focus IIFE");
  return afterDOMLoaded.slice(start, end);
}

function createHarness() {
  const container = element("canvas-container");
  const controls = element("canvas-controls");
  const selectionControl = element("canvas-selection-clear", { tag: "button" });
  controls.append(selectionControl);

  const a = fileNode("a", "A");
  const b = fileNode("b", "B");
  const c = fileNode("c", "C");
  const isolated = fileNode("isolated", "Isolated");
  const ab = edge("ab", "a", "b");
  const ca = edge("ca", "c", "a");
  const bc = edge("bc", "b", "c");
  container.append(controls, ab, ca, bc, a.node, b.node, c.node, isolated.node);

  const document = new FakeDocument([container]);
  const cleanupFns = [];
  const window = { addCleanup: (cleanup) => cleanupFns.push(cleanup) };
  const evaluate = new Function("document", "window", "Element", extractFocusIife());
  evaluate(document, window, FakeElement);
  document.dispatch("nav");

  const selectionPanel = container.querySelector(".canvas-selection-panel");
  assert.ok(selectionPanel, "focus script creates its selection panel");

  const graphElements = [container, a.node, b.node, c.node, isolated.node, ab, ca, bc];
  const resetCounters = () => {
    container.resetMutationCounters();
  };
  const graphClassCalls = () =>
    graphElements.reduce((total, item) => total + item.classList.mutationCalls, 0);
  const selectionUiCalls = () =>
    selectionPanel.domMutationCalls() + selectionControl.domMutationCalls();
  const cleanup = () => {
    for (const callback of cleanupFns.splice(0)) callback();
  };

  resetCounters();
  return {
    container,
    selectionControl,
    selectionPanel,
    document,
    nodes: { a, b, c, isolated },
    edges: { ab, ca, bc },
    resetCounters,
    graphClassCalls,
    selectionUiCalls,
    cleanup,
  };
}

test("delegated canvas hover updates only the local dependency neighborhood", () => {
  const harness = createHarness();
  const { container, nodes, edges } = harness;

  container.dispatch("mouseover", {
    target: nodes.a.firstChild,
    relatedTarget: container,
  });

  assert.equal(container.classList.contains("canvas-hovering"), true);
  assert.equal(nodes.a.node.classList.contains("hover-focus"), true);
  assert.equal(nodes.b.node.classList.contains("hover-neighbor"), true);
  assert.equal(nodes.c.node.classList.contains("hover-neighbor"), true);
  assert.equal(edges.ab.classList.contains("hover-edge"), true);
  assert.equal(edges.ca.classList.contains("hover-edge"), true);
  assert.equal(edges.bc.classList.contains("hover-edge"), false);
  assert.equal(nodes.isolated.node.classList.mutationCalls, 0);
  assert.equal(edges.bc.classList.mutationCalls, 0);

  harness.resetCounters();
  container.dispatch("mouseout", {
    target: nodes.a.firstChild,
    relatedTarget: nodes.a.secondChild,
  });
  container.dispatch("mouseover", {
    target: nodes.a.secondChild,
    relatedTarget: nodes.a.firstChild,
  });

  assert.equal(harness.graphClassCalls(), 0, "moving within a card must not churn classes");
  assert.equal(harness.selectionUiCalls(), 0, "moving within a card must not rebuild the panel");

  container.dispatch("mouseout", {
    target: nodes.a.secondChild,
    relatedTarget: container,
  });
  assert.equal(container.classList.contains("canvas-hovering"), false);
  assert.equal(nodes.a.node.classList.contains("hover-focus"), false);
  assert.equal(nodes.b.node.classList.contains("hover-neighbor"), false);
  assert.equal(nodes.c.node.classList.contains("hover-neighbor"), false);
});

test("selection and hover use separate focus renderers", () => {
  const script = extractFocusIife();

  assert.match(script, /const applySelectionFocus =/);
  assert.doesNotMatch(script, /const applyFocus =/);
  assert.doesNotMatch(script, /kind === "selection"/);
});

test("selection suppresses hover mutations and clearing restores the latent hover", () => {
  const harness = createHarness();
  const { container, nodes, edges, selectionPanel } = harness;

  container.dispatch("mouseover", { target: nodes.a.node, relatedTarget: container });
  container.dispatch("click", { target: nodes.a.node });
  assert.equal(container.classList.contains("canvas-selecting"), true);
  assert.equal(nodes.a.node.classList.contains("selection-focus"), true);

  harness.resetCounters();
  container.dispatch("mouseout", { target: nodes.a.node, relatedTarget: nodes.b.node });
  container.dispatch("mouseover", { target: nodes.b.node, relatedTarget: nodes.a.node });

  assert.equal(harness.graphClassCalls(), 0, "hover must not rewrite focus classes while selected");
  assert.equal(harness.selectionUiCalls(), 0, "hover must not rebuild selection UI while selected");
  assert.equal(selectionPanel.childMutationCalls, 0);

  container.dispatch("click", { target: container });
  assert.equal(container.classList.contains("canvas-selecting"), false);
  assert.equal(container.classList.contains("canvas-hovering"), true);
  assert.equal(nodes.b.node.classList.contains("hover-focus"), true);
  assert.equal(nodes.a.node.classList.contains("hover-neighbor"), true);
  assert.equal(nodes.c.node.classList.contains("hover-neighbor"), true);
  assert.equal(edges.ab.classList.contains("hover-edge"), true);
  assert.equal(edges.bc.classList.contains("hover-edge"), true);
  assert.equal(edges.ca.classList.contains("hover-edge"), false);
});

test("canvas focus cleanup removes listeners and active classes", () => {
  const harness = createHarness();
  const { container, nodes, edges, selectionControl } = harness;

  container.dispatch("mouseover", { target: nodes.a.node, relatedTarget: container });
  assert.equal(container.classList.contains("canvas-hovering"), true);

  harness.cleanup();

  for (const className of ["canvas-hovering", "canvas-selecting"]) {
    assert.equal(container.classList.contains(className), false);
  }
  for (const { node } of Object.values(nodes)) {
    for (const className of [
      "hover-focus",
      "hover-neighbor",
      "selection-focus",
      "selection-neighbor",
    ]) {
      assert.equal(node.classList.contains(className), false);
    }
  }
  for (const edgeElement of Object.values(edges)) {
    assert.equal(edgeElement.classList.contains("hover-edge"), false);
    assert.equal(edgeElement.classList.contains("selection-edge"), false);
  }
  for (const eventName of [
    "mouseover",
    "mouseout",
    "pointerdown",
    "pointermove",
    "pointerup",
    "click",
  ]) {
    assert.equal(container.listenerCount(eventName), 0, `${eventName} listener must be removed`);
  }
  assert.equal(selectionControl.listenerCount("click"), 0);
  assert.equal(container.dataset.hoverInit, "false");

  container.dispatch("mouseover", { target: nodes.b.node, relatedTarget: container });
  assert.equal(container.classList.contains("canvas-hovering"), false);
  assert.equal(nodes.b.node.classList.contains("hover-focus"), false);
});
