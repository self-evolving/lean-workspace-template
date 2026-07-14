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
    this.classList = {
      contains: (token) => this.classes.has(token),
      add: (...tokens) => tokens.forEach((token) => this.classes.add(token)),
      remove: (...tokens) => tokens.forEach((token) => this.classes.delete(token)),
      toggle: (token, force) => {
        const enabled = force ?? !this.classes.has(token);
        if (enabled) this.classes.add(token);
        else this.classes.delete(token);
        return enabled;
      },
    };
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.styleTracker = trackedStyle(style);
    this.style = this.styleTracker.style;
    this.rect = rect ?? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    this.rectCalls = 0;
    this.pointerCaptures = [];
    this.fullscreenRequests = 0;
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

  requestFullscreen() {
    this.fullscreenRequests++;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(root) {
    super();
    this.root = root;
    this.fullscreenElement = null;
    this.exitFullscreenCalls = 0;
  }

  querySelectorAll(selector) {
    if (this.root.matches(selector)) return [this.root];
    return this.root.querySelectorAll(selector);
  }

  exitFullscreen() {
    this.exitFullscreenCalls++;
    this.fullscreenElement = null;
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
  const page = new FakeElement("page");
  page.dataset.frame = "canvas";
  const sidebarToggle = new FakeElement("canvas-sidebar-toggle", { tag: "button" });
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
  const zoomIn = new FakeElement("canvas-zoom-in", { tag: "button" });
  const zoomOut = new FakeElement("canvas-zoom-out", { tag: "button" });
  const fullscreen = new FakeElement("canvas-fullscreen-toggle", { tag: "button" });
  const fullscreenEnter = new FakeElement("canvas-fullscreen-enter", {
    style: { display: "" },
  });
  const fullscreenExit = new FakeElement("canvas-fullscreen-exit", {
    style: { display: "none" },
  });
  fullscreen.append(fullscreenEnter, fullscreenExit);
  controls.append(reset, zoomIn, zoomOut, fullscreen);
  container.append(controls, viewport);
  page.append(sidebarToggle, container);

  const document = new FakeDocument(page);
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
    fullscreenEnter.styleTracker.clearWrites();
    fullscreenExit.styleTracker.clearWrites();
    container.rectCalls = 0;
    frames.requestCalls = 0;
    frames.cancelCalls = [];
  };
  const cleanup = () => {
    for (const callback of cleanupCallbacks.splice(0)) callback();
  };

  return {
    page,
    sidebarToggle,
    container,
    viewport,
    reset,
    zoomIn,
    zoomOut,
    fullscreen,
    fullscreenEnter,
    fullscreenExit,
    document,
    frames,
    clearObservations,
    cleanup,
  };
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

function touchMetrics(touches) {
  const [first, second] = touches;
  const dx = first.clientX - second.clientX;
  const dy = first.clientY - second.clientY;
  return {
    distance: Math.sqrt(dx * dx + dy * dy),
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function applyPinch(state, previousTouches, nextTouches, rect, minZoom = 0.1, maxZoom = 5) {
  const previous = touchMetrics(previousTouches);
  const next = touchMetrics(nextTouches);
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, state.zoom * (next.distance / previous.distance)),
  );
  const ratio = zoom / state.zoom;
  const localX = next.x - rect.left;
  const localY = next.y - rect.top;
  return {
    x: localX - (localX - state.x) * ratio + (next.x - previous.x),
    y: localY - (localY - state.y) * ratio + (next.y - previous.y),
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

test("sidebar geometry invalidates cached wheel bounds before its layout frame", () => {
  const { page, sidebarToggle, container, frames, clearObservations } = createHarness();
  clearObservations();

  const firstWheel = container.dispatch("wheel", {
    target: container,
    clientX: 500,
    clientY: 250,
    deltaY: -1,
  });
  sidebarToggle.dispatch("click", { target: sidebarToggle });
  container.rect = {
    left: 200,
    top: 0,
    width: 800,
    height: 500,
    right: 1000,
    bottom: 500,
  };
  const wheelBeforeLayoutFrame = container.dispatch("wheel", {
    target: container,
    clientX: 500,
    clientY: 250,
    deltaY: -1,
  });

  assert.equal(firstWheel.defaultPrevented, true);
  assert.equal(wheelBeforeLayoutFrame.defaultPrevented, true);
  assert.equal(page.classes.has("canvas-sidebar-open"), true);
  assert.equal(
    container.rectCalls,
    3,
    "wheel, sidebar snapshot, and post-toggle wheel each require their own bounds",
  );
  assert.equal(frames.pending, 2, "one render and one sidebar layout frame are queued");
  frames.flush();
});

test("fullscreen geometry invalidates cached wheel bounds before its layout frame", () => {
  const { container, document, fullscreenEnter, fullscreenExit, frames, clearObservations } =
    createHarness();
  clearObservations();

  container.dispatch("wheel", {
    target: container,
    clientX: 500,
    clientY: 250,
    deltaY: -1,
  });
  container.rect = {
    left: 40,
    top: 20,
    width: 1200,
    height: 700,
    right: 1240,
    bottom: 720,
  };
  document.fullscreenElement = container;
  document.dispatch("fullscreenchange", { target: document });
  const wheelBeforeLayoutFrame = container.dispatch("wheel", {
    target: container,
    clientX: 600,
    clientY: 350,
    deltaY: 1,
  });

  assert.equal(wheelBeforeLayoutFrame.defaultPrevented, true);
  assert.equal(container.rectCalls, 2, "the pre-layout wheel must read the fullscreen bounds");
  assert.deepEqual(fullscreenEnter.styleTracker.writesFor("display"), ["none"]);
  assert.deepEqual(fullscreenExit.styleTracker.writesFor("display"), [""]);
  assert.equal(frames.pending, 2, "one render and one fullscreen layout frame are queued");
  frames.flush();
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

test("zoom and Reset controls apply synchronously without scheduling a render frame", () => {
  const { viewport, reset, zoomIn, zoomOut, frames, clearObservations } = createHarness();
  clearObservations();

  zoomIn.dispatch("click", { target: zoomIn });
  assert.equal(frames.pending, 0);
  let writes = viewport.styleTracker.writesFor("transform");
  assert.equal(writes.length, 1);
  let transform = parseTransform(writes[0]);
  assertClose(transform.x, -62.5, "zoom-in x");
  assertClose(transform.y, -31.25, "zoom-in y");
  assertClose(transform.zoom, 0.5625, "zoom-in scale");

  zoomOut.dispatch("click", { target: zoomOut });
  assert.equal(frames.pending, 0);
  writes = viewport.styleTracker.writesFor("transform");
  assert.equal(writes.length, 2);
  transform = parseTransform(writes[1]);
  assertClose(transform.x, 50, "zoom-out x");
  assertClose(transform.y, 25, "zoom-out y");
  assertClose(transform.zoom, 0.45, "zoom-out scale");

  zoomIn.dispatch("click", { target: zoomIn });
  assert.equal(frames.pending, 0);
  reset.dispatch("click", { target: reset });
  assert.equal(frames.pending, 0);
  writes = viewport.styleTracker.writesFor("transform");
  assert.equal(writes.length, 4);
  transform = parseTransform(writes[3]);
  assertClose(transform.x, 50, "Reset x");
  assertClose(transform.y, 25, "Reset y");
  assertClose(transform.zoom, 0.45, "Reset scale");
  assert.deepEqual(reset.styleTracker.writesFor("display"), ["flex", "none", "flex", "none"]);
});

test("pinch bursts reuse their rect and commit only the latest transform", () => {
  const { container, viewport, frames, clearObservations } = createHarness();
  clearObservations();

  const startTouches = [
    { clientX: 100, clientY: 100 },
    { clientX: 200, clientY: 100 },
  ];
  const firstMoveTouches = [
    { clientX: 90, clientY: 90 },
    { clientX: 220, clientY: 110 },
  ];
  const secondMoveTouches = [
    { clientX: 80, clientY: 70 },
    { clientX: 250, clientY: 140 },
  ];
  const start = container.dispatch("touchstart", {
    target: container,
    touches: startTouches,
  });
  const firstMove = container.dispatch("touchmove", {
    target: container,
    touches: firstMoveTouches,
  });
  const secondMove = container.dispatch("touchmove", {
    target: container,
    touches: secondMoveTouches,
  });

  assert.equal(start.defaultPrevented, true);
  assert.equal(firstMove.defaultPrevented, true);
  assert.equal(secondMove.defaultPrevented, true);
  assert.equal(container.rectCalls, 1);
  assert.equal(frames.pending, 1);
  assert.equal(frames.requestCalls, 1);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), []);
  frames.flush();
  const writes = viewport.styleTracker.writesFor("transform");
  assert.equal(writes.length, 1);
  const expected = applyPinch(
    applyPinch({ x: 50, y: 25, zoom: 0.45 }, startTouches, firstMoveTouches, container.rect),
    firstMoveTouches,
    secondMoveTouches,
    container.rect,
  );
  const actual = parseTransform(writes[0]);
  assertClose(actual.x, expected.x, "accumulated pinch x");
  assertClose(actual.y, expected.y, "accumulated pinch y");
  assertClose(actual.zoom, expected.zoom, "accumulated pinch zoom");
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

test("cleanup cancels queued sidebar and fullscreen layout frames without later writes", () => {
  const {
    sidebarToggle,
    container,
    viewport,
    reset,
    fullscreen,
    fullscreenEnter,
    fullscreenExit,
    document,
    frames,
    clearObservations,
    cleanup,
  } = createHarness();
  clearObservations();

  sidebarToggle.dispatch("click", { target: sidebarToggle });
  container.rect = {
    left: 180,
    top: 10,
    width: 820,
    height: 490,
    right: 1000,
    bottom: 500,
  };
  document.fullscreenElement = container;
  document.dispatch("fullscreenchange", { target: document });
  assert.equal(frames.pending, 2);

  const writesBeforeCleanup = {
    transform: viewport.styleTracker.writesFor("transform"),
    reset: reset.styleTracker.writesFor("display"),
    enter: fullscreenEnter.styleTracker.writesFor("display"),
    exit: fullscreenExit.styleTracker.writesFor("display"),
  };
  const rectCallsBeforeCleanup = container.rectCalls;
  cleanup();

  assert.equal(frames.pending, 0);
  assert.equal(frames.cancelCalls.length, 2);
  assert.equal(frames.flush(), 0);
  assert.deepEqual(viewport.styleTracker.writesFor("transform"), writesBeforeCleanup.transform);
  assert.deepEqual(reset.styleTracker.writesFor("display"), writesBeforeCleanup.reset);
  assert.deepEqual(fullscreenEnter.styleTracker.writesFor("display"), writesBeforeCleanup.enter);
  assert.deepEqual(fullscreenExit.styleTracker.writesFor("display"), writesBeforeCleanup.exit);
  assert.equal(container.rectCalls, rectCallsBeforeCleanup);
  assert.equal(sidebarToggle.listenerCount("click"), 0);
  assert.equal(fullscreen.listenerCount("click"), 0);
  assert.equal(document.listenerCount("fullscreenchange"), 0);
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
