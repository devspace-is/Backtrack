import assert from "node:assert/strict";
import test from "node:test";

import { createNavigationMessageListener } from "../src/background/navigation-message-handler.js";
import { MESSAGE_TYPES } from "../src/shared/messages.js";

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
