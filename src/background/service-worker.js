import { createOpenerMessageListener } from "./opener-message-handler.js";
import { createNavigationMessageListener } from "./navigation-message-handler.js";
import { GestureActionGate } from "./gesture-action-gate.js";
import { NavigationTracker } from "./navigation-tracker.js";
import { createNavigationTargetListener } from "./navigation-target-handler.js";
import { resolveSafeOpener } from "./opener-resolver.js";
import { DiagnosticLog } from "./diagnostic-log.js";

const LOG_PREFIX = "[Backtrack:Opener]";
const navigationTracker = new NavigationTracker(chrome.storage.session);
const gestureActionGate = new GestureActionGate(chrome.storage.session);
const diagnosticLog = new DiagnosticLog(chrome.storage.local);

chrome.runtime.onMessage.addListener(
  createOpenerMessageListener(chrome.tabs),
);
chrome.runtime.onMessage.addListener(
  createNavigationMessageListener(
    chrome.tabs,
    navigationTracker,
    gestureActionGate,
    diagnosticLog,
  ),
);

chrome.tabs.onCreated.addListener((tab) => {
  if (!Number.isInteger(tab.openerTabId)) {
    return;
  }

  void navigationTracker
    .beginCandidate(tab)
    .then(() => resolveSafeOpener(tab, chrome.tabs))
    .then(async (result) => {
      if (result.ok) {
        await navigationTracker.confirmCandidate(tab.id, tab.openerTabId);
      } else {
        await navigationTracker.remove(tab.id);
      }

      console.info(LOG_PREFIX, {
        event: "tab-created-with-opener",
        result,
        notice: "Diagnostic only; no tab action or persistent history.",
      });
    })
    .catch(async () => {
      await navigationTracker.remove(tab.id);
      console.info(LOG_PREFIX, {
        event: "tab-created-with-opener",
        result: { ok: false, reason: "INTERNAL_ERROR" },
        notice: "Diagnostic only; no tab action or persistent history.",
      });
    });
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(
  createNavigationTargetListener(chrome.tabs, navigationTracker),
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void navigationTracker.remove(tabId);
  void gestureActionGate.remove(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void navigationTracker.remove(removedTabId);
  void navigationTracker.remove(addedTabId);
  void gestureActionGate.remove(removedTabId);
  void gestureActionGate.remove(addedTabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void gestureActionGate.removeWindow(windowId);
});
