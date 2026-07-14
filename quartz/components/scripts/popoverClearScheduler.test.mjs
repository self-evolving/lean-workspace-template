import assert from "node:assert/strict"
import test from "node:test"

import { createPopoverClearScheduler } from "./popoverClearScheduler.ts"

class FakeTimers {
  constructor() {
    this.nextId = 1
    this.callbacks = new Map()
    this.delays = new Map()
    this.cleared = []
  }

  setTimeout(callback, delayMs) {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    this.delays.set(id, delayMs)
    return id
  }

  clearTimeout(id) {
    this.cleared.push(id)
    this.callbacks.delete(id)
  }

  delayFor(id) {
    return this.delays.get(id)
  }

  flush(id) {
    const callback = this.callbacks.get(id)
    this.callbacks.delete(id)
    callback?.()
  }
}

function createHarness() {
  const timers = new FakeTimers()
  let activeAnchor = null
  let activeTargetKey = null
  let clearCalls = 0
  const scheduler = createPopoverClearScheduler({
    delayMs: 300,
    getSnapshot: () => ({ activeAnchor, activeTargetKey }),
    clearActivePopover: () => {
      clearCalls++
      activeAnchor = null
      activeTargetKey = null
    },
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
  })

  return {
    timers,
    scheduler,
    get clearCalls() {
      return clearCalls
    },
    setActive(anchor, targetKey) {
      activeAnchor = anchor
      activeTargetKey = targetKey
    },
  }
}

test("delayed popover dismissal clears the matching active target", () => {
  const anchor = { href: "/a" }
  const harness = createHarness()

  harness.setActive(anchor, "/a")
  harness.scheduler.schedule()

  assert.equal(harness.timers.delayFor(1), 300)
  assert.equal(harness.clearCalls, 0)

  harness.timers.flush(1)

  assert.equal(harness.clearCalls, 1)
})

test("canceling pending dismissal keeps the active popover open", () => {
  const anchor = { href: "/a" }
  const harness = createHarness()

  harness.setActive(anchor, "/a")
  harness.scheduler.schedule()
  harness.scheduler.cancel()
  harness.timers.flush(1)

  assert.deepEqual(harness.timers.cleared, [1])
  assert.equal(harness.clearCalls, 0)
})

test("stale dismissal timeout cannot clear a newly hovered target", () => {
  const firstAnchor = { href: "/a" }
  const secondAnchor = { href: "/b" }
  const harness = createHarness()

  harness.setActive(firstAnchor, "/a")
  harness.scheduler.schedule()
  harness.setActive(secondAnchor, "/b")
  harness.timers.flush(1)

  assert.equal(harness.clearCalls, 0)
})

test("rescheduling cancels the earlier pending dismissal", () => {
  const anchor = { href: "/a" }
  const harness = createHarness()

  harness.setActive(anchor, "/a")
  harness.scheduler.schedule()
  harness.scheduler.schedule()
  harness.timers.flush(1)
  harness.timers.flush(2)

  assert.deepEqual(harness.timers.cleared, [1])
  assert.equal(harness.clearCalls, 1)
})
