export const OPENER_REASONS = Object.freeze({
  VALID_OPENER: "VALID_OPENER",
  INVALID_CURRENT_TAB: "INVALID_CURRENT_TAB",
  NO_OPENER: "NO_OPENER",
  SELF_REFERENCE: "SELF_REFERENCE",
  CURRENT_TAB_PINNED: "CURRENT_TAB_PINNED",
  OPENER_UNAVAILABLE: "OPENER_UNAVAILABLE",
  OPENER_ID_MISMATCH: "OPENER_ID_MISMATCH",
  INVALID_WINDOW: "INVALID_WINDOW",
  DIFFERENT_WINDOW: "DIFFERENT_WINDOW",
  INCOGNITO_MISMATCH: "INCOGNITO_MISMATCH",
  OPENER_DISCARDED: "OPENER_DISCARDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeTabSnapshot(tab) {
  if (!tab || typeof tab !== "object") {
    return null;
  }

  return {
    id: usableId(tab.id),
    windowId: usableId(tab.windowId),
    openerTabId: usableId(tab.openerTabId),
    active: tab.active === true,
    pinned: tab.pinned === true,
    discarded: tab.discarded === true,
    incognito: tab.incognito === true,
    groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
  };
}

function blocked(reason, currentTab, openerTab = null) {
  return {
    ok: false,
    reason,
    currentTab: safeTabSnapshot(currentTab),
    openerTab: safeTabSnapshot(openerTab),
  };
}

/**
 * Resolve one exact opener relationship without storing a tab tree.
 *
 * The result intentionally excludes URLs, titles, favicons, and page content.
 * A later action must resolve this relationship again immediately before it
 * focuses or closes a tab because browser state can change at any time.
 *
 * @param {Record<string, unknown> | undefined} currentTab
 * @param {{ get(tabId: number): Promise<Record<string, unknown>> }} tabsApi
 */
export async function resolveSafeOpener(currentTab, tabsApi) {
  if (!tabsApi || typeof tabsApi.get !== "function") {
    throw new TypeError("resolveSafeOpener requires a tabs API with get(tabId).");
  }

  const currentTabId = usableId(currentTab?.id);
  if (currentTabId === null) {
    return blocked(OPENER_REASONS.INVALID_CURRENT_TAB, currentTab);
  }

  const openerTabId = usableId(currentTab?.openerTabId);
  if (openerTabId === null) {
    return blocked(OPENER_REASONS.NO_OPENER, currentTab);
  }

  if (openerTabId === currentTabId) {
    return blocked(OPENER_REASONS.SELF_REFERENCE, currentTab);
  }

  if (currentTab?.pinned === true) {
    return blocked(OPENER_REASONS.CURRENT_TAB_PINNED, currentTab);
  }

  let openerTab;
  try {
    openerTab = await tabsApi.get(openerTabId);
  } catch {
    return blocked(OPENER_REASONS.OPENER_UNAVAILABLE, currentTab);
  }

  if (!openerTab || typeof openerTab !== "object") {
    return blocked(OPENER_REASONS.OPENER_UNAVAILABLE, currentTab);
  }

  if (usableId(openerTab.id) !== openerTabId) {
    return blocked(OPENER_REASONS.OPENER_ID_MISMATCH, currentTab, openerTab);
  }

  const currentWindowId = usableId(currentTab.windowId);
  const openerWindowId = usableId(openerTab.windowId);
  if (currentWindowId === null || openerWindowId === null) {
    return blocked(OPENER_REASONS.INVALID_WINDOW, currentTab, openerTab);
  }

  if (currentWindowId !== openerWindowId) {
    return blocked(OPENER_REASONS.DIFFERENT_WINDOW, currentTab, openerTab);
  }

  if ((currentTab.incognito === true) !== (openerTab.incognito === true)) {
    return blocked(OPENER_REASONS.INCOGNITO_MISMATCH, currentTab, openerTab);
  }

  if (openerTab.discarded === true) {
    return blocked(OPENER_REASONS.OPENER_DISCARDED, currentTab, openerTab);
  }

  return {
    ok: true,
    reason: OPENER_REASONS.VALID_OPENER,
    currentTab: safeTabSnapshot(currentTab),
    openerTab: safeTabSnapshot(openerTab),
  };
}

export function internalErrorResult(currentTab) {
  return blocked(OPENER_REASONS.INTERNAL_ERROR, currentTab);
}
