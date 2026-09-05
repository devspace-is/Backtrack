import {
  BACK_DECISIONS,
  evaluateBackDecision,
} from "./back-decision.js";
import { resolveSafeOpener } from "./opener-resolver.js";
import { NAVIGATION_REASONS } from "./navigation-tracker.js";

export const TAB_ACTIONS = Object.freeze({
  USE_INTERNAL_HISTORY: "USE_INTERNAL_HISTORY",
  USE_BROWSER_HISTORY: "USE_BROWSER_HISTORY",
  RETURNED_TO_OPENER: "RETURNED_TO_OPENER",
  NO_SPECIAL_ACTION: "NO_SPECIAL_ACTION",
});

export const TAB_ACTION_REASONS = Object.freeze({
  INTERNAL_HISTORY_AVAILABLE: "INTERNAL_HISTORY_AVAILABLE",
  BROWSER_HISTORY_FALLBACK: "BROWSER_HISTORY_FALLBACK",
  NAVIGATION_IN_PROGRESS: "NAVIGATION_IN_PROGRESS",
  DECISION_NOT_ELIGIBLE: "DECISION_NOT_ELIGIBLE",
  CURRENT_TAB_UNAVAILABLE: "CURRENT_TAB_UNAVAILABLE",
  CURRENT_TAB_NOT_ACTIVE: "CURRENT_TAB_NOT_ACTIVE",
  CURRENT_TAB_CHANGED: "CURRENT_TAB_CHANGED",
  OPENER_RELATIONSHIP_CHANGED: "OPENER_RELATIONSHIP_CHANGED",
  OPENER_ACTIVATION_FAILED: "OPENER_ACTIVATION_FAILED",
  OPENER_ACTIVATION_UNCONFIRMED: "OPENER_ACTIVATION_UNCONFIRMED",
  POST_ACTIVATION_VALIDATION_FAILED: "POST_ACTIVATION_VALIDATION_FAILED",
  CHILD_UNAVAILABLE_AFTER_ACTIVATION: "CHILD_UNAVAILABLE_AFTER_ACTIVATION",
  CHILD_CLOSE_FAILED: "CHILD_CLOSE_FAILED",
  RETURNED_TO_OPENER: "RETURNED_TO_OPENER",
});

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function readTab(tabsApi, tabId) {
  try {
    const tab = await tabsApi.get(tabId);
    return tab && typeof tab === "object" ? tab : null;
  } catch {
    return null;
  }
}

function noAction(reason, decision, details = {}) {
  return {
    action: TAB_ACTIONS.NO_SPECIAL_ACTION,
    reason,
    decision,
    ...details,
  };
}

async function restoreChildFocus(tabsApi, childTabId, expectedWindowId) {
  const child = await readTab(tabsApi, childTabId);
  if (
    usableId(child?.id) !== childTabId ||
    usableId(child?.windowId) !== expectedWindowId
  ) {
    return false;
  }

  try {
    const restored = await tabsApi.update(childTabId, { active: true });
    return (
      usableId(restored?.id) === childTabId &&
      usableId(restored?.windowId) === expectedWindowId &&
      restored?.active === true
    );
  } catch {
    return false;
  }
}

function requireTabsApi(tabsApi) {
  if (
    !tabsApi ||
    typeof tabsApi.get !== "function" ||
    typeof tabsApi.update !== "function" ||
    typeof tabsApi.remove !== "function"
  ) {
    throw new TypeError(
      "performConfirmedBackAction requires tabs.get(), tabs.update(), and tabs.remove().",
    );
  }
}

/**
 * Execute one already-confirmed semantic back action.
 *
 * Gesture classification is intentionally outside this module. The caller must
 * not invoke this function for an uncalibrated horizontal movement. Every tab
 * relationship is resolved again immediately before activation and again
 * before the destructive close.
 */
export async function performConfirmedBackAction(
  currentTab,
  liveSnapshot,
  tabsApi,
  navigationTracker,
) {
  requireTabsApi(tabsApi);

  const decision = await evaluateBackDecision(
    currentTab,
    liveSnapshot,
    tabsApi,
    navigationTracker,
  );

  if (decision.decision !== BACK_DECISIONS.RETURN_TO_OPENER_ELIGIBLE) {
    // Closing needs a proven entry and opener. Ordinary Back does not: the
    // browser can traverse its own history, including cross-origin entries,
    // and does nothing when there is no earlier entry.
    if (
      liveSnapshot?.transitionActive === true ||
      decision.reason === NAVIGATION_REASONS.NAVIGATION_IN_PROGRESS
    ) {
      return noAction(TAB_ACTION_REASONS.NAVIGATION_IN_PROGRESS, decision);
    }
    const tabId = usableId(currentTab?.id);
    const windowId = usableId(currentTab?.windowId);
    if (tabId === null || windowId === null) {
      return noAction(TAB_ACTION_REASONS.CURRENT_TAB_UNAVAILABLE, decision);
    }
    const liveTab = await readTab(tabsApi, tabId);
    if (!liveTab) {
      return noAction(TAB_ACTION_REASONS.CURRENT_TAB_UNAVAILABLE, decision);
    }
    if (liveTab.active !== true) {
      return noAction(TAB_ACTION_REASONS.CURRENT_TAB_NOT_ACTIVE, decision);
    }
    if (
      liveTab.id !== tabId ||
      liveTab.windowId !== windowId ||
      liveTab.discarded === true ||
      (liveTab.incognito === true) !== (currentTab.incognito === true)
    ) {
      return noAction(TAB_ACTION_REASONS.CURRENT_TAB_CHANGED, decision);
    }
    const trackedHistory = decision.decision === BACK_DECISIONS.USE_INTERNAL_HISTORY;
    return {
      action: trackedHistory
        ? TAB_ACTIONS.USE_INTERNAL_HISTORY
        : TAB_ACTIONS.USE_BROWSER_HISTORY,
      reason: trackedHistory
        ? TAB_ACTION_REASONS.INTERNAL_HISTORY_AVAILABLE
        : TAB_ACTION_REASONS.BROWSER_HISTORY_FALLBACK,
      decision,
    };
  }

  const childTabId = usableId(decision.opener?.currentTab?.id);
  const expectedOpenerTabId = usableId(decision.opener?.openerTab?.id);
  const expectedWindowId = usableId(decision.opener?.currentTab?.windowId);
  if (
    childTabId === null ||
    expectedOpenerTabId === null ||
    expectedWindowId === null
  ) {
    return noAction(TAB_ACTION_REASONS.OPENER_RELATIONSHIP_CHANGED, decision);
  }

  const liveChild = await readTab(tabsApi, childTabId);
  if (!liveChild) {
    return noAction(TAB_ACTION_REASONS.CURRENT_TAB_UNAVAILABLE, decision);
  }
  if (liveChild.active !== true) {
    return noAction(TAB_ACTION_REASONS.CURRENT_TAB_NOT_ACTIVE, decision);
  }

  const expectedRelationship = {
    openerTabId: expectedOpenerTabId,
    source: decision.opener?.relationshipSource,
  };
  const preActivationOpener = await resolveSafeOpener(
    liveChild,
    tabsApi,
    expectedRelationship,
  );
  if (
    !preActivationOpener.ok ||
    preActivationOpener.currentTab?.id !== childTabId ||
    preActivationOpener.openerTab?.id !== expectedOpenerTabId ||
    preActivationOpener.currentTab?.windowId !== expectedWindowId
  ) {
    return noAction(TAB_ACTION_REASONS.OPENER_RELATIONSHIP_CHANGED, decision);
  }

  let activatedOpener;
  try {
    activatedOpener = await tabsApi.update(expectedOpenerTabId, { active: true });
  } catch {
    return noAction(TAB_ACTION_REASONS.OPENER_ACTIVATION_FAILED, decision);
  }

  if (
    usableId(activatedOpener?.id) !== expectedOpenerTabId ||
    usableId(activatedOpener?.windowId) !== expectedWindowId ||
    activatedOpener?.active !== true
  ) {
    const focusRestored = await restoreChildFocus(
      tabsApi,
      childTabId,
      expectedWindowId,
    );
    return noAction(TAB_ACTION_REASONS.OPENER_ACTIVATION_UNCONFIRMED, decision, {
      focusRestored,
    });
  }

  const childBeforeClose = await readTab(tabsApi, childTabId);
  if (!childBeforeClose) {
    return noAction(
      TAB_ACTION_REASONS.CHILD_UNAVAILABLE_AFTER_ACTIVATION,
      decision,
      { focusRestored: false },
    );
  }

  const finalOpener = await resolveSafeOpener(
    childBeforeClose,
    tabsApi,
    expectedRelationship,
  );
  if (
    !finalOpener.ok ||
    finalOpener.currentTab?.id !== childTabId ||
    finalOpener.openerTab?.id !== expectedOpenerTabId ||
    finalOpener.currentTab?.windowId !== expectedWindowId ||
    finalOpener.openerTab?.active !== true
  ) {
    const focusRestored = await restoreChildFocus(
      tabsApi,
      childTabId,
      expectedWindowId,
    );
    return noAction(
      TAB_ACTION_REASONS.POST_ACTIVATION_VALIDATION_FAILED,
      decision,
      { focusRestored },
    );
  }

  try {
    await tabsApi.remove(childTabId);
  } catch {
    const focusRestored = await restoreChildFocus(
      tabsApi,
      childTabId,
      expectedWindowId,
    );
    return noAction(TAB_ACTION_REASONS.CHILD_CLOSE_FAILED, decision, {
      focusRestored,
    });
  }

  return {
    action: TAB_ACTIONS.RETURNED_TO_OPENER,
    reason: TAB_ACTION_REASONS.RETURNED_TO_OPENER,
    decision,
    childTabId,
    openerTabId: expectedOpenerTabId,
  };
}
