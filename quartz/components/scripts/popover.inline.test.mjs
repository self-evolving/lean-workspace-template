import assert from "node:assert/strict"
import test from "node:test"

import { build } from "esbuild"

import {
  bindPopoverTriggers,
  buildPopoverTarget,
  popoverHrefFor,
  shouldSkipPopoverTrigger,
  syncCanvasPopoverAction,
} from "./popoverActions.ts"

const popoverInlineUrl = new URL("./popover.inline.ts", import.meta.url)

class FakeClassList {
  values = new Set()

  add(...names) {
    for (const name of names) this.values.add(name)
  }

  remove(...names) {
    for (const name of names) this.values.delete(name)
  }

  contains(name) {
    return this.values.has(name)
  }

  setFromString(value) {
    this.values = new Set(value.split(/\s+/).filter(Boolean))
  }

  toString() {
    return [...this.values].join(" ")
  }
}

class FakeElement {
  constructor(tagName = "div", ownerDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
    this.dataset = {}
    this.children = []
    this.parentElement = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.classList = new FakeClassList()
    this.textContent = ""
    this.title = ""
  }

  get className() {
    return this.classList.toString()
  }

  set className(value) {
    this.classList.setFromString(value)
  }

  appendChild(child) {
    child.remove()
    child.parentElement = this
    child.ownerDocument = this.ownerDocument
    this.children.push(child)
    return child
  }

  remove() {
    if (!this.parentElement) return
    const siblings = this.parentElement.children
    const index = siblings.indexOf(this)
    if (index !== -1) siblings.splice(index, 1)
    this.parentElement = null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === "class") this.className = String(value)
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }

  removeEventListener(type, handler) {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      listeners.filter((listener) => listener !== handler),
    )
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length
  }

  querySelector(selector) {
    return findDescendant(this, (element) => matchesSelector(element, selector))
  }

  querySelectorAll(selector) {
    return findDescendants(this, (element) => matchesSelectorList(element, selector))
  }

  closest(selector) {
    let cursor = this
    while (cursor) {
      if (matchesSelectorList(cursor, selector)) return cursor
      cursor = cursor.parentElement
    }
    return null
  }
}

class FakeAnchorElement extends FakeElement {
  constructor(ownerDocument) {
    super("a", ownerDocument)
    this.href = ""
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body", this)
  }

  createElement(tagName) {
    return tagName.toLowerCase() === "a"
      ? new FakeAnchorElement(this)
      : new FakeElement(tagName, this)
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector)
  }
}

globalThis.HTMLElement = FakeElement
globalThis.HTMLAnchorElement = FakeAnchorElement

function matchesSelectorList(element, selectorList) {
  return selectorList.split(",").some((selector) => matchesSelector(element, selector.trim()))
}

function matchesSelector(element, selector) {
  const tagAndClass = selector.match(/^([a-z]+)\.([A-Za-z0-9_-]+)$/)
  if (tagAndClass) {
    return (
      element.tagName.toLowerCase() === tagAndClass[1] && element.classList.contains(tagAndClass[2])
    )
  }

  const classOnly = selector.match(/^\.([A-Za-z0-9_-]+)$/)
  if (classOnly) return element.classList.contains(classOnly[1])

  const dataAttr = selector.match(/^\[data-([A-Za-z0-9_-]+)\]$/)
  if (dataAttr) return datasetKey(dataAttr[1]) in element.dataset

  return element.tagName.toLowerCase() === selector.toLowerCase()
}

function datasetKey(attrName) {
  return attrName.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function findDescendant(element, predicate) {
  for (const child of element.children) {
    if (predicate(child)) return child
    const nested = findDescendant(child, predicate)
    if (nested) return nested
  }
  return null
}

function findDescendants(element, predicate, matches = []) {
  for (const child of element.children) {
    if (predicate(child)) matches.push(child)
    findDescendants(child, predicate, matches)
  }
  return matches
}

test("binds data-popover targets once and cleans up listeners", () => {
  const doc = new FakeDocument()
  const trigger = doc.createElement("span")
  trigger.dataset.popoverHref = "/blueprint/chapter#item"
  doc.body.appendChild(trigger)
  const cleanups = []
  const onEnter = () => {}
  const onLeave = () => {}

  bindPopoverTriggers(doc, onEnter, onLeave, (cleanup) => cleanups.push(cleanup))
  bindPopoverTriggers(doc, onEnter, onLeave, (cleanup) => cleanups.push(cleanup))

  assert.equal(trigger.dataset.popoverBound, "true")
  assert.equal(trigger.listenerCount("mouseenter"), 1)
  assert.equal(trigger.listenerCount("mouseleave"), 1)
  assert.equal(cleanups.length, 1)

  cleanups[0]()

  assert.equal(trigger.dataset.popoverBound, undefined)
  assert.equal(trigger.listenerCount("mouseenter"), 0)
  assert.equal(trigger.listenerCount("mouseleave"), 0)
})

test("resolves data-popover targets and skip state behaviorally", () => {
  const doc = new FakeDocument()
  const canvas = doc.createElement("div")
  canvas.className = "canvas-container"
  const trigger = doc.createElement("span")
  trigger.dataset.popoverHref = "chapter?draft=1#target%20id"
  canvas.appendChild(trigger)
  doc.body.appendChild(canvas)

  const target = buildPopoverTarget(trigger, "https://example.test/blueprint/dep-graph")

  assert.equal(popoverHrefFor(trigger), "chapter?draft=1#target%20id")
  assert.equal(target.targetUrl.href, "https://example.test/blueprint/chapter?draft=1#target%20id")
  assert.equal(target.fetchUrl.href, "https://example.test/blueprint/chapter")
  assert.equal(target.hash, "#target id")
  assert.equal(target.isCanvasLink, true)
  assert.equal(shouldSkipPopoverTrigger(trigger), false)

  trigger.dataset.noPopover = "true"
  assert.equal(shouldSkipPopoverTrigger(trigger), true)

  const emptyTrigger = doc.createElement("span")
  assert.equal(shouldSkipPopoverTrigger(emptyTrigger), true)

  const anchor = doc.createElement("a")
  anchor.href = "https://example.test/page"
  assert.equal(popoverHrefFor(anchor), "https://example.test/page")
})

test("syncs canvas popover action insertion, removal, no-popover, and cached href updates", () => {
  const doc = new FakeDocument()
  const popover = doc.createElement("div")
  const inner = doc.createElement("div")
  inner.className = "popover-inner"
  popover.appendChild(inner)

  syncCanvasPopoverAction(popover, {
    isCanvasLink: true,
    targetUrl: new URL("https://example.test/blueprint/chapter#first"),
  })

  const actionBar = popover.querySelector(".popover-canvas-actions")
  const link = actionBar.querySelector("a.popover-open-page")

  assert.ok(actionBar)
  assert.equal(actionBar.parentElement, popover)
  assert.equal(inner.querySelector(".popover-canvas-actions"), null)
  assert.equal(link.textContent, "Open page")
  assert.equal(link.dataset.noPopover, "true")
  assert.equal(shouldSkipPopoverTrigger(link), true)
  assert.equal(link.href, "https://example.test/blueprint/chapter#first")

  syncCanvasPopoverAction(popover, {
    isCanvasLink: true,
    targetUrl: new URL("https://example.test/blueprint/chapter#second"),
  })

  assert.equal(actionBar.querySelector("a.popover-open-page"), link)
  assert.equal(link.href, "https://example.test/blueprint/chapter#second")

  syncCanvasPopoverAction(popover, {
    isCanvasLink: false,
    targetUrl: new URL("https://example.test/blueprint/chapter#second"),
  })

  assert.equal(popover.querySelector(".popover-canvas-actions"), null)
})

test("popover inline script bundles with the canvas action helpers", async () => {
  const result = await build({
    entryPoints: [popoverInlineUrl.pathname],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  })
  const bundled = result.outputFiles[0]?.text ?? ""

  assert.match(bundled, /popover-canvas-actions/)
  assert.match(bundled, /\[data-popover-href\]/)
  assert.match(bundled, /Open page/)
})
