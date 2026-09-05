export const DIAGNOSTIC_LOG_KEY = "backtrack.diagnostic.log";
export const DIAGNOSTIC_LOG_SCHEMA_VERSION = 1;
export const DEFAULT_DIAGNOSTIC_LOG_LIMIT = 160;

const DIAGNOSTIC_KINDS = new Set([
  "GESTURE_SESSION",
  "BACK_ACTION",
  "GESTURE_OWNERSHIP",
]);
const MAX_REASON_COUNT = 12;
const MAX_REASON_LENGTH = 96;

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function usableTime(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function roundedNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeToken(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REASON_LENGTH ||
    !/^[A-Z0-9_:-]+$/.test(value)
  ) {
    return null;
  }
  return value;
}

function safeTokens(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map(safeToken).filter(Boolean))].slice(
    0,
    MAX_REASON_COUNT,
  );
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

/**
 * Keep the persistent development log intentionally incapable of containing
 * page URLs, titles, text, raw wheel events, or arbitrary page-provided data.
 */
export function sanitizeDiagnosticEntry(value, fallbackTime = Date.now()) {
  const kind = safeToken(value?.kind);
  if (!DIAGNOSTIC_KINDS.has(kind)) {
    return null;
  }

  const entry = {
    schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
    recordedAtMs: usableTime(value?.recordedAtMs, fallbackTime),
    kind,
    tabId: usableId(value?.tabId),
    windowId: usableId(value?.windowId),
  };

  if (kind === "GESTURE_SESSION") {
    return {
      ...entry,
      classification: safeToken(value?.classification),
      semanticDirection: safeToken(value?.semanticDirection),
      blockers: safeTokens(value?.blockers),
      netHorizontalDistancePx: roundedNumber(value?.netHorizontalDistancePx),
      horizontalDominanceRatio: roundedNumber(value?.horizontalDominanceRatio),
      directionConsistency: roundedNumber(value?.directionConsistency, 4),
      eventCount: usableId(value?.eventCount),
      peakHorizontalDeltaPx: roundedNumber(value?.peakHorizontalDeltaPx),
      automaticActionRequested: optionalBoolean(value?.automaticActionRequested),
      automaticActionTrigger: safeToken(value?.automaticActionTrigger),
      actionRequestedAfterMs: roundedNumber(value?.actionRequestedAfterMs),
    };
  }

  if (kind === "BACK_ACTION") {
    return {
      ...entry,
      source: safeToken(value?.source),
      action: safeToken(value?.action),
      reason: safeToken(value?.reason),
      decision: safeToken(value?.decision),
      decisionReason: safeToken(value?.decisionReason),
      gateReason: safeToken(value?.gateReason),
    };
  }

  return {
    ...entry,
    owner: safeToken(value?.owner),
    reason: safeToken(value?.reason),
  };
}

function storedEntries(value) {
  if (!Array.isArray(value?.entries)) {
    return [];
  }
  return value.entries
    .map((entry) => sanitizeDiagnosticEntry(entry, entry?.recordedAtMs))
    .filter(Boolean);
}

export class DiagnosticLog {
  constructor(storageArea, limit = DEFAULT_DIAGNOSTIC_LOG_LIMIT, now = Date.now) {
    if (
      !storageArea ||
      typeof storageArea.get !== "function" ||
      typeof storageArea.set !== "function" ||
      typeof storageArea.remove !== "function"
    ) {
      throw new TypeError("DiagnosticLog requires storage get(), set(), and remove().");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError("DiagnosticLog limit must be an integer from 1 to 1000.");
    }
    if (typeof now !== "function") {
      throw new TypeError("DiagnosticLog requires a clock function.");
    }
    this.storageArea = storageArea;
    this.limit = limit;
    this.now = now;
    this.queue = Promise.resolve();
  }

  #enqueue(operation) {
    const next = this.queue.catch(() => undefined).then(operation);
    this.queue = next;
    return next;
  }

  record(value) {
    const entry = sanitizeDiagnosticEntry(value, this.now());
    if (!entry) {
      return Promise.resolve(null);
    }
    return this.#enqueue(async () => {
      const stored = await this.storageArea.get(DIAGNOSTIC_LOG_KEY);
      const entries = [...storedEntries(stored?.[DIAGNOSTIC_LOG_KEY]), entry].slice(
        -this.limit,
      );
      await this.storageArea.set({
        [DIAGNOSTIC_LOG_KEY]: {
          schemaVersion: DIAGNOSTIC_LOG_SCHEMA_VERSION,
          entries,
        },
      });
      return structuredClone(entry);
    });
  }

  list() {
    return this.#enqueue(async () => {
      const stored = await this.storageArea.get(DIAGNOSTIC_LOG_KEY);
      return structuredClone(storedEntries(stored?.[DIAGNOSTIC_LOG_KEY]).slice(-this.limit));
    });
  }

  clear() {
    return this.#enqueue(async () => {
      await this.storageArea.remove(DIAGNOSTIC_LOG_KEY);
      return true;
    });
  }
}
