import assert from "node:assert/strict";
import test from "node:test";

import { registerNavigationTarget } from "../src/background/navigation-target-handler.js";
import {
  NavigationTracker,
  OPENER_RELATIONSHIP_SOURCES,
} from "../src/background/navigation-tracker.js";

class MemoryStorageArea {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key)
      ? { [key]: structuredClone(this.values.get(key)) }
      : {};
  }

  async set(items) {
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, structuredClone(value));
    }
  }

  async remove(key) {
    this.values.delete(key);
  }
}

function tab(overrides = {}) {
  return {
    id: 20,
    windowId: 3,
    active: true,
    pinned: false,
    discarded: false,
    incognito: false,
    groupId: -1,
    ...overrides,
  };
}

function tabsApiFrom(tabs) {
  const values = new Map(tabs.map((item) => [item.id, item]));
  return {
    async get(tabId) {
      if (!values.has(tabId)) {
        throw new Error("missing tab");
      }
      return structuredClone(values.get(tabId));
    },
  };
}

test("the browser navigation-target event records an exact missing opener", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  const opener = tab({ id: 10, active: false });
  const child = tab({ id: 20, openerTabId: undefined });

  const result = await registerNavigationTarget(
    { tabId: 20, sourceTabId: 10, sourceFrameId: 0 },
    tabsApiFrom([opener, child]),
    tracker,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(await tracker.getValidatedOpener(20), {
    openerTabId: 10,
    source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  });
});

test("invalid, moved, and conflicting navigation targets fail closed", async (t) => {
  await t.test("self reference", async () => {
    const tracker = new NavigationTracker(new MemoryStorageArea());
    const result = await registerNavigationTarget(
      { tabId: 20, sourceTabId: 20 },
      tabsApiFrom([]),
      tracker,
    );
    assert.equal(result.ok, false);
    assert.equal(await tracker.getValidatedOpener(20), null);
  });

  await t.test("different windows", async () => {
    const tracker = new NavigationTracker(new MemoryStorageArea());
    const opener = tab({ id: 10, windowId: 4, active: false });
    const child = tab({ id: 20, windowId: 3 });
    const result = await registerNavigationTarget(
      { tabId: 20, sourceTabId: 10 },
      tabsApiFrom([opener, child]),
      tracker,
    );
    assert.equal(result.ok, false);
    assert.equal(await tracker.getValidatedOpener(20), null);
  });

  await t.test("live opener conflict", async () => {
    const tracker = new NavigationTracker(new MemoryStorageArea());
    const eventSource = tab({ id: 10, active: false });
    const liveOpener = tab({ id: 11, active: false });
    const child = tab({ id: 20, openerTabId: 11 });
    const result = await registerNavigationTarget(
      { tabId: 20, sourceTabId: 10 },
      tabsApiFrom([eventSource, liveOpener, child]),
      tracker,
    );
    assert.equal(result.ok, false);
    assert.equal(await tracker.getValidatedOpener(20), null);
  });
});
