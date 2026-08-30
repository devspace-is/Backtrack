import { resolveSafeOpener } from "./opener-resolver.js";
import { NAVIGATION_AVAILABILITY } from "./navigation-tracker.js";

export const BACK_DECISIONS = Object.freeze({
  USE_INTERNAL_HISTORY: "USE_INTERNAL_HISTORY",
  RETURN_TO_OPENER_ELIGIBLE: "RETURN_TO_OPENER_ELIGIBLE",
  NO_SPECIAL_ACTION: "NO_SPECIAL_ACTION",
});

export async function evaluateBackDecision(
  currentTab,
  liveSnapshot,
  tabsApi,
  navigationTracker,
) {
  const opener = await resolveSafeOpener(currentTab, tabsApi);
  if (!opener.ok) {
    return {
      decision: BACK_DECISIONS.NO_SPECIAL_ACTION,
      reason: opener.reason,
      opener,
      navigation: null,
      notice: "Diagnostic only; no history or tab action was performed.",
    };
  }

  await navigationTracker.recordSnapshot(currentTab.id, liveSnapshot);
  const navigation = await navigationTracker.assess(currentTab.id, liveSnapshot);

  let decision = BACK_DECISIONS.NO_SPECIAL_ACTION;
  if (
    navigation.availability ===
    NAVIGATION_AVAILABILITY.INTERNAL_BACK_AVAILABLE
  ) {
    decision = BACK_DECISIONS.USE_INTERNAL_HISTORY;
  } else if (
    navigation.availability === NAVIGATION_AVAILABILITY.AT_ENTRY_POINT
  ) {
    decision = BACK_DECISIONS.RETURN_TO_OPENER_ELIGIBLE;
  }

  return {
    decision,
    reason: navigation.reason,
    opener,
    navigation,
    notice: "Diagnostic only; no history or tab action was performed.",
  };
}
