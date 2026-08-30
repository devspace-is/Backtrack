// @ts-check

(() => {
  "use strict";

  const API_NAME = "BacktrackNavigationSnapshot";
  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const NAVIGATION_TYPES = new Set(["push", "replace", "reload", "traverse"]);

  function navigationTypeOf(value) {
    return NAVIGATION_TYPES.has(value) ? value : null;
  }

  function readSnapshot({
    navigationObject,
    historyLength,
    readyState,
    trigger,
    navigationType = null,
  }) {
    if (!navigationObject || typeof navigationObject !== "object") {
      return {
        schemaVersion: 1,
        apiAvailable: false,
        currentEntryKey: null,
        navigationType: null,
        sameOriginCanGoBack: null,
        sameOriginCanGoForward: null,
        sameOriginEntryCount: null,
        historyLength: Number.isInteger(historyLength) ? historyLength : null,
        transitionActive: false,
        readyState: typeof readyState === "string" ? readyState : null,
        trigger,
      };
    }

    try {
      const currentEntry = navigationObject.currentEntry;
      const entries =
        typeof navigationObject.entries === "function"
          ? navigationObject.entries()
          : [];
      return {
        schemaVersion: 1,
        apiAvailable: true,
        currentEntryKey:
          typeof currentEntry?.key === "string" ? currentEntry.key : null,
        navigationType: navigationTypeOf(
          navigationType ?? navigationObject.activation?.navigationType,
        ),
        sameOriginCanGoBack:
          typeof navigationObject.canGoBack === "boolean"
            ? navigationObject.canGoBack
            : null,
        sameOriginCanGoForward:
          typeof navigationObject.canGoForward === "boolean"
            ? navigationObject.canGoForward
            : null,
        sameOriginEntryCount: Array.isArray(entries) ? entries.length : null,
        historyLength: Number.isInteger(historyLength) ? historyLength : null,
        transitionActive: navigationObject.transition != null,
        readyState: typeof readyState === "string" ? readyState : null,
        trigger,
      };
    } catch {
      return {
        schemaVersion: 1,
        apiAvailable: false,
        currentEntryKey: null,
        navigationType: null,
        sameOriginCanGoBack: null,
        sameOriginCanGoForward: null,
        sameOriginEntryCount: null,
        historyLength: Number.isInteger(historyLength) ? historyLength : null,
        transitionActive: false,
        readyState: typeof readyState === "string" ? readyState : null,
        trigger,
      };
    }
  }

  function diagnosticView(snapshot) {
    return {
      schemaVersion: snapshot?.schemaVersion ?? 1,
      apiAvailable: snapshot?.apiAvailable === true,
      hasCurrentEntryKey:
        typeof snapshot?.currentEntryKey === "string" &&
        snapshot.currentEntryKey.length > 0,
      navigationType: navigationTypeOf(snapshot?.navigationType),
      sameOriginCanGoBack:
        typeof snapshot?.sameOriginCanGoBack === "boolean"
          ? snapshot.sameOriginCanGoBack
          : null,
      sameOriginCanGoForward:
        typeof snapshot?.sameOriginCanGoForward === "boolean"
          ? snapshot.sameOriginCanGoForward
          : null,
      sameOriginEntryCount:
        Number.isInteger(snapshot?.sameOriginEntryCount)
          ? snapshot.sameOriginEntryCount
          : null,
      historyLength:
        Number.isInteger(snapshot?.historyLength) ? snapshot.historyLength : null,
      historyLengthPolicy: "DIAGNOSTIC_ONLY_NOT_A_DECISION_SIGNAL",
      transitionActive: snapshot?.transitionActive === true,
      readyState:
        typeof snapshot?.readyState === "string" ? snapshot.readyState : null,
      trigger: typeof snapshot?.trigger === "string" ? snapshot.trigger : null,
    };
  }

  Object.defineProperty(globalThis, API_NAME, {
    value: Object.freeze({ readSnapshot, diagnosticView }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
