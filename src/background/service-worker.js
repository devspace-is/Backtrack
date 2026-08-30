import { createOpenerMessageListener } from "./opener-message-handler.js";
import { createNavigationMessageListener } from "./navigation-message-handler.js";
import { NavigationTracker } from "./navigation-tracker.js";
import { resolveSafeOpener } from "./opener-resolver.js";

const LOG_PREFIX = "[Backtrack:Opener]";
const navigationTracker = new NavigationTracker(chrome.storage.session);

chrome.runtime.onMessage.addListener(
  createOpenerMessageListener(chrome.tabs),
);
chrome.runtime.onMessage.addListener(
  createNavigationMessageListener(chrome.tabs, navigationTracker),
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

chrome.tabs.onRemoved.addListener((tabId) => {
  void navigationTracker.remove(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void navigationTracker.remove(removedTabId);
  void navigationTracker.remove(addedTabId);
});
