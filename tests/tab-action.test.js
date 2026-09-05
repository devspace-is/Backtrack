import assert from "node:assert/strict";
import test from "node:test";

import {
  TAB_ACTION_REASONS,
  TAB_ACTIONS,
  performConfirmedBackAction,
} from "../src/background/tab-action.js";
import { NAVIGATION_AVAILABILITY } from "../src/background/navigation-tracker.js";
import { OPENER_RELATIONSHIP_SOURCES } from "../src/background/navigation-tracker.js";

function tab(overrides = {}) {
  return {
    id: 20,
    openerTabId: 10,
    windowId: 3,
    active: true,
    pinned: false,
    discarded: false,
    incognito: false,
    groupId: -1,
    ...overrides,
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

class FakeTabsApi {
  constructor(tabs) {
    this.tabs = new Map(tabs.map((item) => [item.id, structuredClone(item)]));
    this.events = [];
    this.failActivation = false;
    this.failRemoval = false;
    this.removeOpenerAfterActivation = false;
    this.removeChildAfterActivation = false;
  }

  async get(tabId) {
    this.events.push(["get", tabId]);
    if (!this.tabs.has(tabId)) {
      throw new Error("Tab unavailable");
    }
    return structuredClone(this.tabs.get(tabId));
  }

  async update(tabId, patch) {
    this.events.push(["update", tabId, structuredClone(patch)]);
    if (this.failActivation && tabId === 10) {
      throw new Error("Activation failed");
    }
    if (!this.tabs.has(tabId)) {
      throw new Error("Tab unavailable");
    }

    const current = this.tabs.get(tabId);
    if (patch.active === true) {
      for (const [otherId, otherTab] of this.tabs) {
        if (otherTab.windowId === current.windowId) {
          this.tabs.set(otherId, { ...otherTab, active: false });
        }
      }
    }
    const updated = { ...this.tabs.get(tabId), ...patch };
    this.tabs.set(tabId, updated);

    const response = structuredClone(updated);
    if (this.removeOpenerAfterActivation && tabId === 10) {
      this.tabs.delete(tabId);
    }
    if (this.removeChildAfterActivation && tabId === 10) {
      this.tabs.delete(20);
    }
    return response;
  }

  async remove(tabId) {
    this.events.push(["remove", tabId]);
    if (this.failRemoval) {
      throw new Error("Removal failed");
    }
    if (!this.tabs.delete(tabId)) {
      throw new Error("Tab unavailable");
    }
  }
}

const opener = tab({
  id: 10,
  openerTabId: undefined,
  active: false,
});

test("the opener is activated before the child is closed", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  const result = await performConfirmedBackAction(
    tab(),
    { currentEntryKey: "entry-a" },
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.action, TAB_ACTIONS.RETURNED_TO_OPENER);
  assert.equal(result.reason, TAB_ACTION_REASONS.RETURNED_TO_OPENER);
  assert.equal(tabsApi.tabs.has(20), false);
  assert.equal(tabsApi.tabs.get(10).active, true);

  const activationIndex = tabsApi.events.findIndex(
    ([event, tabId]) => event === "update" && tabId === 10,
  );
  const closeIndex = tabsApi.events.findIndex(
    ([event, tabId]) => event === "remove" && tabId === 20,
  );
  assert.ok(activationIndex >= 0);
  assert.ok(closeIndex > activationIndex);
});

test("a validated navigation target can return a child without openerTabId", async () => {
  const child = tab({ openerTabId: undefined });
  const tabsApi = new FakeTabsApi([opener, child]);
  const tracker = trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT);
  tracker.getValidatedOpener = async () => ({
    openerTabId: 10,
    source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  });

  const result = await performConfirmedBackAction(
    child,
    { currentEntryKey: "entry-a" },
    tabsApi,
    tracker,
  );

  assert.equal(result.action, TAB_ACTIONS.RETURNED_TO_OPENER);
  assert.equal(tabsApi.tabs.has(20), false);
  assert.equal(tabsApi.tabs.get(10).active, true);
});

test("internal history prevents all tab actions", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  const result = await performConfirmedBackAction(
    tab(),
    { currentEntryKey: "entry-b" },
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE),
  );

  assert.equal(result.action, TAB_ACTIONS.USE_INTERNAL_HISTORY);
  assert.equal(
    tabsApi.events.some(([event]) => event === "update" || event === "remove"),
    false,
  );
});

test("manual and restricted tabs never close", async (t) => {
  await t.test("manual tab without opener", async () => {
    const manualTab = tab({ openerTabId: undefined });
    const tabsApi = new FakeTabsApi([manualTab]);
    const result = await performConfirmedBackAction(
      manualTab,
      {},
      tabsApi,
      trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
    );

    assert.equal(result.action, TAB_ACTIONS.USE_BROWSER_HISTORY);
    assert.equal(tabsApi.tabs.has(20), true);
    assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
  });

  await t.test("message without a sender tab", async () => {
    const tabsApi = new FakeTabsApi([]);
    const result = await performConfirmedBackAction(
      undefined,
      {},
      tabsApi,
      trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
    );

    assert.equal(result.action, TAB_ACTIONS.NO_SPECIAL_ACTION);
    assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
  });
});

test("an inactive child is not acted on after the decision", async () => {
  const inactiveChild = tab({ active: false });
  const tabsApi = new FakeTabsApi([opener, inactiveChild]);
  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.reason, TAB_ACTION_REASONS.CURRENT_TAB_NOT_ACTIVE);
  assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
});

test("a missing opener allows ordinary back but never closes the child", async () => {
  const tabsApi = new FakeTabsApi([tab()]);
  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.action, TAB_ACTIONS.USE_BROWSER_HISTORY);
  assert.equal(tabsApi.tabs.has(20), true);
  assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
});

test("ordinary back revalidates the active sender before authorizing history", async (t) => {
  for (const [name, patch, expectedReason] of [
    ["inactive", { active: false }, TAB_ACTION_REASONS.CURRENT_TAB_NOT_ACTIVE],
    ["moved during request", { windowId: 4 }, TAB_ACTION_REASONS.CURRENT_TAB_CHANGED],
    ["discarded", { discarded: true }, TAB_ACTION_REASONS.CURRENT_TAB_CHANGED],
    ["private context changed", { incognito: true }, TAB_ACTION_REASONS.CURRENT_TAB_CHANGED],
  ]) {
    await t.test(name, async () => {
      const sender = tab({ openerTabId: undefined });
      const tabsApi = new FakeTabsApi([{ ...sender, ...patch }]);
      const result = await performConfirmedBackAction(
        sender, {}, tabsApi, trackerWith(NAVIGATION_AVAILABILITY.UNKNOWN),
      );
      assert.equal(result.action, TAB_ACTIONS.NO_SPECIAL_ACTION);
      assert.equal(result.reason, expectedReason);
      assert.equal(tabsApi.events.some(([event]) => event !== "get"), false);
    });
  }
});

test("pinning or moving a child blocks closure but permits its ordinary back", async (t) => {
  for (const patch of [{ pinned: true }, { windowId: 4 }]) {
    await t.test(JSON.stringify(patch), async () => {
      const child = tab(patch);
      const tabsApi = new FakeTabsApi([opener, child]);
      const result = await performConfirmedBackAction(
        child, {}, tabsApi, trackerWith(NAVIGATION_AVAILABILITY.UNKNOWN),
      );
      assert.equal(result.action, TAB_ACTIONS.USE_BROWSER_HISTORY);
      assert.equal(tabsApi.events.some(([event]) => event !== "get"), false);
    });
  }
});

test("ordinary back does not start another navigation during a transition", async () => {
  const current = tab({ openerTabId: undefined });
  const tabsApi = new FakeTabsApi([current]);
  const result = await performConfirmedBackAction(
    current, { transitionActive: true }, tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.UNKNOWN),
  );
  assert.equal(result.action, TAB_ACTIONS.NO_SPECIAL_ACTION);
  assert.equal(result.reason, TAB_ACTION_REASONS.NAVIGATION_IN_PROGRESS);
  assert.deepEqual(tabsApi.events, []);
});

test("activation failure leaves the child open and active", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  tabsApi.failActivation = true;

  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.reason, TAB_ACTION_REASONS.OPENER_ACTIVATION_FAILED);
  assert.equal(tabsApi.tabs.has(20), true);
  assert.equal(tabsApi.tabs.get(20).active, true);
  assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
});

test("a changed opener relationship is rejected before activation", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  const originalGet = tabsApi.get.bind(tabsApi);
  let childReadCount = 0;
  tabsApi.get = async (tabId) => {
    if (tabId === 20 && ++childReadCount === 1) {
      tabsApi.tabs.set(20, tab({ openerTabId: 11 }));
    }
    return originalGet(tabId);
  };

  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.reason, TAB_ACTION_REASONS.OPENER_RELATIONSHIP_CHANGED);
  assert.equal(tabsApi.events.some(([event]) => event === "update"), false);
  assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
});

test("post-activation validation failure restores child focus", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  tabsApi.removeOpenerAfterActivation = true;

  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(
    result.reason,
    TAB_ACTION_REASONS.POST_ACTIVATION_VALIDATION_FAILED,
  );
  assert.equal(result.focusRestored, true);
  assert.equal(tabsApi.tabs.get(20).active, true);
  assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
});

test("an unavailable child after activation is reported conservatively", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  tabsApi.removeChildAfterActivation = true;

  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.action, TAB_ACTIONS.NO_SPECIAL_ACTION);
  assert.equal(
    result.reason,
    TAB_ACTION_REASONS.CHILD_UNAVAILABLE_AFTER_ACTIVATION,
  );
  assert.equal(tabsApi.events.some(([event]) => event === "remove"), false);
});

test("close failure restores child focus", async () => {
  const tabsApi = new FakeTabsApi([opener, tab()]);
  tabsApi.failRemoval = true;

  const result = await performConfirmedBackAction(
    tab(),
    {},
    tabsApi,
    trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT),
  );

  assert.equal(result.reason, TAB_ACTION_REASONS.CHILD_CLOSE_FAILED);
  assert.equal(result.focusRestored, true);
  assert.equal(tabsApi.tabs.has(20), true);
  assert.equal(tabsApi.tabs.get(20).active, true);
});

test("nested children return one opener level at a time", async () => {
  const tabA = tab({ id: 10, openerTabId: undefined, active: false });
  const tabB = tab({ id: 20, openerTabId: 10, active: false });
  const tabC = tab({ id: 30, openerTabId: 20, active: true });
  const tabsApi = new FakeTabsApi([tabA, tabB, tabC]);
  const tracker = trackerWith(NAVIGATION_AVAILABILITY.AT_ENTRY_POINT);

  const fromC = await performConfirmedBackAction(tabC, {}, tabsApi, tracker);
  assert.equal(fromC.action, TAB_ACTIONS.RETURNED_TO_OPENER);
  assert.equal(fromC.openerTabId, 20);
  assert.equal(tabsApi.tabs.get(20).active, true);
  assert.equal(tabsApi.tabs.has(30), false);

  const liveB = structuredClone(tabsApi.tabs.get(20));
  const fromB = await performConfirmedBackAction(liveB, {}, tabsApi, tracker);
  assert.equal(fromB.action, TAB_ACTIONS.RETURNED_TO_OPENER);
  assert.equal(fromB.openerTabId, 10);
  assert.equal(tabsApi.tabs.get(10).active, true);
  assert.equal(tabsApi.tabs.has(20), false);
});
