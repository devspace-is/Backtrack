import { createOpenerMessageListener } from "./opener-message-handler.js";
import { resolveSafeOpener } from "./opener-resolver.js";

const LOG_PREFIX = "[Backtrack:Opener]";

chrome.runtime.onMessage.addListener(
  createOpenerMessageListener(chrome.tabs),
);

chrome.tabs.onCreated.addListener((tab) => {
  if (!Number.isInteger(tab.openerTabId)) {
    return;
  }

  void resolveSafeOpener(tab, chrome.tabs).then((result) => {
    console.info(LOG_PREFIX, {
      event: "tab-created-with-opener",
      result,
      notice: "Diagnostic only; no tab action or persistent state.",
    });
  }).catch(() => {
    console.info(LOG_PREFIX, {
      event: "tab-created-with-opener",
      result: { ok: false, reason: "INTERNAL_ERROR" },
      notice: "Diagnostic only; no tab action or persistent state.",
    });
  });
});
