import assert from "node:assert/strict";
import test from "node:test";

import {
  NAVIGATION_AVAILABILITY,
  NAVIGATION_REASONS,
  OPENER_RELATIONSHIP_SOURCES,
  NavigationTracker,
  applyNavigationSnapshot,
  assessTrackedNavigation,
  createCandidateState,
} from "../src/background/navigation-tracker.js";

class MemoryStorageArea {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key) ? { [key]: structuredClone(this.values.get(key)) } : {};
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
  return { id: 20, openerTabId: 10, ...overrides };
}

function snapshot(overrides = {}) {
  return {
    apiAvailable: true,
    currentEntryKey: "entry-a",
    navigationType: "push",
    sameOriginCanGoBack: false,
    transitionActive: false,
    ...overrides,
  };
}

test("a new child starts at its tracked entry point", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(tab());
  await tracker.confirmCandidate(20, 10);
  await tracker.recordSnapshot(20, snapshot());

  const result = await tracker.assess(20);

  assert.equal(result.availability, NAVIGATION_AVAILABILITY.AT_ENTRY_POINT);
  assert.equal(result.reason, NAVIGATION_REASONS.TRACKED_ENTRY_POINT);
});

test("a validated navigation target supplies a session-only opener fallback", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(
    tab({ openerTabId: undefined }),
    {
      openerTabId: 10,
      source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
    },
  );
  await tracker.confirmCandidate(20, 10);

  assert.deepEqual(await tracker.getValidatedOpener(20), {
    openerTabId: 10,
    source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  });
});

test("a conflicting second candidate never replaces the first relationship", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(tab());

  const conflicting = await tracker.beginCandidate(
    tab({ openerTabId: undefined }),
    {
      openerTabId: 11,
      source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
    },
  );

  assert.equal(conflicting, null);
  await tracker.confirmCandidate(20, 10);
  assert.deepEqual(await tracker.getValidatedOpener(20), {
    openerTabId: 10,
    source: OPENER_RELATIONSHIP_SOURCES.TAB_OPENER_ID,
  });
});

test("push navigation creates meaningful internal back history", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(tab());
  await tracker.confirmCandidate(20, 10);
  await tracker.recordSnapshot(20, snapshot());
  await tracker.recordSnapshot(
    20,
    snapshot({
      currentEntryKey: "entry-b",
      navigationType: "push",
      sameOriginCanGoBack: true,
    }),
  );

  const result = await tracker.assess(20);

  assert.equal(
    result.availability,
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
  );
});

test("traversing back to the baseline returns to the entry point", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(tab());
  await tracker.confirmCandidate(20, 10);
  await tracker.recordSnapshot(20, snapshot());
  await tracker.recordSnapshot(
    20,
    snapshot({ currentEntryKey: "entry-b", navigationType: "push" }),
  );
  await tracker.recordSnapshot(
    20,
    snapshot({ currentEntryKey: "entry-a", navigationType: "traverse" }),
  );

  const result = await tracker.assess(20);

  assert.equal(result.availability, NAVIGATION_AVAILABILITY.AT_ENTRY_POINT);
});

test("multiple internal steps stay internal until the baseline is reached", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(tab());
  await tracker.confirmCandidate(20, 10);
  await tracker.recordSnapshot(20, snapshot());
  await tracker.recordSnapshot(
    20,
    snapshot({ currentEntryKey: "entry-b", navigationType: "push" }),
  );
  await tracker.recordSnapshot(
    20,
    snapshot({ currentEntryKey: "entry-c", navigationType: "push" }),
  );
  await tracker.recordSnapshot(
    20,
    snapshot({ currentEntryKey: "entry-b", navigationType: "traverse" }),
  );

  assert.equal(
    (await tracker.assess(20)).availability,
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
  );

  await tracker.recordSnapshot(
    20,
    snapshot({ currentEntryKey: "entry-a", navigationType: "traverse" }),
  );

  assert.equal(
    (await tracker.assess(20)).availability,
    NAVIGATION_AVAILABILITY.AT_ENTRY_POINT,
  );
});

test("SPA replace at the baseline updates the baseline instead of adding depth", () => {
  const candidate = createCandidateState(tab());
  const initial = applyNavigationSnapshot(candidate, snapshot());
  const replaced = applyNavigationSnapshot(
    { ...initial, openerValidated: true },
    snapshot({ currentEntryKey: "entry-replaced", navigationType: "replace" }),
  );

  assert.equal(replaced.baselineEntryKey, "entry-replaced");
  assert.equal(replaced.currentEntryKey, "entry-replaced");
  assert.equal(
    assessTrackedNavigation(replaced).availability,
    NAVIGATION_AVAILABILITY.AT_ENTRY_POINT,
  );
});

test("replace away from the baseline preserves meaningful back history", () => {
  const candidate = createCandidateState(tab());
  const initial = applyNavigationSnapshot(candidate, snapshot());
  const pushed = applyNavigationSnapshot(
    { ...initial, openerValidated: true },
    snapshot({ currentEntryKey: "entry-b", navigationType: "push" }),
  );
  const replaced = applyNavigationSnapshot(
    pushed,
    snapshot({ currentEntryKey: "entry-c", navigationType: "replace" }),
  );

  assert.equal(replaced.baselineEntryKey, "entry-a");
  assert.equal(replaced.currentEntryKey, "entry-c");
  assert.equal(
    assessTrackedNavigation(replaced).availability,
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
  );
});

test("cross-origin history remains internal even when canGoBack is origin-limited", () => {
  const state = {
    ...applyNavigationSnapshot(createCandidateState(tab()), snapshot()),
    openerValidated: true,
    currentEntryKey: "cross-origin-entry",
    sameOriginCanGoBack: false,
  };

  const result = assessTrackedNavigation(state);

  assert.equal(
    result.availability,
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
  );
});

test("contradictory same-origin back availability is a safe unknown", () => {
  const state = {
    ...applyNavigationSnapshot(createCandidateState(tab()), snapshot()),
    openerValidated: true,
    sameOriginCanGoBack: true,
  };

  const result = assessTrackedNavigation(state);

  assert.equal(result.availability, NAVIGATION_AVAILABILITY.UNKNOWN);
  assert.equal(result.reason, NAVIGATION_REASONS.CONTRADICTORY_BROWSER_SIGNAL);
});

test("missing tracking after an extension reload never invents a baseline", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.recordSnapshot(20, snapshot({ currentEntryKey: "unknown-depth" }));

  const result = await tracker.assess(20);

  assert.equal(result.availability, NAVIGATION_AVAILABILITY.UNKNOWN);
  assert.equal(result.reason, NAVIGATION_REASONS.NOT_TRACKED);
});

test("session storage survives a service-worker tracker instance", async () => {
  const storage = new MemoryStorageArea();
  const firstWorker = new NavigationTracker(storage);
  await firstWorker.beginCandidate(tab());
  await firstWorker.confirmCandidate(20, 10);
  await firstWorker.recordSnapshot(20, snapshot());

  const restartedWorker = new NavigationTracker(storage);
  const result = await restartedWorker.assess(20);

  assert.equal(result.availability, NAVIGATION_AVAILABILITY.AT_ENTRY_POINT);
});

test("unknown entry changes and active transitions fail closed", async (t) => {
  await t.test("unknown change", () => {
    const initial = applyNavigationSnapshot(createCandidateState(tab()), snapshot());
    const changed = applyNavigationSnapshot(
      { ...initial, openerValidated: true },
      snapshot({ currentEntryKey: "entry-b", navigationType: null }),
    );
    const result = assessTrackedNavigation(changed);
    assert.equal(result.availability, NAVIGATION_AVAILABILITY.UNKNOWN);
    assert.equal(result.reason, NAVIGATION_REASONS.UNEXPECTED_ENTRY_CHANGE);
  });

  await t.test("transition in progress", () => {
    const state = {
      ...applyNavigationSnapshot(createCandidateState(tab()), snapshot()),
      openerValidated: true,
      transitionActive: true,
    };
    const result = assessTrackedNavigation(state);
    assert.equal(result.availability, NAVIGATION_AVAILABILITY.UNKNOWN);
    assert.equal(result.reason, NAVIGATION_REASONS.NAVIGATION_IN_PROGRESS);
  });
});

test("closed tabs remove their session-only state", async () => {
  const tracker = new NavigationTracker(new MemoryStorageArea());
  await tracker.beginCandidate(tab());
  await tracker.remove(20);

  const result = await tracker.assess(20);

  assert.equal(result.reason, NAVIGATION_REASONS.NOT_TRACKED);
});
