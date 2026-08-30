// @ts-check

(() => {
  "use strict";

  const API_NAME = "BacktrackGestureClassifier";
  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const DIRECTIONS = Object.freeze({
    POSITIVE_X: "POSITIVE_X",
    NEGATIVE_X: "NEGATIVE_X",
    NONE: "NONE",
  });

  const SEMANTIC_DIRECTIONS = Object.freeze({
    BACK_GESTURE: "BACK_GESTURE",
    FORWARD_GESTURE: "FORWARD_GESTURE",
    UNCALIBRATED: "UNCALIBRATED",
    NO_GESTURE: "NO_GESTURE",
  });

  const DEFAULT_THRESHOLDS = Object.freeze({
    minHorizontalDistancePx: 240,
    minHorizontalDominanceRatio: 4,
    minDirectionConsistency: 0.9,
    minEventCount: 8,
    minPeakHorizontalDeltaPx: 8,
  });

  function finiteNonNegative(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function directionFor(value) {
    if (value > 0) {
      return DIRECTIONS.POSITIVE_X;
    }
    if (value < 0) {
      return DIRECTIONS.NEGATIVE_X;
    }
    return DIRECTIONS.NONE;
  }

  function semanticDirectionFor(direction, backDirection) {
    if (direction === DIRECTIONS.NONE) {
      return SEMANTIC_DIRECTIONS.NO_GESTURE;
    }
    if (
      backDirection !== DIRECTIONS.POSITIVE_X &&
      backDirection !== DIRECTIONS.NEGATIVE_X
    ) {
      return SEMANTIC_DIRECTIONS.UNCALIBRATED;
    }
    return direction === backDirection
      ? SEMANTIC_DIRECTIONS.BACK_GESTURE
      : SEMANTIC_DIRECTIONS.FORWARD_GESTURE;
  }

  function evaluate(session, options = {}) {
    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(options.thresholds ?? {}),
    };
    const netX = Number.isFinite(session?.netX) ? session.netX : 0;
    const absoluteX = finiteNonNegative(session?.absoluteX);
    const absoluteY = finiteNonNegative(session?.absoluteY);
    const netHorizontalDistancePx = Math.abs(netX);
    const horizontalDominanceRatio =
      absoluteY === 0 ? null : absoluteX / absoluteY;
    const directionConsistency =
      absoluteX === 0 ? 0 : netHorizontalDistancePx / absoluteX;
    const direction = directionFor(netX);
    const blockers = [];

    if (netHorizontalDistancePx < thresholds.minHorizontalDistancePx) {
      blockers.push("BELOW_MIN_HORIZONTAL_DISTANCE");
    }
    if (absoluteX < absoluteY * thresholds.minHorizontalDominanceRatio) {
      blockers.push("INSUFFICIENT_HORIZONTAL_DOMINANCE");
    }
    if (directionConsistency < thresholds.minDirectionConsistency) {
      blockers.push("INCONSISTENT_HORIZONTAL_DIRECTION");
    }
    if (finiteNonNegative(session?.eventCount) < thresholds.minEventCount) {
      blockers.push("TOO_FEW_EVENTS");
    }
    if (
      finiteNonNegative(session?.maxAbsoluteX) <
      thresholds.minPeakHorizontalDeltaPx
    ) {
      blockers.push("PEAK_HORIZONTAL_DELTA_TOO_SMALL");
    }
    if (finiteNonNegative(session?.nonPixelDeltaModeEventCount) > 0) {
      blockers.push("NON_PIXEL_DELTA_MODE");
    }
    if (finiteNonNegative(session?.modifierEventCount) > 0) {
      blockers.push("MODIFIER_KEY_PRESENT");
    }
    if (finiteNonNegative(session?.untrustedEventCount) > 0) {
      blockers.push("UNTRUSTED_EVENT");
    }
    if (finiteNonNegative(session?.downstreamPreventedCount) > 0) {
      blockers.push("PAGE_PREVENTED_DEFAULT");
    }

    const scrollEventCount = finiteNonNegative(
      session?.horizontalScrollerEventCount,
    );
    const knownScrollStateCount =
      finiteNonNegative(session?.horizontalScrollerConsumableEventCount) +
      finiteNonNegative(session?.horizontalScrollerBoundaryEventCount) +
      finiteNonNegative(session?.horizontalScrollerUnknownEventCount);
    if (
      finiteNonNegative(session?.horizontalScrollerConsumableEventCount) > 0
    ) {
      blockers.push("HORIZONTAL_SCROLL_CAN_CONSUME");
    }
    if (finiteNonNegative(session?.horizontalScrollerUnknownEventCount) > 0) {
      blockers.push("HORIZONTAL_SCROLL_DIRECTION_UNKNOWN");
    }
    if (finiteNonNegative(session?.innerScrollerBoundaryEventCount) > 0) {
      blockers.push("INNER_HORIZONTAL_SCROLL_EDGE_GUARD");
    }
    if (scrollEventCount > knownScrollStateCount) {
      blockers.push("HORIZONTAL_SCROLL_STATE_INCOMPLETE");
    }

    const classification =
      blockers.length === 0 ? `HORIZONTAL_${direction}` : "NO_CANDIDATE";
    const semanticNavigationDirection =
      blockers.length === 0
        ? semanticDirectionFor(direction, options.backDirection)
        : SEMANTIC_DIRECTIONS.NO_GESTURE;
    const automaticActionBlockers = [...blockers];
    if (
      blockers.length === 0 &&
      semanticNavigationDirection === SEMANTIC_DIRECTIONS.UNCALIBRATED
    ) {
      automaticActionBlockers.push("BACK_DIRECTION_UNCALIBRATED");
    } else if (
      blockers.length === 0 &&
      semanticNavigationDirection !== SEMANTIC_DIRECTIONS.BACK_GESTURE
    ) {
      automaticActionBlockers.push("NOT_BACK_GESTURE");
    }
    if (options.automaticActionsEnabled !== true) {
      automaticActionBlockers.push("AUTOMATIC_ACTIONS_DISABLED");
    }

    return {
      classification,
      horizontalDirection: direction,
      semanticNavigationDirection,
      blockers,
      automaticAction: {
        eligible: automaticActionBlockers.length === 0,
        blockers: [...new Set(automaticActionBlockers)],
      },
      measurements: {
        netHorizontalDistancePx,
        horizontalDominanceRatio,
        directionConsistency,
        eventCount: finiteNonNegative(session?.eventCount),
        peakHorizontalDeltaPx: finiteNonNegative(session?.maxAbsoluteX),
      },
    };
  }

  Object.defineProperty(globalThis, API_NAME, {
    value: Object.freeze({
      DIRECTIONS,
      SEMANTIC_DIRECTIONS,
      DEFAULT_THRESHOLDS,
      directionFor,
      semanticDirectionFor,
      evaluate,
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();
