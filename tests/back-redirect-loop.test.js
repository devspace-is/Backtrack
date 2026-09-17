import assert from "node:assert/strict";
import test from "node:test";

import { BackNavigationLoopGuard } from "../src/background/back-navigation-loop-guard.js";
import {
  NAVIGATION_AVAILABILITY,
  NAVIGATION_REASONS,
  NavigationTracker,
} from "../src/background/navigation-tracker.js";
import { performConfirmedBackAction } from "../src/background/tab-action.js";

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

const snapshot = (currentEntryKey, navigationType = "push", extra = {}) => ({
  apiAvailable: true,
  currentEntryKey,
  navigationType,
  sameOriginCanGoBack: false,
  transitionActive: false,
  hasUserActivation: true,
  ...extra,
});

const commit = (documentId, extra = {}) => ({
  tabId: 20,
  frameId: 0,
  documentId,
  documentLifecycle: "active",
  transitionType: "link",
  transitionQualifiers: [],
  ...extra,
});

async function trackedChild() {
  const storage = new MemoryStorageArea();
  const tracker = new NavigationTracker(storage);
  const child = {
    id: 20,
    openerTabId: 10,
    windowId: 1,
    active: true,
    pinned: false,
    discarded: false,
    incognito: false,
    groupId: -1,
  };
  const tabs = new Map([
    [10, {
      id: 10,
      windowId: 1,
      active: false,
      pinned: false,
      discarded: false,
      incognito: false,
      groupId: -1,
    }],
    [20, child],
  ]);
  const closed = [];
  const tabsApi = {
    async get(id) {
      if (!tabs.has(id)) throw new Error("Missing tab");
      return structuredClone(tabs.get(id));
    },
    async update(id, patch) {
      if (patch.active) {
        for (const tab of tabs.values()) tab.active = tab.id === id;
      }
      Object.assign(tabs.get(id), patch);
      return this.get(id);
    },
    async remove(id) {
      closed.push(id);
      tabs.delete(id);
    },
  };

  await tracker.beginCandidate(child);
  await tracker.confirmCandidate(20, 10);
  await tracker.recordSnapshot(20, snapshot("entry-a"), "document-a");
  await tracker.recordDocumentCommit(commit("document-b", {
    transitionType: "form_submit",
    transitionQualifiers: ["server_redirect"],
  }));
  const internal = snapshot("entry-b");
  await tracker.recordSnapshot(20, internal, "document-b");
  assert.equal(
    (await tracker.assess(20, internal)).availability,
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
  );

  return { storage, tracker, child, tabs, tabsApi, closed, internal };
}

test("a redirected Back returning to the exact same URL is correlated once", () => {
  let now = 1_000;
  const guard = new BackNavigationLoopGuard(() => now);
  assert.equal(guard.recordAttempt({
    tabId: 20,
    documentId: "document-b",
    entryKey: "entry-b",
    url: "https://github.com/example/repository?tab=readme",
  }), true);

  now += 250;
  const result = guard.consumeCommit({
    ...commit("document-c"),
    url: "https://github.com/example/repository?tab=readme",
    transitionQualifiers: ["server_redirect", "forward_back"],
  });
  assert.deepEqual(result, {
    detected: true,
    reason: "RETURNED_TO_SAME_URL_AFTER_REDIRECTED_BACK",
    attemptedEntryKey: "entry-b",
    attemptedDocumentId: "document-b",
  });
  assert.equal(
    guard.consumeCommit({
      ...commit("document-d"),
      url: "https://github.com/example/repository?tab=readme",
      transitionQualifiers: ["server_redirect", "forward_back"],
    }).reason,
    "NO_PENDING_ATTEMPT",
  );
});

test("a client redirect can provide the same one-shot loop evidence", () => {
  const guard = new BackNavigationLoopGuard(() => 1_000);
  guard.recordAttempt({
    tabId: 20,
    documentId: "document-b",
    entryKey: "entry-b",
    url: "https://example.test/landing",
  });
  assert.equal(guard.consumeCommit({
    ...commit("document-c"),
    url: "https://example.test/landing",
    transitionQualifiers: ["client_redirect", "forward_back"],
  }).detected, true);
});

test("loop correlation fails closed for incomplete or different evidence", async (t) => {
  const attempt = {
    tabId: 20,
    documentId: "document-b",
    entryKey: "entry-b",
    url: "https://github.com/example/repository",
  };

  for (const [name, details, expectedReason] of [
    ["different destination", {
      url: "https://github.com/example/other",
      transitionQualifiers: ["server_redirect", "forward_back"],
    }, "DIFFERENT_DESTINATION"],
    ["ordinary traversal", {
      url: attempt.url,
      transitionQualifiers: ["forward_back"],
    }, "NOT_REDIRECTED_HISTORY"],
    ["ordinary redirect", {
      url: attempt.url,
      transitionQualifiers: ["server_redirect"],
    }, "NOT_REDIRECTED_HISTORY"],
  ]) {
    await t.test(name, () => {
      const guard = new BackNavigationLoopGuard(() => 1_000);
      guard.recordAttempt(attempt);
      assert.equal(
        guard.consumeCommit({ ...commit("document-c"), ...details }).reason,
        expectedReason,
      );
    });
  }

  await t.test("expired attempt", () => {
    let now = 1_000;
    const guard = new BackNavigationLoopGuard(() => now, 500);
    guard.recordAttempt(attempt);
    now = 2_000;
    assert.equal(
      guard.consumeCommit({
        ...commit("document-c"),
        url: attempt.url,
        transitionQualifiers: ["server_redirect", "forward_back"],
      }).reason,
      "ATTEMPT_EXPIRED",
    );
  });
});

test("a confirmed redirected-Back loop makes the next gesture return to the opener", async () => {
  const { storage, tracker, child, tabs, tabsApi, closed, internal } =
    await trackedChild();
  const guard = new BackNavigationLoopGuard(() => 1_000);
  guard.recordAttempt({
    tabId: 20,
    documentId: "document-b",
    entryKey: internal.currentEntryKey,
    url: "https://github.com/example/repository",
  });
  const loopEvidence = guard.consumeCommit({
    ...commit("document-c"),
    url: "https://github.com/example/repository",
    transitionQualifiers: ["server_redirect", "forward_back"],
  });
  await tracker.recordDocumentCommit(commit("document-c", {
    transitionQualifiers: ["server_redirect", "forward_back"],
    backRedirectLoop: loopEvidence.detected,
    backAttemptEntryKey: loopEvidence.attemptedEntryKey,
  }));
  assert.equal(
    (await tracker.assess(20, internal)).reason,
    NAVIGATION_REASONS.NAVIGATION_IN_PROGRESS,
  );

  const returnedToSamePage = snapshot("entry-c", "push");
  await tracker.recordSnapshot(20, returnedToSamePage, "document-c");
  const assessed = await tracker.assess(20, returnedToSamePage);
  assert.equal(assessed.availability, NAVIGATION_AVAILABILITY.AT_ENTRY_POINT);
  assert.equal(
    assessed.reason,
    NAVIGATION_REASONS.TRACKED_BACK_REDIRECT_LOOP_ENTRY_POINT,
  );

  // The safe eligibility marker survives routine service-worker suspension.
  const restartedTracker = new NavigationTracker(storage);
  assert.equal(
    (await restartedTracker.assess(20, returnedToSamePage)).reason,
    NAVIGATION_REASONS.TRACKED_BACK_REDIRECT_LOOP_ENTRY_POINT,
  );

  const result = await performConfirmedBackAction(
    child,
    returnedToSamePage,
    tabsApi,
    restartedTracker,
  );
  assert.equal(result.action, "RETURNED_TO_OPENER");
  assert.deepEqual(closed, [20]);
  assert.equal(tabs.get(10).active, true);
});

test("loop evidence cannot skip a remaining same-origin entry", async () => {
  const { tracker } = await trackedChild();
  await tracker.recordDocumentCommit(commit("document-c", {
    transitionQualifiers: ["server_redirect", "forward_back"],
    backRedirectLoop: true,
    backAttemptEntryKey: "entry-b",
  }));
  const stillHasBack = snapshot("entry-c", "push", {
    sameOriginCanGoBack: true,
  });
  await tracker.recordSnapshot(20, stillHasBack, "document-c");
  assert.equal(
    (await tracker.assess(20, stillHasBack)).availability,
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
  );
});

test("a confirmed loop survives traverse, replace and repeated snapshots", async () => {
  const { storage, tracker, child, tabs, tabsApi, closed } = await trackedChild();
  await tracker.recordDocumentCommit(commit("document-c", {
    transitionQualifiers: ["server_redirect", "forward_back"],
    backRedirectLoop: true,
    backAttemptEntryKey: "entry-b",
  }));

  // Brave's observed sequence starts with traverse, not a newly pushed entry.
  for (const navigationType of ["traverse", "replace", "traverse", "replace"]) {
    const current = snapshot("entry-c", navigationType);
    const state = await tracker.recordSnapshot(20, current, "document-c");
    assert.equal(state.pendingBackRedirectLoopDocumentId, null);
    assert.equal(state.backRedirectLoopEntryKey, "entry-c");
    assert.equal(
      (await tracker.assess(20, current)).reason,
      NAVIGATION_REASONS.TRACKED_BACK_REDIRECT_LOOP_ENTRY_POINT,
    );
  }

  const result = await performConfirmedBackAction(
    child, snapshot("entry-c", "traverse"), tabsApi, new NavigationTracker(storage),
  );
  assert.equal(result.action, "RETURNED_TO_OPENER");
  assert.deepEqual(closed, [20]);
  assert.equal(tabs.get(10).active, true);
});

test("traverse snapshots cannot authorize closure without complete loop evidence", async (t) => {
  for (const [name, commitOverrides, snapshotOverrides] of [
    ["ordinary traversal", { backRedirectLoop: false }, {}],
    ["no redirect qualifier", { transitionQualifiers: ["forward_back"] }, {}],
    ["no history qualifier", { transitionQualifiers: ["server_redirect"] }, {}],
    ["different attempted entry", { backAttemptEntryKey: "unrelated-entry" }, {}],
    ["remaining same-origin history", {}, { sameOriginCanGoBack: true }],
    ["unknown same-origin history", {}, { sameOriginCanGoBack: null }],
    ["unknown navigation type", {}, { navigationType: null }],
    ["reload instead of traversal", {}, { navigationType: "reload" }],
  ]) {
    await t.test(name, async () => {
      const { tracker, child, tabsApi, closed } = await trackedChild();
      await tracker.recordDocumentCommit(commit("document-c", {
        transitionQualifiers: ["server_redirect", "forward_back"],
        backRedirectLoop: true,
        backAttemptEntryKey: "entry-b",
        ...commitOverrides,
      }));
      const current = snapshot("entry-c", "traverse", snapshotOverrides);
      const state = await tracker.recordSnapshot(20, current, "document-c");
      assert.equal(state.backRedirectLoopEntryKey, null);
      const result = await performConfirmedBackAction(child, current, tabsApi, tracker);
      assert.notEqual(result.action, "RETURNED_TO_OPENER");
      assert.deepEqual(closed, []);
    });
  }
});

test("a recovered traverse loop still requires a live matching entry and safe opener", async (t) => {
  for (const scenario of ["stale document", "changed live entry", "closed opener", "moved opener", "pinned child", "later navigation"]) {
    await t.test(scenario, async () => {
      const { tracker, child, tabs, tabsApi, closed } = await trackedChild();
      await tracker.recordDocumentCommit(commit("document-c", {
        transitionQualifiers: ["server_redirect", "forward_back"],
        backRedirectLoop: true,
        backAttemptEntryKey: "entry-b",
      }));
      let current = snapshot("entry-c", "traverse");
      const state = await tracker.recordSnapshot(
        20, current, scenario === "stale document" ? "document-b" : "document-c",
      );
      if (scenario === "stale document") {
        assert.equal(state.pendingBackRedirectLoopDocumentId, "document-c");
        assert.equal(state.backRedirectLoopEntryKey, null);
      } else {
        assert.equal(state.backRedirectLoopEntryKey, "entry-c");
      }
      if (scenario === "changed live entry") current = snapshot("entry-d", "push");
      if (scenario === "closed opener") tabs.delete(10);
      if (scenario === "moved opener") tabs.get(10).windowId = 2;
      if (scenario === "pinned child") tabs.get(20).pinned = true;
      if (scenario === "later navigation") {
        current = snapshot("entry-d", "push", { sameOriginCanGoBack: true });
        const next = await tracker.recordSnapshot(20, current, "document-c");
        assert.equal(next.backRedirectLoopEntryKey, null);
      }
      const result = await performConfirmedBackAction(child, current, tabsApi, tracker);
      assert.notEqual(result.action, "RETURNED_TO_OPENER");
      assert.deepEqual(closed, []);
    });
  }
});

test("mismatched attempt identity and later navigation never authorize closure", async (t) => {
  await t.test("mismatched entry", async () => {
    const { tracker } = await trackedChild();
    await tracker.recordDocumentCommit(commit("document-c", {
      transitionQualifiers: ["server_redirect", "forward_back"],
      backRedirectLoop: true,
      backAttemptEntryKey: "other-entry",
    }));
    const current = snapshot("entry-c", "push");
    await tracker.recordSnapshot(20, current, "document-c");
    assert.equal(
      (await tracker.assess(20, current)).availability,
      NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
    );
  });

  await t.test("later navigation", async () => {
    const { tracker } = await trackedChild();
    await tracker.recordDocumentCommit(commit("document-c", {
      transitionQualifiers: ["server_redirect", "forward_back"],
      backRedirectLoop: true,
      backAttemptEntryKey: "entry-b",
    }));
    const loopEntry = snapshot("entry-c", "push");
    await tracker.recordSnapshot(20, loopEntry, "document-c");
    const laterEntry = snapshot("entry-d", "push", {
      sameOriginCanGoBack: true,
    });
    await tracker.recordSnapshot(20, laterEntry, "document-c");
    assert.equal(
      (await tracker.assess(20, laterEntry)).availability,
      NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
    );
  });
});
