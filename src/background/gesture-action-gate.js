const TAB_STORAGE_PREFIX = "backtrack.gesture.action-gate.tab.";
const WINDOW_STORAGE_PREFIX = "backtrack.gesture.action-gate.window.";

export const GESTURE_GATE_REASONS = Object.freeze({
  ACCEPTED: "ACCEPTED",
  INVALID_REQUEST: "INVALID_REQUEST",
  DUPLICATE_GESTURE: "DUPLICATE_GESTURE",
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",
});

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function tabStorageKey(tabId) {
  return `${TAB_STORAGE_PREFIX}${tabId}`;
}

function windowStorageKey(windowId) {
  return `${WINDOW_STORAGE_PREFIX}${windowId}`;
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
      throw new TypeError(
        "GestureActionGate requires a cooldown of at least 500 ms.",
      );
    }

    this.storageArea = storageArea;
    this.cooldownMs = cooldownMs;
    this.queues = new Map();
  }

  #enqueue(scopeKey, operation) {
    const previous = this.queues.get(scopeKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(scopeKey, next);
    const cleanup = () => {
      if (this.queues.get(scopeKey) === next) {
        this.queues.delete(scopeKey);
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  claim(tabId, windowId, gesture, nowMs = Date.now()) {
    const safeTabId = usableId(tabId);
    const safeWindowId = usableId(windowId);
    const observedAtMs = gesture?.observedAtMs;
    if (
      safeTabId === null ||
      safeWindowId === null ||
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

    const tabKey = tabStorageKey(safeTabId);
    const windowKey = windowStorageKey(safeWindowId);
    return this.#enqueue(windowKey, async () => {
      const tabStored = await this.storageArea.get(tabKey);
      const windowStored = await this.storageArea.get(windowKey);
      const previousTab = tabStored?.[tabKey] ?? null;
      const previousWindow = windowStored?.[windowKey] ?? null;

      if (
        previousTab?.gestureId === gesture.id ||
        previousWindow?.gestureId === gesture.id
      ) {
        return {
          ok: false,
          reason: GESTURE_GATE_REASONS.DUPLICATE_GESTURE,
        };
      }
      for (const [scope, previous] of [
        ["TAB", previousTab],
        ["WINDOW", previousWindow],
      ]) {
        if (
          Number.isFinite(previous?.claimedAtMs) &&
          nowMs - previous.claimedAtMs < this.cooldownMs
        ) {
          return {
            ok: false,
            reason: GESTURE_GATE_REASONS.COOLDOWN_ACTIVE,
            scope,
            retryAfterMs: this.cooldownMs - (nowMs - previous.claimedAtMs),
          };
        }
      }

      await this.storageArea.set({
        [tabKey]: {
          schemaVersion: 1,
          gestureId: gesture.id,
          claimedAtMs: nowMs,
        },
        [windowKey]: {
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
    const key = tabStorageKey(safeTabId);
    return this.#enqueue(key, () => this.storageArea.remove(key));
  }

  removeWindow(windowId) {
    const safeWindowId = usableId(windowId);
    if (safeWindowId === null) {
      return Promise.resolve();
    }
    const key = windowStorageKey(safeWindowId);
    return this.#enqueue(key, () => this.storageArea.remove(key));
  }
}
