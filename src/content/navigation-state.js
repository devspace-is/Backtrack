// @ts-check

(() => {
  "use strict";

  if (window !== window.top) {
    return;
  }

  const API_NAME = "BacktrackNavigationState";
  const LOG_PREFIX = "[Backtrack:Navigation]";
  const MESSAGE_TYPES = Object.freeze({
    NAVIGATION_SNAPSHOT: "BACKTRACK_NAVIGATION_SNAPSHOT",
    GET_BACK_DECISION: "BACKTRACK_GET_BACK_DECISION",
  });

  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const snapshotApi = globalThis.BacktrackNavigationSnapshot;
  if (!snapshotApi) {
    console.info(LOG_PREFIX, {
      kind: "initialization-error",
      reason: "SNAPSHOT_API_UNAVAILABLE",
    });
    return;
  }

  let lastSnapshot = null;
  let sequence = 0;

  function capture(trigger, navigationType = null) {
    lastSnapshot = snapshotApi.readSnapshot({
      navigationObject: globalThis.navigation,
      historyLength: globalThis.history?.length,
      readyState: document.readyState,
      trigger,
      navigationType,
    });
    return lastSnapshot;
  }

  function sendMessage(message) {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") {
        result.catch(() => undefined);
      }
      return result;
    } catch {
      return null;
    }
  }

  function publish(trigger, navigationType = null) {
    const snapshot = capture(trigger, navigationType);
    const diagnostic = snapshotApi.diagnosticView(snapshot);
    console.debug(LOG_PREFIX, {
      kind: "navigation-snapshot",
      sequence: ++sequence,
      snapshot: diagnostic,
    });
    sendMessage({
      type: MESSAGE_TYPES.NAVIGATION_SNAPSHOT,
      snapshot,
    });
    return diagnostic;
  }

  async function requestBackDecision(trigger = "manual") {
    const snapshot = capture(trigger);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_BACK_DECISION,
      snapshot,
    });
    console.info(LOG_PREFIX, {
      kind: "back-decision",
      sequence: ++sequence,
      localSnapshot: snapshotApi.diagnosticView(snapshot),
      response,
    });
    return response;
  }

  const api = Object.freeze({
    version: "0.1.0",
    getSnapshot: () => structuredClone(lastSnapshot ?? capture("manual-snapshot")),
    getDiagnosticSnapshot: () =>
      snapshotApi.diagnosticView(lastSnapshot ?? capture("manual-diagnostic")),
    publish,
    requestBackDecision,
  });

  Object.defineProperty(globalThis, API_NAME, {
    value: api,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  globalThis.navigation?.addEventListener(
    "currententrychange",
    (event) => publish("currententrychange", event.navigationType),
    { capture: true },
  );
  globalThis.navigation?.addEventListener(
    "navigatesuccess",
    () => publish("navigatesuccess"),
    { capture: true },
  );
  window.addEventListener("pageshow", () => publish("pageshow"), {
    capture: true,
  });

  publish("document-start");
})();
