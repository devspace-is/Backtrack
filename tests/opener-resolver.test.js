import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENER_REASONS,
  resolveSafeOpener,
} from "../src/background/opener-resolver.js";
import { OPENER_RELATIONSHIP_SOURCES } from "../src/background/navigation-tracker.js";

function makeTab(overrides = {}) {
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
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return {
    async get(tabId) {
      if (!byId.has(tabId)) {
        throw new Error("No tab with id");
      }
      return byId.get(tabId);
    },
  };
}

test("a manually opened tab without opener is a safe no-op", async () => {
  const result = await resolveSafeOpener(makeTab(), tabsApiFrom([]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.NO_OPENER);
  assert.equal(result.openerTab, null);
});

test("a valid opener in the same window is resolved", async () => {
  const opener = makeTab({ id: 10, active: false });
  const child = makeTab({ id: 20, openerTabId: 10 });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, true);
  assert.equal(result.reason, OPENER_REASONS.VALID_OPENER);
  assert.equal(result.currentTab.id, 20);
  assert.equal(result.openerTab.id, 10);
  assert.equal("url" in result.openerTab, false);
  assert.equal("title" in result.openerTab, false);
});

test("a browser navigation target safely supplements a missing openerTabId", async () => {
  const opener = makeTab({ id: 10, active: false });
  const child = makeTab({ id: 20, openerTabId: undefined });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]), {
    openerTabId: 10,
    source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  });

  assert.equal(result.ok, true);
  assert.equal(result.openerTab.id, 10);
  assert.equal(
    result.relationshipSource,
    OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  );
});

test("an untrusted fallback cannot invent an opener", async () => {
  const opener = makeTab({ id: 10, active: false });
  const child = makeTab({ id: 20, openerTabId: undefined });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]), {
    openerTabId: 10,
    source: "INFERRED_ACTIVE_TAB",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.NO_OPENER);
});

test("conflicting live and tracked opener relationships are rejected", async () => {
  const child = makeTab({ id: 20, openerTabId: 11 });
  const result = await resolveSafeOpener(child, tabsApiFrom([]), {
    openerTabId: 10,
    source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.OPENER_RELATIONSHIP_CONFLICT);
});

test("nested A to B to C relationships resolve one safe level at a time", async () => {
  const tabA = makeTab({ id: 10, active: false });
  const tabB = makeTab({ id: 20, openerTabId: 10, active: false });
  const tabC = makeTab({ id: 30, openerTabId: 20 });
  const tabsApi = tabsApiFrom([tabA, tabB, tabC]);

  const cResult = await resolveSafeOpener(tabC, tabsApi);
  const bResult = await resolveSafeOpener(tabB, tabsApi);

  assert.equal(cResult.ok, true);
  assert.equal(cResult.openerTab.id, 20);
  assert.equal(bResult.ok, true);
  assert.equal(bResult.openerTab.id, 10);
});

test("a closed or missing opener is rejected", async () => {
  const child = makeTab({ openerTabId: 10 });
  const result = await resolveSafeOpener(child, tabsApiFrom([]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.OPENER_UNAVAILABLE);
});

test("a child moved to another window is rejected", async () => {
  const opener = makeTab({ id: 10, windowId: 2 });
  const child = makeTab({ openerTabId: 10, windowId: 3 });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.DIFFERENT_WINDOW);
});

test("tabs moved together to the same new window remain unambiguous", async () => {
  const opener = makeTab({ id: 10, windowId: 9 });
  const child = makeTab({ openerTabId: 10, windowId: 9 });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, true);
  assert.equal(result.openerTab.windowId, 9);
});

test("the current pinned tab is never eligible", async () => {
  const opener = makeTab({ id: 10 });
  const child = makeTab({ openerTabId: 10, pinned: true });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.CURRENT_TAB_PINNED);
});

test("a pinned opener is still a safe focus target", async () => {
  const opener = makeTab({ id: 10, pinned: true });
  const child = makeTab({ openerTabId: 10 });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, true);
  assert.equal(result.openerTab.pinned, true);
});

test("grouped tabs keep their exact opener relationship", async () => {
  const opener = makeTab({ id: 10, groupId: 4 });
  const child = makeTab({ openerTabId: 10, groupId: 7 });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, true);
  assert.equal(result.currentTab.groupId, 7);
  assert.equal(result.openerTab.groupId, 4);
});

test("a discarded opener is rejected conservatively", async () => {
  const opener = makeTab({ id: 10, discarded: true });
  const child = makeTab({ openerTabId: 10 });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.OPENER_DISCARDED);
});

test("self references and mismatched API results are rejected", async (t) => {
  await t.test("self reference", async () => {
    const child = makeTab({ id: 20, openerTabId: 20 });
    const result = await resolveSafeOpener(child, tabsApiFrom([child]));
    assert.equal(result.reason, OPENER_REASONS.SELF_REFERENCE);
  });

  await t.test("mismatched result", async () => {
    const child = makeTab({ openerTabId: 10 });
    const tabsApi = { async get() { return makeTab({ id: 11 }); } };
    const result = await resolveSafeOpener(child, tabsApi);
    assert.equal(result.reason, OPENER_REASONS.OPENER_ID_MISMATCH);
  });
});

test("normal and private tabs cannot be mixed", async () => {
  const opener = makeTab({ id: 10, incognito: true });
  const child = makeTab({ openerTabId: 10, incognito: false });

  const result = await resolveSafeOpener(child, tabsApiFrom([opener]));

  assert.equal(result.ok, false);
  assert.equal(result.reason, OPENER_REASONS.INCOGNITO_MISMATCH);
});
