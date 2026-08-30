import { evaluateBackDecision } from "./back-decision.js";
import { performConfirmedBackAction } from "./tab-action.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

export function createNavigationMessageListener(tabsApi, navigationTracker) {
  return (message, sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.NAVIGATION_SNAPSHOT) {
      navigationTracker
        .recordSnapshot(sender?.tab?.id, message.snapshot)
        .then((state) => sendResponse({ ok: state !== null }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === MESSAGE_TYPES.GET_BACK_DECISION) {
      evaluateBackDecision(
        sender?.tab,
        message.snapshot,
        tabsApi,
        navigationTracker,
      )
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            decision: "NO_SPECIAL_ACTION",
            reason: "INTERNAL_ERROR",
            notice:
              "Decision evaluation only; no history or tab action was performed.",
          }),
        );
      return true;
    }

    if (message?.type === MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION) {
      performConfirmedBackAction(
        sender?.tab,
        message.snapshot,
        tabsApi,
        navigationTracker,
      )
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            action: "NO_SPECIAL_ACTION",
            reason: "INTERNAL_ERROR",
          }),
        );
      return true;
    }

    return false;
  };
}
