export const NAVIGATION_TRACKING_STATUS = Object.freeze({
  AWAITING_ENTRY: "AWAITING_ENTRY",
  READY: "READY",
  UNCERTAIN: "UNCERTAIN",
});

export const NAVIGATION_AVAILABILITY = Object.freeze({
  INTERNAL_BACK_AVAILABLE: "INTERNAL_BACK_AVAILABLE",
  AT_ENTRY_POINT: "AT_ENTRY_POINT",
  UNKNOWN: "UNKNOWN",
});

export const OPENER_RELATIONSHIP_SOURCES = Object.freeze({
  TAB_OPENER_ID: "TAB_OPENER_ID",
  NAVIGATION_TARGET: "NAVIGATION_TARGET",
});

export const NAVIGATION_REASONS = Object.freeze({
  TRACKED_INTERNAL_ENTRY: "TRACKED_INTERNAL_ENTRY",
  TRACKED_ENTRY_POINT: "TRACKED_ENTRY_POINT",
  NOT_TRACKED: "NOT_TRACKED",
  AWAITING_ENTRY: "AWAITING_ENTRY",
  OPENER_NOT_VALIDATED: "OPENER_NOT_VALIDATED",
  NAVIGATION_API_UNAVAILABLE: "NAVIGATION_API_UNAVAILABLE",
  INCOMPLETE_NAVIGATION_SNAPSHOT: "INCOMPLETE_NAVIGATION_SNAPSHOT",
  UNEXPECTED_ENTRY_CHANGE: "UNEXPECTED_ENTRY_CHANGE",
  RELOAD_CHANGED_ENTRY: "RELOAD_CHANGED_ENTRY",
  CONTRADICTORY_BROWSER_SIGNAL: "CONTRADICTORY_BROWSER_SIGNAL",
  NAVIGATION_IN_PROGRESS: "NAVIGATION_IN_PROGRESS",
  INVALID_TAB: "INVALID_TAB",
});

const NAVIGATION_TYPES = new Set(["push", "replace", "reload", "traverse"]);
const STORAGE_PREFIX = "backtrack.navigation.";

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function usableEntryKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function normalizeNavigationType(value) {
  return NAVIGATION_TYPES.has(value) ? value : null;
}

function storageKey(tabId) {
  return `${STORAGE_PREFIX}${tabId}`;
}

function uncertain(state, reason, snapshot) {
  return {
    ...state,
    status: NAVIGATION_TRACKING_STATUS.UNCERTAIN,
    uncertaintyReason: reason,
    revision: state.revision + 1,
    lastNavigationType: normalizeNavigationType(snapshot?.navigationType),
    sameOriginCanGoBack:
      typeof snapshot?.sameOriginCanGoBack === "boolean"
        ? snapshot.sameOriginCanGoBack
        : null,
    transitionActive: snapshot?.transitionActive === true,
  };
}

function normalizeOpenerSource(value) {
  return Object.values(OPENER_RELATIONSHIP_SOURCES).includes(value)
    ? value
    : null;
}

export function createCandidateState(tab, relationship = null) {
  const tabId = usableId(tab?.id);
  const liveOpenerTabId = usableId(tab?.openerTabId);
  const trackedOpenerTabId = usableId(relationship?.openerTabId);
  const openerTabId = liveOpenerTabId ?? trackedOpenerTabId;
  const openerSource =
    liveOpenerTabId !== null
      ? OPENER_RELATIONSHIP_SOURCES.TAB_OPENER_ID
      : normalizeOpenerSource(relationship?.source);
  if (tabId === null || openerTabId === null) {
    return null;
  }

  if (openerSource === null) {
    return null;
  }

  return {
    schemaVersion: 2,
    tabId,
    openerTabId,
    openerSource,
    openerValidated: false,
    status: NAVIGATION_TRACKING_STATUS.AWAITING_ENTRY,
    baselineEntryKey: null,
    currentEntryKey: null,
    revision: 0,
    lastNavigationType: null,
    sameOriginCanGoBack: null,
    transitionActive: false,
    uncertaintyReason: null,
  };
}

export function applyNavigationSnapshot(state, snapshot) {
  if (!state) {
    return null;
  }

  if (snapshot?.apiAvailable !== true) {
    return uncertain(state, NAVIGATION_REASONS.NAVIGATION_API_UNAVAILABLE, snapshot);
  }

  const entryKey = usableEntryKey(snapshot.currentEntryKey);
  if (entryKey === null) {
    return uncertain(
      state,
      NAVIGATION_REASONS.INCOMPLETE_NAVIGATION_SNAPSHOT,
      snapshot,
    );
  }

  const navigationType = normalizeNavigationType(snapshot.navigationType);
  const common = {
    ...state,
    revision: state.revision + 1,
    lastNavigationType: navigationType,
    sameOriginCanGoBack:
      typeof snapshot.sameOriginCanGoBack === "boolean"
        ? snapshot.sameOriginCanGoBack
        : null,
    transitionActive: snapshot.transitionActive === true,
  };

  if (state.baselineEntryKey === null) {
    return {
      ...common,
      status: NAVIGATION_TRACKING_STATUS.READY,
      baselineEntryKey: entryKey,
      currentEntryKey: entryKey,
      uncertaintyReason: null,
    };
  }

  if (state.status === NAVIGATION_TRACKING_STATUS.UNCERTAIN) {
    return common;
  }

  if (entryKey === state.currentEntryKey) {
    return common;
  }

  if (navigationType === "push" || navigationType === "traverse") {
    return {
      ...common,
      currentEntryKey: entryKey,
    };
  }

  if (navigationType === "replace") {
    const replacingBaseline = state.currentEntryKey === state.baselineEntryKey;
    return {
      ...common,
      baselineEntryKey: replacingBaseline ? entryKey : state.baselineEntryKey,
      currentEntryKey: entryKey,
    };
  }

  if (navigationType === "reload") {
    return uncertain(state, NAVIGATION_REASONS.RELOAD_CHANGED_ENTRY, snapshot);
  }

  return uncertain(state, NAVIGATION_REASONS.UNEXPECTED_ENTRY_CHANGE, snapshot);
}

export function assessTrackedNavigation(state, liveSnapshot = null) {
  if (!state) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: NAVIGATION_REASONS.NOT_TRACKED,
    };
  }

  if (state.status === NAVIGATION_TRACKING_STATUS.AWAITING_ENTRY) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: NAVIGATION_REASONS.AWAITING_ENTRY,
    };
  }

  if (!state.openerValidated) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: NAVIGATION_REASONS.OPENER_NOT_VALIDATED,
    };
  }

  if (state.status === NAVIGATION_TRACKING_STATUS.UNCERTAIN) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: state.uncertaintyReason,
    };
  }

  if (liveSnapshot?.transitionActive === true || state.transitionActive) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: NAVIGATION_REASONS.NAVIGATION_IN_PROGRESS,
    };
  }

  if (!state.baselineEntryKey || !state.currentEntryKey) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: NAVIGATION_REASONS.INCOMPLETE_NAVIGATION_SNAPSHOT,
    };
  }

  if (state.currentEntryKey !== state.baselineEntryKey) {
    return {
      availability: NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE,
      reason: NAVIGATION_REASONS.TRACKED_INTERNAL_ENTRY,
    };
  }

  if (state.sameOriginCanGoBack === true) {
    return {
      availability: NAVIGATION_AVAILABILITY.UNKNOWN,
      reason: NAVIGATION_REASONS.CONTRADICTORY_BROWSER_SIGNAL,
    };
  }

  return {
    availability: NAVIGATION_AVAILABILITY.AT_ENTRY_POINT,
    reason: NAVIGATION_REASONS.TRACKED_ENTRY_POINT,
  };
}

export class NavigationTracker {
  constructor(storageArea) {
    if (
      !storageArea ||
      typeof storageArea.get !== "function" ||
      typeof storageArea.set !== "function" ||
      typeof storageArea.remove !== "function"
    ) {
      throw new TypeError("NavigationTracker requires a storage area.");
    }

    this.storageArea = storageArea;
    this.queues = new Map();
  }

  async #read(tabId) {
    const key = storageKey(tabId);
    const result = await this.storageArea.get(key);
    return result?.[key] ?? null;
  }

  async #write(tabId, state) {
    await this.storageArea.set({ [storageKey(tabId)]: state });
    return state;
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

  beginCandidate(tab, relationship = null) {
    const state = createCandidateState(tab, relationship);
    if (!state) {
      return Promise.resolve(null);
    }

    return this.#enqueue(state.tabId, async () => {
      const existing = await this.#read(state.tabId);
      if (!existing) {
        return this.#write(state.tabId, state);
      }

      if (existing.openerTabId !== state.openerTabId) {
        return null;
      }

      if (
        existing.openerSource !== OPENER_RELATIONSHIP_SOURCES.TAB_OPENER_ID &&
        state.openerSource === OPENER_RELATIONSHIP_SOURCES.TAB_OPENER_ID
      ) {
        return this.#write(state.tabId, {
          ...existing,
          schemaVersion: 2,
          openerSource: OPENER_RELATIONSHIP_SOURCES.TAB_OPENER_ID,
          revision: existing.revision + 1,
        });
      }

      return existing;
    });
  }

  confirmCandidate(tabId, openerTabId) {
    const safeTabId = usableId(tabId);
    const safeOpenerTabId = usableId(openerTabId);
    if (safeTabId === null || safeOpenerTabId === null) {
      return Promise.resolve(null);
    }

    return this.#enqueue(safeTabId, async () => {
      const state = await this.#read(safeTabId);
      if (!state || state.openerTabId !== safeOpenerTabId) {
        return null;
      }
      return this.#write(safeTabId, {
        ...state,
        openerValidated: true,
        revision: state.revision + 1,
      });
    });
  }

  recordSnapshot(tabId, snapshot) {
    const safeTabId = usableId(tabId);
    if (safeTabId === null) {
      return Promise.resolve(null);
    }

    return this.#enqueue(safeTabId, async () => {
      const state = await this.#read(safeTabId);
      const next = applyNavigationSnapshot(state, snapshot);
      return next ? this.#write(safeTabId, next) : null;
    });
  }

  assess(tabId, liveSnapshot = null) {
    const safeTabId = usableId(tabId);
    if (safeTabId === null) {
      return Promise.resolve({
        availability: NAVIGATION_AVAILABILITY.UNKNOWN,
        reason: NAVIGATION_REASONS.INVALID_TAB,
      });
    }

    return this.#enqueue(safeTabId, async () => {
      const state = await this.#read(safeTabId);
      return assessTrackedNavigation(state, liveSnapshot);
    });
  }

  getValidatedOpener(tabId) {
    const safeTabId = usableId(tabId);
    if (safeTabId === null) {
      return Promise.resolve(null);
    }

    return this.#enqueue(safeTabId, async () => {
      const state = await this.#read(safeTabId);
      const openerTabId = usableId(state?.openerTabId);
      if (state?.openerValidated !== true || openerTabId === null) {
        return null;
      }

      return {
        openerTabId,
        source:
          normalizeOpenerSource(state.openerSource) ??
          OPENER_RELATIONSHIP_SOURCES.TAB_OPENER_ID,
      };
    });
  }

  remove(tabId) {
    const safeTabId = usableId(tabId);
    if (safeTabId === null) {
      return Promise.resolve();
    }
    return this.#enqueue(safeTabId, () => this.storageArea.remove(storageKey(safeTabId)));
  }
}
