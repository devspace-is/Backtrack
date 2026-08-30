import assert from "node:assert/strict";
import test from "node:test";

import {
  BACK_DECISIONS,
  evaluateBackDecision,
} from "../src/background/back-decision.js";
import { NAVIGATION_AVAILABILITY } from "../src/background/navigation-tracker.js";

function currentTab(overrides = {}) {
  return {
    id: 20,
    openerTabId: 10,
    windowId: 3,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...overrides,
  };
}

function tabsApi(opener = null) {
  return {
    async get() {
      if (!opener) {
        throw new Error("missing opener");
      }
      return opener;
    },
  };
}

function trackerWith(availability, reason = "TEST_REASON") {
  return {
    async recordSnapshot() {},
    async assess() {
      return { availability, reason };
    },
  };
}

const opener = {
  id: 10,
  windowId: 3,
  pinned: false,
  discarded: false,
  incognito: false,
  groupId: -1,
};

test("internal history always wins over opener behavior", async () => {
  const result = await evaluateBackDecision(
    currentTab(),
    { currentEntryKey: "entry-b" },
    tabsApi(opener),
    trackerWith(NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE),
  );

  assert.equal(result.decision, BACK_DECISIONS.USE_INTERNAL_HISTORY);
});

test("the entry point becomes eligible but performs no tab action", async () => {
  const result = await evaluateBackDecision(
    currentTab(),
    { currentEntryKey: "entry-a" },
    tabsApi(opener),
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.decision, BACK_DECISIONS.RETURN_TO_OPENER_ELIGIBLE);
  assert.match(result.notice, /no history or tab action/i);
});

test("uncertain navigation state is a safe no-op", async () => {
  const result = await evaluateBackDecision(
    currentTab(),
    {},
    tabsApi(opener),
    trackerWith(NAVIGATION_AVAILABILITY.UNKNOWN),
  );

  assert.equal(result.decision, BACK_DECISIONS.NO_SPECIAL_ACTION);
});

test("an invalid opener prevents any special navigation decision", async () => {
  let trackerCalled = false;
  const tracker = {
    async recordSnapshot() {
      trackerCalled = true;
    },
    async assess() {
      trackerCalled = true;
      return {};
    },
  };

  const result = await evaluateBackDecision(
    currentTab(),
    {},
    tabsApi(null),
    tracker,
  );

  assert.equal(result.decision, BACK_DECISIONS.NO_SPECIAL_ACTION);
  assert.equal(trackerCalled, false);
});

test("a decision request cannot invent a missing entry baseline", async () => {
  let snapshotRecorded = false;
  const tracker = {
    async assess() {
      return {
        availability: NAVIGATION_AVAILABILITY.UNKNOWN,
        reason: "AWAITING_ENTRY",
      };
    },
    async recordSnapshot() {
      snapshotRecorded = true;
    },
  };

  const result = await evaluateBackDecision(
    currentTab(),
    { currentEntryKey: "late-entry" },
    tabsApi(opener),
    tracker,
  );

  assert.equal(result.decision, BACK_DECISIONS.NO_SPECIAL_ACTION);
  assert.equal(result.reason, "AWAITING_ENTRY");
  assert.equal(snapshotRecorded, false);
});
