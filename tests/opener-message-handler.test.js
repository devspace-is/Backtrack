import assert from "node:assert/strict";
import test from "node:test";

import { createOpenerMessageListener } from "../src/background/opener-message-handler.js";
import { MESSAGE_TYPES } from "../src/shared/messages.js";

test("the listener ignores unrelated messages", () => {
  const listener = createOpenerMessageListener({ get: async () => ({}) });
  const handled = listener({ type: "OTHER" }, {}, () => {});

  assert.equal(handled, false);
});

test("the listener answers with the validated sender-tab relationship", async () => {
  const opener = {
    id: 10,
    windowId: 2,
    pinned: false,
    discarded: false,
    incognito: false,
    groupId: -1,
  };
  const child = {
    id: 20,
    openerTabId: 10,
    windowId: 2,
    pinned: false,
    incognito: false,
    groupId: -1,
  };
  const listener = createOpenerMessageListener({
    async get() {
      return opener;
    },
  });

  const response = await new Promise((resolve) => {
    const handled = listener(
      { type: MESSAGE_TYPES.GET_OPENER_CONTEXT },
      { tab: child },
      resolve,
    );
    assert.equal(handled, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.currentTab.id, 20);
  assert.equal(response.openerTab.id, 10);
});
