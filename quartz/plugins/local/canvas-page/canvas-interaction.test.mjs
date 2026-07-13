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
      pointerId: init.pointerId ?? 1,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
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

function matchesSelector(element, selector) {
  return selector.split(",").some((candidate) => {
    const simple = candidate.trim();
    if (!simple) return false;
    const tag = simple.match(/^[a-z][\w-]*/i)?.[0];
    const classes = [...simple.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (classes.some((className) => !element.classes.has(className))) return false;
    if (simple.includes('[data-frame="canvas"]') && element.dataset.frame !== "canvas")
      return false;
    return true;
  });
}

function trackedStyle(initial = {}) {
  const values = { ...initial };
  const writes = new Map();
  const style = new Proxy(values, {
    set(target, property, value) {
      const key = String(property);
      const propertyWrites = writes.get(key) ?? [];
      propertyWrites.push(String(value));
      writes.set(key, propertyWrites);
      target[property] = value;
      return true;
    },
  });
  return {
    style,
    writesFor(property) {
      return [...(writes.get(property) ?? [])];
    },
    clearWrites() {
      writes.clear();
    },
  };
}

class FakeElement extends FakeEventTarget {
  constructor(classNames = "", { tag = "div", style = {}, rect } = {}) {
    super();
    this.tagName = tag.toUpperCase();
    this.classes = new Set(classNames.split(/\s+/).filter(Boolean));
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.styleTracker = trackedStyle(style);
    this.style = this.styleTracker.style;
    this.rect = rect ?? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    this.rectCalls = 0;
    this.pointerCaptures = [];
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.scrollTop = 0;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
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

  getBoundingClientRect() {
    this.rectCalls++;
    return { ...this.rect };
  }

  setPointerCapture(pointerId) {
    this.pointerCaptures.push(pointerId);
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.fullscreenElement = null;
  }

  querySelectorAll(selector) {
    if (this.container.matches(selector)) return [this.container];
    return this.container.querySelectorAll(selector);
  }
}

class FakeAnimationFrames {
  constructor() {
    this.nextId = 1;
    this.callbacks = new Map();
    this.requestCalls = 0;
    this.cancelCalls = [];
    this.requestAnimationFrame = (callback) => {
      const id = this.nextId++;
      this.requestCalls++;
      this.callbacks.set(id, callback);
      return id;
    };
    this.cancelAnimationFrame = (id) => {
      this.cancelCalls.push(id);
      this.callbacks.delete(id);
    };
  }

  get pending() {
    return this.callbacks.size;
  }

  flush() {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(0);
    return callbacks.length;
  }
}

function extractBaseCanvasScript() {
  const script = CanvasBody().afterDOMLoaded;
  assert.equal(typeof script, "string");
  const firstLocalIife = script.indexOf(";(() => {");
  assert.notEqual(firstLocalIife, -1, "a local IIFE must delimit the base canvas script");
  return script.slice(0, firstLocalIife);
}

function createHarness({ minZoom = "0.1", maxZoom = "5" } = {}) {
  const container = new FakeElement("canvas-container", {
    rect: { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 },
  });
  Object.assign(container.dataset, {
    enableInteraction: "true",
    initialZoom: "1",
    minZoom,
    maxZoom,
  });
  const viewport = new FakeElement("canvas-viewport", {
    style: { width: "2000px", height: "1000px" },
  });
  const controls = new FakeElement("canvas-controls");
  const reset = new FakeElement("canvas-reset-view", {
    tag: "button",
    style: { display: "none" },
  });
  controls.append(reset);
  container.append(controls, viewport);

  const document = new FakeDocument(container);
  const frames = new FakeAnimationFrames();
  const cleanupCallbacks = [];
  const window = {
    addCleanup: (callback) => cleanupCallbacks.push(callback),
    requestAnimationFrame: frames.requestAnimationFrame,
    cancelAnimationFrame: frames.cancelAnimationFrame,
  };
  const evaluate = new Function(
    "document",
    "window",
    "HTMLElement",
    "Element",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    extractBaseCanvasScript(),
  );
  evaluate(
    document,
    window,
    FakeElement,
    FakeElement,
    frames.requestAnimationFrame,
    frames.cancelAnimationFrame,
  );
  document.dispatch("nav");

  const clearObservations = () => {
    viewport.styleTracker.clearWrites();
    reset.styleTracker.clearWrites();
    container.rectCalls = 0;
    frames.requestCalls = 0;
    frames.cancelCalls = [];
  };
  const cleanup = () => {
    for (const callback of cleanupCallbacks.splice(0)) callback();
  };

  return { container, viewport, reset, document, frames, clearObservations, cleanup };
}

function pointer(container, type, clientX, clientY) {
  return container.dispatch(type, {
    target: container,
    button: 0,
    pointerId: 7,
    clientX,
    clientY,
  });
}

function parseTransform(value) {
  const match = value.match(/^translate\(([-+\d.e]+)px, ([-+\d.e]+)px\) scale\(([-+\d.e]+)\)$/i);
  assert.ok(match, `unexpected canvas transform: ${value}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

function assertClose(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function applyWheel(state, { clientX, clientY, deltaY }, minZoom = 0.1, maxZoom = 5) {
  const factor = deltaY > 0 ? 0.9 : 1.1;
  const zoom = Math.max(minZoom, Math.min(maxZoom, state.zoom * factor));
  return {
    x: clientX - (clientX - state.x) * (zoom / state.zoom),
    y: clientY - (clientY - state.y) * (zoom / state.zoom),
    zoom,
  };
}

test("canvas interaction initialization writes the fitted transform synchronously", () => {
  const { viewport, frames, container } = createHarness();

  assert.deepEqual(viewport.styleTracker.writesFor("transform"), [
    "translate(50px, 25px) scale(0.45)",
  ]);
  assert.equal(container.rectCalls, 1);
  assert.equal(frames.pending, 0);
});

test("multiple drag moves schedule one frame with the latest transform", () => {
  const { container, viewport, frames, clearObservations } = createHarness();
  clearObservations();

  pointer(container, "pointerdown", 100, 100);
  pointer(container, "pointermove", 110, 120);
  pointer(container, "pointermove", 140, 170);
  pointer(container, "pointermove", 175, 210);
  pointer(container, "pointerup", 175, 210);

  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  assert.equal(frames.pending, 1);
  assert.equal(frames.requestCalls, 1);
  assert.equal(frames.flush(), 1);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), [
    "translate(125px, 135px) scale(0.45)",
  ]);
});

test("wheel bursts read the canvas rect at most once per frame and write once", () => {
  const { container, viewport, frames, clearObservations } = createHarness();
  clearObservations();

  const firstInput = { clientX: 500, clientY: 250, deltaY: -1 };
  const secondInput = { clientX: 250, clientY: 100, deltaY: -1 };
  const first = container.dispatch("wheel", {
    target: container,
    ...firstInput,
  });
  const second = container.dispatch("wheel", {
    target: container,
    ...secondInput,
  });

  assert.equal(first.defaultPrevented, true);
  assert.equal(second.defaultPrevented, true);
  assert.equal(container.rectCalls, 1);
  assert.equal(frames.pending, 1);
  assert.equal(frames.requestCalls, 1);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  frames.flush();
  const firstFrameWrites = viewport.styleTracker.writesFor("transform");
  assert.equal(firstFrameWrites.length, 1);
  const expected = applyWheel(applyWheel({ x: 50, y: 25, zoom: 0.45 }, firstInput), secondInput);
  const actual = parseTransform(firstFrameWrites[0]);
  assertClose(actual.x, expected.x, "accumulated wheel x");
  assertClose(actual.y, expected.y, "accumulated wheel y");
  assertClose(actual.zoom, expected.zoom, "accumulated wheel zoom");

  const thirdInput = { clientX: 800, clientY: 400, deltaY: 1 };
  const third = container.dispatch("wheel", {
    target: container,
    ...thirdInput,
  });
  assert.equal(third.defaultPrevented, true);
  assert.equal(container.rectCalls, 2, "the next frame may take one fresh rect measurement");
  frames.flush();
  const secondFrameWrites = viewport.styleTracker.writesFor("transform");
  assert.equal(secondFrameWrites.length, 2);
  const nextExpected = applyWheel(expected, thirdInput);
  const nextActual = parseTransform(secondFrameWrites[1]);
  assertClose(nextActual.x, nextExpected.x, "next-frame wheel x");
  assertClose(nextActual.y, nextExpected.y, "next-frame wheel y");
  assertClose(nextActual.zoom, nextExpected.zoom, "next-frame wheel zoom");
});

test("wheel bypasses selection panels and independently scrollable node content", () => {
  const { container, viewport, reset, frames, clearObservations } = createHarness();
  const selectionPanel = new FakeElement("canvas-selection-panel");
  const nodeContent = new FakeElement("canvas-node-content");
  nodeContent.scrollHeight = 1000;
  nodeContent.clientHeight = 200;
  nodeContent.scrollTop = 300;
  container.append(selectionPanel, nodeContent);
  clearObservations();

  const panelWheel = container.dispatch("wheel", {
    target: selectionPanel,
    clientX: 500,
    clientY: 250,
    deltaY: -1,
  });
  const contentWheel = container.dispatch("wheel", {
    target: nodeContent,
    clientX: 500,
    clientY: 250,
    deltaY: 1,
  });

  assert.equal(panelWheel.defaultPrevented, false);
  assert.equal(contentWheel.defaultPrevented, false);
  assert.equal(container.rectCalls, 0);
  assert.equal(frames.pending, 0);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  assert.deepEqual(reset.styleTracker.writesFor("display"), []);
});

test("a zoom clamped to the current transform does not write it again", () => {
  const { container, viewport, reset, frames, clearObservations } = createHarness({
    maxZoom: "0.45",
  });
  clearObservations();

  container.dispatch("wheel", {
    target: container,
    clientX: 500,
    clientY: 250,
    deltaY: -1,
  });
  frames.flush();

  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  assert.deepEqual(reset.styleTracker.writesFor("display"), []);
});

test("pinch bursts reuse their rect and commit only the latest transform", () => {
  const { container, viewport, frames, clearObservations } = createHarness();
  clearObservations();

  container.dispatch("touchstart", {
    target: container,
    touches: [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ],
  });
  container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 90, clientY: 90 },
      { clientX: 210, clientY: 110 },
    ],
  });
  container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 80, clientY: 80 },
      { clientX: 220, clientY: 120 },
    ],
  });

  assert.equal(container.rectCalls, 1);
  assert.equal(frames.pending, 1);
  assert.equal(frames.requestCalls, 1);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  frames.flush();
  assert.equal(viewport.styleTracker.writesFor("transform").length, 1);
});

test("a zero-distance pinch cannot poison later transforms", () => {
  const { container, viewport, frames, clearObservations } = createHarness();
  clearObservations();

  const start = container.dispatch("touchstart", {
    target: container,
    touches: [
      { clientX: 100, clientY: 100 },
      { clientX: 100, clientY: 100 },
    ],
  });
  const staleMove = container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 90, clientY: 100 },
      { clientX: 110, clientY: 100 },
    ],
  });

  assert.equal(start.defaultPrevented, true);
  assert.equal(staleMove.defaultPrevented, false);
  assert.equal(container.rectCalls, 0);
  assert.equal(frames.pending, 0);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
});

test("third-finger and touchcancel interruptions require a fresh pinch gesture", () => {
  const { container, viewport, frames, clearObservations } = createHarness();
  clearObservations();

  const initialStart = container.dispatch("touchstart", {
    target: container,
    touches: [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ],
  });
  const thirdFinger = container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 90, clientY: 90 },
      { clientX: 210, clientY: 110 },
      { clientX: 150, clientY: 150 },
    ],
  });
  const staleAfterThirdFinger = container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 80, clientY: 80 },
      { clientX: 220, clientY: 120 },
    ],
  });

  assert.equal(initialStart.defaultPrevented, true);
  assert.equal(thirdFinger.defaultPrevented, false);
  assert.equal(staleAfterThirdFinger.defaultPrevented, false);
  assert.equal(frames.pending, 0);

  const freshStart = container.dispatch("touchstart", {
    target: container,
    touches: [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ],
  });
  const freshMove = container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 90, clientY: 90 },
      { clientX: 210, clientY: 110 },
    ],
  });
  assert.equal(freshStart.defaultPrevented, true);
  assert.equal(freshMove.defaultPrevented, true);
  assert.equal(container.rectCalls, 2, "each valid fresh pinch measures its own rect once");
  frames.flush();
  assert.equal(viewport.styleTracker.writesFor("transform").length, 1);

  container.dispatch("touchcancel", { target: container, touches: [] });
  const staleAfterCancel = container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 80, clientY: 80 },
      { clientX: 220, clientY: 120 },
    ],
  });
  assert.equal(staleAfterCancel.defaultPrevented, false);
  assert.equal(frames.pending, 0);
  assert.equal(viewport.styleTracker.writesFor("transform").length, 1);

  const postCancelStart = container.dispatch("touchstart", {
    target: container,
    touches: [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ],
  });
  const postCancelMove = container.dispatch("touchmove", {
    target: container,
    touches: [
      { clientX: 95, clientY: 90 },
      { clientX: 205, clientY: 110 },
    ],
  });
  assert.equal(postCancelStart.defaultPrevented, true);
  assert.equal(postCancelMove.defaultPrevented, true);
  assert.equal(container.rectCalls, 3);
  frames.flush();
  assert.equal(viewport.styleTracker.writesFor("transform").length, 2);
  assert.ok(viewport.styleTracker.writesFor("transform").every((value) => !value.includes("NaN")));
});

test("reset control display changes only when its visibility changes", () => {
  const { container, reset, frames, clearObservations } = createHarness();
  clearObservations();

  pointer(container, "pointerdown", 100, 100);
  pointer(container, "pointermove", 120, 120);
  frames.flush();
  assert.deepEqual(reset.styleTracker.writesFor("display"), ["flex"]);

  pointer(container, "pointermove", 140, 140);
  frames.flush();
  assert.deepEqual(reset.styleTracker.writesFor("display"), ["flex"]);
  pointer(container, "pointerup", 140, 140);

  reset.dispatch("click", { target: reset });
  frames.flush();
  assert.deepEqual(reset.styleTracker.writesFor("display"), ["flex", "none"]);

  reset.dispatch("click", { target: reset });
  frames.flush();
  assert.deepEqual(reset.styleTracker.writesFor("display"), ["flex", "none"]);
});

test("cleanup cancels a pending frame and removes interaction listeners", () => {
  const { container, viewport, frames, clearObservations, cleanup } = createHarness();
  clearObservations();

  pointer(container, "pointerdown", 100, 100);
  pointer(container, "pointermove", 150, 150);
  assert.equal(frames.pending, 1);

  cleanup();

  assert.equal(frames.pending, 0);
  assert.equal(frames.cancelCalls.length, 1);
  assert.equal(frames.flush(), 0);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  for (const eventName of [
    "wheel",
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
  ]) {
    assert.equal(container.listenerCount(eventName), 0, `${eventName} listener must be removed`);
  }
  assert.equal(container.dataset.initialized, "false");
});
