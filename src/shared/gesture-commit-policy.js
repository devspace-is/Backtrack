// @ts-check

(() => {
  "use strict";

  const API_NAME = "BacktrackGestureCommitPolicy";
  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const classifier = globalThis.BacktrackGestureClassifier;
  if (!classifier) {
    return;
  }

  const DEFAULT_POLICY = Object.freeze({
    confirmationMs: 90,
    minHorizontalDistancePx: 720,
    minHorizontalDominanceRatio: 5,
    minDirectionConsistency: 0.95,
    minEventCount: 12,
    minPeakHorizontalDeltaPx: 12,
  });

  function evaluate(session, options = {}) {
    const policy = {
      ...DEFAULT_POLICY,
      ...(options.policy ?? {}),
    };
    const classification = classifier.evaluate(session, {
      thresholds: policy,
      backDirection: options.backDirection,
      automaticActionsEnabled: options.automaticActionsEnabled,
    });

    return {
      eligible: classification.automaticAction.eligible,
      confirmationMs: policy.confirmationMs,
      classification,
      policy,
    };
  }

  Object.defineProperty(globalThis, API_NAME, {
    value: Object.freeze({
      DEFAULT_POLICY,
      evaluate,
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
