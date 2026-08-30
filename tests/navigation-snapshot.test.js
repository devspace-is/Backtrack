import assert from "node:assert/strict";
import test from "node:test";

await import("../src/shared/navigation-snapshot.js");

const snapshotApi = globalThis.BacktrackNavigationSnapshot;

function navigationObject(overrides = {}) {
  return {
    currentEntry: { key: "opaque-entry-key" },
    activation: { navigationType: "push" },
    canGoBack: false,
    canGoForward: false,
    transition: null,
    entries: () => [{ key: "opaque-entry-key" }],
    ...overrides,
  };
}

test("the snapshot captures navigation semantics without URLs", () => {
  const snapshot = snapshotApi.readSnapshot({
    navigationObject: navigationObject(),
    historyLength: 7,
    readyState: "complete",
    trigger: "test",
  });

  assert.equal(snapshot.apiAvailable, true);
  assert.equal(snapshot.currentEntryKey, "opaque-entry-key");
  assert.equal(snapshot.navigationType, "push");
  assert.equal(snapshot.sameOriginCanGoBack, false);
  assert.equal("url" in snapshot, false);
  assert.equal("title" in snapshot, false);
});

test("history.length is explicitly diagnostic and never the decision", () => {
  const snapshot = snapshotApi.readSnapshot({
    navigationObject: navigationObject(),
    historyLength: 99,
    readyState: "interactive",
    trigger: "test",
  });
  const diagnostic = snapshotApi.diagnosticView(snapshot);

  assert.equal(diagnostic.historyLength, 99);
  assert.equal(
    diagnostic.historyLengthPolicy,
    "DIAGNOSTIC_ONLY_NOT_A_DECISION_SIGNAL",
  );
  assert.equal("currentEntryKey" in diagnostic, false);
  assert.equal(diagnostic.hasCurrentEntryKey, true);
});

test("missing or inaccessible Navigation API data becomes unavailable", () => {
  const snapshot = snapshotApi.readSnapshot({
    navigationObject: null,
    historyLength: 1,
    readyState: "loading",
    trigger: "test",
  });

  assert.equal(snapshot.apiAvailable, false);
  assert.equal(snapshot.currentEntryKey, null);
});
