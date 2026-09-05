import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationMessageListener } from "../src/background/navigation-message-handler.js";
import { MESSAGE_TYPES } from "../src/shared/messages.js";
import { NAVIGATION_AVAILABILITY } from "../src/background/navigation-tracker.js";

test("navigation snapshots are associated only with the sender tab", async () => {
  let recorded = null;
  const tracker = {
    async recordSnapshot(tabId, snapshot) {
      recorded = { tabId, snapshot };
      return { tabId };
    },
  };
  const listener = createNavigationMessageListener({}, tracker);

  const response = await new Promise((resolve) => {
    const handled = listener(
      {
        type: MESSAGE_TYPES.NAVIGATION_SNAPSHOT,
        snapshot: { currentEntryKey: "entry-a" },
      },
      { tab: { id: 20 } },
      resolve,
    );
    assert.equal(handled, true);
  });

  assert.deepEqual(recorded, {
    tabId: 20,
    snapshot: { currentEntryKey: "entry-a" },
  });
  assert.deepEqual(response, { ok: true });
});

test("unrelated messages remain available to other listeners", () => {
  const listener = createNavigationMessageListener({}, {});
  assert.equal(listener({ type: "OTHER" }, {}, () => {}), false);
});

test("a subframe cannot claim a gesture or request tab navigation", async () => {
  const listener = createNavigationMessageListener({}, {}, {
    claim() { assert.fail("Subframes must not reach the gesture gate"); },
  });
  const result = await new Promise((resolve) => listener(
    {
      type: MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION,
      gesture: { source: "AUTOMATIC", id: "iframe", observedAtMs: 10_000 },
      snapshot: {},
    },
    { tab: { id: 20 }, frameId: 1 },
    resolve,
  ));
  assert.equal(result.action, "NO_SPECIAL_ACTION");
  assert.equal(result.reason, "NOT_TOP_FRAME");
});

test("a confirmed action message closes only an eligible sender child", async () => {
  const tabs = new Map([
    [
      10,
      {
        id: 10,
        windowId: 2,
        active: false,
        pinned: false,
        discarded: false,
        incognito: false,
        groupId: -1,
      },
    ],
    [
      20,
      {
        id: 20,
        openerTabId: 10,
        windowId: 2,
        active: true,
        pinned: false,
        discarded: false,
        incognito: false,
        groupId: -1,
      },
    ],
  ]);
  const tabsApi = {
    async get(tabId) {
      if (!tabs.has(tabId)) {
        throw new Error("missing tab");
      }
      return structuredClone(tabs.get(tabId));
    },
    async update(tabId, patch) {
      for (const [id, item] of tabs) {
        tabs.set(id, {
          ...item,
          active: id === tabId && patch.active === true,
        });
      }
      return structuredClone(tabs.get(tabId));
    },
    async remove(tabId) {
      tabs.delete(tabId);
    },
  };
  const tracker = {
    async recordSnapshot() {},
    async assess() {
      return {
        availability: NAVIGATION_AVAILABILITY.AT_ENTRY_POINT,
        reason: "TRACKED_ENTRY_POINT",
      };
    },
  };
  const listener = createNavigationMessageListener(tabsApi, tracker);

  const response = await new Promise((resolve) => {
    const handled = listener(
      {
        type: MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION,
        snapshot: { currentEntryKey: "entry-a" },
        gesture: { source: "MANUAL_DEVELOPMENT" },
      },
      { tab: structuredClone(tabs.get(20)) },
      resolve,
    );
    assert.equal(handled, true);
  });

  assert.equal(response.action, "RETURNED_TO_OPENER");
  assert.equal(tabs.has(20), false);
  assert.equal(tabs.get(10).active, true);
});

test("an accepted automatic gesture passes the gate before acting", async () => {
  const tabs = new Map([
    [
      10,
      {
        id: 10,
        windowId: 2,
        active: false,
        pinned: false,
        discarded: false,
        incognito: false,
        groupId: -1,
      },
    ],
    [
      20,
      {
        id: 20,
        openerTabId: 10,
        windowId: 2,
        active: true,
        pinned: false,
        discarded: false,
        incognito: false,
        groupId: -1,
      },
    ],
  ]);
  const tabsApi = {
    async get(tabId) {
      if (!tabs.has(tabId)) {
        throw new Error("missing tab");
      }
      return structuredClone(tabs.get(tabId));
    },
    async update(tabId, patch) {
      for (const [id, item] of tabs) {
        tabs.set(id, { ...item, active: id === tabId && patch.active === true });
      }
      return structuredClone(tabs.get(tabId));
    },
    async remove(tabId) {
      tabs.delete(tabId);
    },
  };
  const tracker = {
    async recordSnapshot() {},
    async assess() {
      return {
        availability: NAVIGATION_AVAILABILITY.AT_ENTRY_POINT,
        reason: "TRACKED_ENTRY_POINT",
      };
    },
  };
  let claimed = null;
  const gate = {
    async claim(tabId, windowId, gesture) {
      claimed = { tabId, windowId, gesture };
      return { ok: true, reason: "ACCEPTED" };
    },
  };
  const listener = createNavigationMessageListener(tabsApi, tracker, gate);
  const gesture = {
    source: "AUTOMATIC",
    id: "gesture-1",
    observedAtMs: 10_000,
  };

  const response = await new Promise((resolve) => {
    listener(
      {
        type: MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION,
        snapshot: { currentEntryKey: "entry-a" },
        gesture,
      },
      { tab: structuredClone(tabs.get(20)) },
      resolve,
    );
  });

  assert.deepEqual(claimed, { tabId: 20, windowId: 2, gesture });
  assert.equal(response.action, "RETURNED_TO_OPENER");
  assert.equal(tabs.has(20), false);
});

test("duplicate and unsupported automatic action requests fail closed", async (t) => {
  await t.test("deduplicated gesture", async () => {
    let tabApiUsed = false;
    const tabsApi = {
      async get() {
        tabApiUsed = true;
        throw new Error("must not be called");
      },
    };
    const gate = {
      async claim() {
        return { ok: false, reason: "COOLDOWN_ACTIVE" };
      },
    };
    const listener = createNavigationMessageListener(tabsApi, {}, gate);
    const response = await new Promise((resolve) => {
      listener(
        {
          type: MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION,
          snapshot: {},
          gesture: {
            source: "AUTOMATIC",
            id: "gesture-tail",
            observedAtMs: 10_100,
          },
        },
        { tab: { id: 20 } },
        resolve,
      );
    });

    assert.equal(response.reason, "GESTURE_DEDUPLICATED");
    assert.equal(response.gestureGate.reason, "COOLDOWN_ACTIVE");
    assert.equal(tabApiUsed, false);
  });

  await t.test("unknown source", async () => {
    const listener = createNavigationMessageListener({}, {});
    const response = await new Promise((resolve) => {
      listener(
        {
          type: MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION,
          snapshot: {},
          gesture: { source: "PAGE_SCRIPT" },
        },
        { tab: { id: 20 } },
        resolve,
      );
    });

    assert.equal(response.reason, "UNSUPPORTED_ACTION_SOURCE");
  });
});
