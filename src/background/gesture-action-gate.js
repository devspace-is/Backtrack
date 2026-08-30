const STORAGE_PREFIX = "backtrack.gesture.action-gate.";

export const GESTURE_GATE_REASONS = Object.freeze({
  ACCEPTED: "ACCEPTED",
  INVALID_REQUEST: "INVALID_REQUEST",
  DUPLICATE_GESTURE: "DUPLICATE_GESTURE",
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",
});

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function storageKey(tabId) {
  return `${STORAGE_PREFIX}${tabId}`;
}

function validGestureId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

export class GestureActionGate {
  constructor(storageArea, cooldownMs = 1800) {
    if (
      !storageArea ||
      typeof storageArea.get !== "function" ||
      typeof storageArea.set !== "function" ||
      typeof storageArea.remove !== "function"
    ) {
      throw new TypeError("GestureActionGate requires a storage area.");
    }
    if (!Number.isFinite(cooldownMs) || cooldownMs < 500) {
      throw new TypeError("GestureActionGate requires a cooldown of at least 500 ms.");
    }

    this.storageArea = storageArea;
    this.cooldownMs = cooldownMs;
    this.queues = new Map();
  }

  #enqueue(tabId, operation) {
    const previous = this.queues.get(tabId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(tabId, next);
    const cleanup = () => {
      if (this.queues.get(tabId) === next) {
        this.queues.delete(tabId);
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  claim(tabId, gesture, nowMs = Date.now()) {
    const safeTabId = usableId(tabId);
    const observedAtMs = gesture?.observedAtMs;
    if (
      safeTabId === null ||
      !validGestureId(gesture?.id) ||
      !Number.isFinite(observedAtMs) ||
      !Number.isFinite(nowMs) ||
      observedAtMs > nowMs + 1000 ||
      nowMs - observedAtMs > 10_000
    ) {
      return Promise.resolve({
        ok: false,
        reason: GESTURE_GATE_REASONS.INVALID_REQUEST,
      });
    }

    return this.#enqueue(safeTabId, async () => {
      const key = storageKey(safeTabId);
      const stored = await this.storageArea.get(key);
      const previous = stored?.[key] ?? null;

      if (previous?.gestureId === gesture.id) {
        return {
          ok: false,
          reason: GESTURE_GATE_REASONS.DUPLICATE_GESTURE,
        };
      }
      if (
        Number.isFinite(previous?.claimedAtMs) &&
        nowMs - previous.claimedAtMs < this.cooldownMs
      ) {
        return {
          ok: false,
          reason: GESTURE_GATE_REASONS.COOLDOWN_ACTIVE,
          retryAfterMs: this.cooldownMs - (nowMs - previous.claimedAtMs),
        };
      }

      await this.storageArea.set({
        [key]: {
          schemaVersion: 1,
          gestureId: gesture.id,
          claimedAtMs: nowMs,
        },
      });
      return {
        ok: true,
        reason: GESTURE_GATE_REASONS.ACCEPTED,
      };
    });
  }

  remove(tabId) {
    const safeTabId = usableId(tabId);
    if (safeTabId === null) {
      return Promise.resolve();
    }
    return this.#enqueue(safeTabId, () =>
      this.storageArea.remove(storageKey(safeTabId)),
    );
  }
}
