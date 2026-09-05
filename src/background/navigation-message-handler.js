import { evaluateBackDecision } from "./back-decision.js";
import { performConfirmedBackAction } from "./tab-action.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

export function createNavigationMessageListener(
  tabsApi,
  navigationTracker,
  gestureActionGate = null,
  diagnosticLog = null,
) {
  const recordDiagnostic = async (entry) => {
    try {
      await diagnosticLog?.record?.(entry);
    } catch {
      // Diagnostics are best effort and must never change navigation behavior.
    }
  };

  const actionDiagnostic = (sender, message, result, gateReason = null) => ({
    kind: "BACK_ACTION",
    recordedAtMs: Date.now(),
    tabId: sender?.tab?.id,
    windowId: sender?.tab?.windowId,
    source: message?.gesture?.source,
    action: result?.action,
    reason: result?.reason,
    decision: result?.decision?.decision,
    decisionReason: result?.decision?.reason,
    gateReason,
  });

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

    if (message?.type === MESSAGE_TYPES.RECORD_GESTURE_DIAGNOSTIC) {
      recordDiagnostic({
        ...message.diagnostic,
        recordedAtMs: Date.now(),
        tabId: sender?.tab?.id,
        windowId: sender?.tab?.windowId,
      })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === MESSAGE_TYPES.GET_DIAGNOSTIC_LOG) {
      Promise.resolve(diagnosticLog?.list?.() ?? [])
        .then((entries) => sendResponse({ entries }))
        .catch(() => sendResponse({ entries: [] }));
      return true;
    }

    if (message?.type === MESSAGE_TYPES.CLEAR_DIAGNOSTIC_LOG) {
      Promise.resolve(diagnosticLog?.clear?.() ?? false)
        .then((cleared) => sendResponse({ cleared: cleared === true }))
        .catch(() => sendResponse({ cleared: false }));
      return true;
    }

    if (message?.type === MESSAGE_TYPES.PERFORM_CONFIRMED_BACK_ACTION) {
      const runAction = async () => {
        if (sender?.frameId !== undefined && sender.frameId !== 0) {
          const result = {
            action: "NO_SPECIAL_ACTION",
            reason: "NOT_TOP_FRAME",
          };
          await recordDiagnostic(actionDiagnostic(sender, message, result));
          return result;
        }
        if (message?.gesture?.source === "AUTOMATIC") {
          if (!gestureActionGate) {
            const result = {
              action: "NO_SPECIAL_ACTION",
              reason: "GESTURE_GATE_UNAVAILABLE",
            };
            await recordDiagnostic(actionDiagnostic(sender, message, result));
            return result;
          }
          const claim = await gestureActionGate.claim(
            sender?.tab?.id,
            sender?.tab?.windowId,
            message.gesture,
          );
          if (!claim.ok) {
            const result = {
              action: "NO_SPECIAL_ACTION",
              reason: "GESTURE_DEDUPLICATED",
              gestureGate: claim,
            };
            await recordDiagnostic(
              actionDiagnostic(sender, message, result, claim.reason),
            );
            return result;
          }
        } else if (message?.gesture?.source !== "MANUAL_DEVELOPMENT") {
          const result = {
            action: "NO_SPECIAL_ACTION",
            reason: "UNSUPPORTED_ACTION_SOURCE",
          };
          await recordDiagnostic(actionDiagnostic(sender, message, result));
          return result;
        }

        const result = await performConfirmedBackAction(
          sender?.tab,
          message.snapshot,
          tabsApi,
          navigationTracker,
        );
        await recordDiagnostic(actionDiagnostic(sender, message, result));
        return result;
      };

      runAction()
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
