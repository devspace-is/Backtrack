import { OPENER_RELATIONSHIP_SOURCES } from "./navigation-tracker.js";
import { resolveSafeOpener } from "./opener-resolver.js";

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export async function registerNavigationTarget(
  details,
  tabsApi,
  navigationTracker,
) {
  const tabId = usableId(details?.tabId);
  const sourceTabId = usableId(details?.sourceTabId);
  if (tabId === null || sourceTabId === null || tabId === sourceTabId) {
    return { ok: false, reason: "INVALID_NAVIGATION_TARGET" };
  }

  let childTab;
  try {
    childTab = await tabsApi.get(tabId);
  } catch {
    return { ok: false, reason: "CHILD_UNAVAILABLE" };
  }

  const relationship = {
    openerTabId: sourceTabId,
    source: OPENER_RELATIONSHIP_SOURCES.NAVIGATION_TARGET,
  };
  const candidate = await navigationTracker.beginCandidate(
    childTab,
    relationship,
  );
  if (!candidate) {
    return { ok: false, reason: "CANDIDATE_CONFLICT" };
  }

  const result = await resolveSafeOpener(childTab, tabsApi, relationship);
  if (!result.ok) {
    await navigationTracker.remove(tabId);
    return result;
  }

  const confirmed = await navigationTracker.confirmCandidate(tabId, sourceTabId);
  if (!confirmed) {
    await navigationTracker.remove(tabId);
    return { ok: false, reason: "CANDIDATE_CONFIRMATION_FAILED" };
  }

  return result;
}

export function createNavigationTargetListener(
  tabsApi,
  navigationTracker,
  logger = console,
) {
  return (details) => {
    void registerNavigationTarget(details, tabsApi, navigationTracker)
      .then((result) => {
        logger.info("[Backtrack:Opener]", {
          event: "navigation-target-created",
          result,
          notice:
            "Session-only relationship metadata; no URL, title, or page content is retained.",
        });
      })
      .catch(async () => {
        await navigationTracker.remove(details?.tabId);
        logger.info("[Backtrack:Opener]", {
          event: "navigation-target-created",
          result: { ok: false, reason: "INTERNAL_ERROR" },
          notice: "No tab action was performed.",
        });
      });
  };
}
