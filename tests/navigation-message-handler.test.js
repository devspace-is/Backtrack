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
  const listener = createNavigationMessageListener(tabsApi, tracker);

  const response = await new Promise((resolve) => {
    const handled = listener(
      {
        type: MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION,
        snapshot: { currentEntryKey: "entry-a" },
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
