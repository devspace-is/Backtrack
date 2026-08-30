import assert from "node:assert/strict";
import test from "node:test";

import {
  GESTURE_GATE_REASONS,
  GestureActionGate,
} from "../src/background/gesture-action-gate.js";

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

function gesture(id, observedAtMs) {
  return { id, observedAtMs };
}

test("one gesture can be claimed only once", async () => {
  const gate = new GestureActionGate(new MemoryStorageArea(), 1800);

  const first = await gate.claim(20, gesture("gesture-a", 10_000), 10_100);
  const duplicate = await gate.claim(20, gesture("gesture-a", 10_000), 10_200);

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, GESTURE_GATE_REASONS.DUPLICATE_GESTURE);
});

test("a split momentum tail is blocked by the tab cooldown", async () => {
  const gate = new GestureActionGate(new MemoryStorageArea(), 1800);

  await gate.claim(20, gesture("gesture-a", 10_000), 10_100);
  const tail = await gate.claim(20, gesture("gesture-tail", 10_400), 10_500);

  assert.equal(tail.ok, false);
  assert.equal(tail.reason, GESTURE_GATE_REASONS.COOLDOWN_ACTIVE);
  assert.equal(tail.retryAfterMs, 1400);
});

test("a later physical gesture can be claimed", async () => {
  const gate = new GestureActionGate(new MemoryStorageArea(), 1800);

  await gate.claim(20, gesture("gesture-a", 10_000), 10_100);
  const later = await gate.claim(20, gesture("gesture-b", 12_000), 12_050);

  assert.equal(later.ok, true);
});

test("cooldowns are independent per tab and removed with the tab", async () => {
  const storage = new MemoryStorageArea();
  const gate = new GestureActionGate(storage, 1800);

  await gate.claim(20, gesture("gesture-a", 10_000), 10_100);
  assert.equal(
    (await gate.claim(21, gesture("gesture-b", 10_100), 10_200)).ok,
    true,
  );

  await gate.remove(20);
  assert.equal(
    (await gate.claim(20, gesture("gesture-c", 10_300), 10_400)).ok,
    true,
  );
});

test("stale, future, malformed, and tabless requests are rejected", async () => {
  const gate = new GestureActionGate(new MemoryStorageArea(), 1800);

  for (const [tabId, request, now] of [
    [null, gesture("a", 10_000), 10_100],
    [20, gesture("", 10_000), 10_100],
    [20, gesture("a", -1), 10_100],
    [20, gesture("a", 20_000), 10_100],
    [20, gesture("a", 1), 20_000],
  ]) {
    const result = await gate.claim(tabId, request, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, GESTURE_GATE_REASONS.INVALID_REQUEST);
  }
});
