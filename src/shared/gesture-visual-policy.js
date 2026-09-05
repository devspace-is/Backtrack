// @ts-check

(() => {
  "use strict";

  const API_NAME = "BacktrackGestureVisualPolicy";
  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const classifier = globalThis.BacktrackGestureClassifier;
  if (!classifier) {
    return;
  }

  const DEFAULT_POLICY = Object.freeze({
    minHorizontalDistancePx: 80,
    minHorizontalDominanceRatio: 3,
    minDirectionConsistency: 0.85,
    minEventCount: 4,
    minPeakHorizontalDeltaPx: 6,
    committedDistancePx: 720,
  });

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

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
    const distance = classification.measurements.netHorizontalDistancePx;

    return {
      eligible: classification.automaticAction.eligible,
      progress: clamp(distance / policy.committedDistancePx, 0, 1),
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
