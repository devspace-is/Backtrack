import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_LOG_KEY,
  DiagnosticLog,
  sanitizeDiagnosticEntry,
} from "../src/background/diagnostic-log.js";
import { createNavigationMessageListener } from "../src/background/navigation-message-handler.js";
import { MESSAGE_TYPES } from "../src/shared/messages.js";

class MemoryStorageArea {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key)
      ? { [key]: structuredClone(this.values.get(key)) }
      : {};
  }

  async set(values) {
    for (const [key, value] of Object.entries(values)) {
      this.values.set(key, structuredClone(value));
    }
  }

  async remove(key) {
    this.values.delete(key);
  }
}

test("persistent diagnostics discard URLs, titles, raw input, and arbitrary fields", () => {
  const entry = sanitizeDiagnosticEntry({
    kind: "GESTURE_SESSION",
    recordedAtMs: 1234.4,
    tabId: 7,
    windowId: 2,
    classification: "HORIZONTAL_NEGATIVE_X",
    semanticDirection: "BACK_GESTURE",
    blockers: ["TOO_FEW_EVENTS", "TOO_FEW_EVENTS", "https://private.example"],
    netHorizontalDistancePx: 345.678,
    rawEvents: [{ deltaX: -999 }],
    url: "https://private.example/secret",
    title: "Sensitive title",
    pageText: "Sensitive page content",
  }, 1);

  assert.deepEqual(entry, {
    schemaVersion: 1,
    recordedAtMs: 1234,
    kind: "GESTURE_SESSION",
    tabId: 7,
    windowId: 2,
    classification: "HORIZONTAL_NEGATIVE_X",
    semanticDirection: "BACK_GESTURE",
    blockers: ["TOO_FEW_EVENTS"],
    netHorizontalDistancePx: 345.68,
    horizontalDominanceRatio: null,
    directionConsistency: null,
    eventCount: null,
    peakHorizontalDeltaPx: null,
    automaticActionRequested: null,
    automaticActionTrigger: null,
    actionRequestedAfterMs: null,
  });
  assert.equal("url" in entry, false);
  assert.equal("title" in entry, false);
  assert.equal("rawEvents" in entry, false);
});

test("persistent diagnostics are serialized, bounded, and clearable", async () => {
  const storage = new MemoryStorageArea();
  let now = 100;
  const log = new DiagnosticLog(storage, 3, () => ++now);

  await Promise.all([
    log.record({ kind: "BACK_ACTION", action: "RETURNED_TO_OPENER", reason: "RETURNED_TO_OPENER" }),
    log.record({ kind: "BACK_ACTION", action: "USE_INTERNAL_HISTORY", reason: "INTERNAL_HISTORY_AVAILABLE" }),
    log.record({ kind: "GESTURE_OWNERSHIP", owner: "BROWSER", reason: "NO_OPENER" }),
    log.record({ kind: "BACK_ACTION", action: "NO_SPECIAL_ACTION", reason: "GESTURE_DEDUPLICATED" }),
  ]);

  const entries = await log.list();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.kind), [
    "BACK_ACTION",
    "GESTURE_OWNERSHIP",
    "BACK_ACTION",
  ]);
  assert.equal((await storage.get(DIAGNOSTIC_LOG_KEY))[DIAGNOSTIC_LOG_KEY].entries.length, 3);
  assert.equal(await log.clear(), true);
  assert.deepEqual(await log.list(), []);
});

test("the message handler stores diagnostics under the actual sender tab and serves clear/list", async () => {
  const recorded = [];
  const diagnosticLog = {
    async record(value) { recorded.push(structuredClone(value)); },
    async list() { return [{ kind: "BACK_ACTION" }]; },
    async clear() { return true; },
  };
  const listener = createNavigationMessageListener({}, {}, null, diagnosticLog);
  const sender = { tab: { id: 22, windowId: 4 } };
  const request = (message) => new Promise((resolve) => {
    assert.equal(listener(message, sender, resolve), true);
  });

  assert.deepEqual(await request({
    type: MESSAGE_TYPES.RECORD_GESTURE_DIAGNOSTIC,
    diagnostic: { kind: "GESTURE_SESSION", tabId: 99, url: "https://never.store" },
  }), { ok: true });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].tabId, 22);
  assert.equal(recorded[0].windowId, 4);
  assert.equal(recorded[0].url, "https://never.store");
  // Sanitization is deliberately owned by DiagnosticLog, not a message caller.

  assert.deepEqual(await request({ type: MESSAGE_TYPES.GET_DIAGNOSTIC_LOG }), {
    entries: [{ kind: "BACK_ACTION" }],
  });
  assert.deepEqual(await request({ type: MESSAGE_TYPES.CLEAR_DIAGNOSTIC_LOG }), {
    cleared: true,
  });
});
