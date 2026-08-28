// @ts-check

(() => {
  "use strict";

  const API_NAME = "BacktrackGestureDebug";

  if (Object.prototype.hasOwnProperty.call(globalThis, API_NAME)) {
    return;
  }

  const VERSION = "0.1.0";
  const LOG_PREFIX = "[Backtrack:Gesture]";
  const SESSION_SUMMARY_PREFIX = "[Backtrack:Gesture:SessionJSON]";
  const BUFFER_LIMIT = 2500;
  const DELTA_MODE_NAMES = Object.freeze({
    0: "PIXEL",
    1: "LINE",
    2: "PAGE",
  });
  const PREVENT_DEFAULT_MODES = new Set(["off", "horizontal", "all"]);
  const ROOT_OVERSCROLL_MODES = new Set(["unchanged", "contain", "none"]);

  const DEFAULT_CONFIG = Object.freeze({
    sessionGapMs: 160,
    settleMs: 220,
    minHorizontalDistancePx: 80,
    minHorizontalDominanceRatio: 2.5,
    minDirectionConsistency: 0.8,
    preventDefaultMode: "off",
    preventDefaultEventDominanceRatio: 1.25,
    logEveryWheelEvent: true,
  });

  /** @type {typeof DEFAULT_CONFIG} */
  let config = { ...DEFAULT_CONFIG };
  /** @type {Array<Record<string, unknown>>} */
  const logBuffer = [];
  /** @type {ReturnType<typeof createSession> | null} */
  let activeSession = null;
  /** @type {number | null} */
  let settleTimer = null;
  let logSequence = 0;
  let sessionSequence = 0;
  let listening = false;
  let requestedRootOverscrollMode = "unchanged";
  /** @type {{ value: string, priority: string } | null} */
  let rootOverscrollBackup = null;

  const frameContext = Object.freeze({
    instance: createFrameInstanceId(),
    kind: window === window.top ? "TOP" : "CHILD",
  });

  function createFrameInstanceId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().slice(0, 8);
    }

    return Math.random().toString(36).slice(2, 10);
  }

  function round(value, digits = 2) {
    if (!Number.isFinite(value)) {
      return null;
    }

    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function record(kind, details = {}, level = "debug") {
    const entry = {
      schemaVersion: 1,
      sequence: ++logSequence,
      capturedAtMs: round(performance.now()),
      kind,
      frame: frameContext,
      ...details,
    };

    logBuffer.push(entry);
    if (logBuffer.length > BUFFER_LIMIT) {
      logBuffer.shift();
    }

    const logger = level === "info" ? console.info : console.debug;
    logger(LOG_PREFIX, entry);

    // Keep the detailed object log for interactive inspection, but also emit
    // completed sessions as plain JSON. DevTools shows this line in every
    // JavaScript context, so collecting a result does not depend on selecting
    // the extension's isolated execution context after a navigation.
    if (kind === "session-end") {
      console.info(SESSION_SUMMARY_PREFIX, JSON.stringify(entry));
    }

    return entry;
  }

  function normalizeDeltas(event) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return {
        x: event.deltaX * 16,
        y: event.deltaY * 16,
        z: event.deltaZ * 16,
        approximate: true,
        factorDescription: "16px-per-line research approximation",
      };
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return {
        x: event.deltaX * window.innerWidth,
        y: event.deltaY * window.innerHeight,
        z: event.deltaZ * window.innerHeight,
        approximate: true,
        factorDescription: "viewport-per-page research approximation",
      };
    }

    return {
      x: event.deltaX,
      y: event.deltaY,
      z: event.deltaZ,
      approximate: false,
      factorDescription: "native CSS pixels",
    };
  }

  function describeElement(value) {
    let element = value;
    if (element instanceof Text) {
      element = element.parentElement;
    }

    if (!(element instanceof Element)) {
      return null;
    }

    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      direction: getComputedStyle(element).direction,
    };
  }

  function inspectHorizontalScroller(element, deltaX) {
    if (!(element instanceof Element)) {
      return null;
    }

    const style = getComputedStyle(element);
    const isViewportScroller = element === document.scrollingElement;
    const permitsUserScrolling =
      isViewportScroller || /^(auto|scroll|overlay)$/.test(style.overflowX);
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

    if (!permitsUserScrolling || maxScrollLeft <= 1) {
      return null;
    }

    let canConsumeInDeltaDirection = null;
    if (style.direction === "ltr") {
      canConsumeInDeltaDirection =
        deltaX > 0
          ? element.scrollLeft < maxScrollLeft - 1
          : deltaX < 0
            ? element.scrollLeft > 1
            : false;
    }

    return {
      ...describeElement(element),
      overflowX: style.overflowX,
      scrollLeft: round(element.scrollLeft),
      maxScrollLeft: round(maxScrollLeft),
      canConsumeInDeltaDirection,
      safetyPolicy: "BLOCK_CANDIDATE_WHILE_INSIDE_HORIZONTAL_SCROLLER",
    };
  }

  function findHorizontalScrollContext(event, deltaX) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const visited = new Set();

    for (const item of path) {
      if (!(item instanceof Element) || visited.has(item)) {
        continue;
      }

      visited.add(item);
      const result = inspectHorizontalScroller(item, deltaX);
      if (result) {
        return result;
      }
    }

    const viewportScroller = document.scrollingElement;
    if (viewportScroller && !visited.has(viewportScroller)) {
      return inspectHorizontalScroller(viewportScroller, deltaX);
    }

    return null;
  }

  function readOptionalEventValue(event, propertyName) {
    if (!(propertyName in event)) {
      return null;
    }

    const value = Reflect.get(event, propertyName);
    if (["string", "number", "boolean"].includes(typeof value)) {
      return value;
    }

    return value == null ? null : String(value);
  }

  function createSession(now) {
    return {
      id: `${frameContext.instance}-${++sessionSequence}`,
      startedAtMs: now,
      lastEventAtMs: now,
      eventCount: 0,
      netX: 0,
      netY: 0,
      absoluteX: 0,
      absoluteY: 0,
      maxAbsoluteX: 0,
      maxAbsoluteY: 0,
      positiveX: 0,
      negativeX: 0,
      deltaModes: new Set(),
      cancelableCount: 0,
      nonCancelableCount: 0,
      preventDefaultAttemptCount: 0,
      preventDefaultSuccessCount: 0,
      downstreamPreventedCount: 0,
      horizontalScrollerEventCount: 0,
      horizontalScrollerTags: new Set(),
      modifierEventCount: 0,
      possibleMomentumTailEventCount: 0,
      peakHorizontalDelta: 0,
      peakHorizontalEventIndex: 0,
      thresholdReported: false,
      startPosition: null,
    };
  }

  function directionFor(value) {
    if (value > 0) {
      return "POSITIVE_X";
    }
    if (value < 0) {
      return "NEGATIVE_X";
    }
    return "NONE";
  }

  function candidateEvaluation(session) {
    const netHorizontalDistance = Math.abs(session.netX);
    const horizontalDominance =
      session.absoluteY === 0 ? null : session.absoluteX / session.absoluteY;
    const directionConsistency =
      session.absoluteX === 0 ? 0 : netHorizontalDistance / session.absoluteX;
    const blockers = [];

    if (netHorizontalDistance < config.minHorizontalDistancePx) {
      blockers.push("BELOW_MIN_HORIZONTAL_DISTANCE");
    }
    if (
      session.absoluteX <
      session.absoluteY * config.minHorizontalDominanceRatio
    ) {
      blockers.push("INSUFFICIENT_HORIZONTAL_DOMINANCE");
    }
    if (directionConsistency < config.minDirectionConsistency) {
      blockers.push("INCONSISTENT_HORIZONTAL_DIRECTION");
    }
    if (session.horizontalScrollerEventCount > 0) {
      blockers.push("HORIZONTAL_SCROLL_CONTEXT");
    }
    if (session.modifierEventCount > 0) {
      blockers.push("MODIFIER_KEY_PRESENT");
    }
    if (session.downstreamPreventedCount > 0) {
      blockers.push("PAGE_PREVENTED_DEFAULT");
    }

    return {
      classification:
        blockers.length === 0
          ? `HORIZONTAL_${directionFor(session.netX)}`
          : "NO_CANDIDATE",
      semanticNavigationDirection: "UNCALIBRATED",
      blockers,
      measurements: {
        netHorizontalDistancePx: round(netHorizontalDistance),
        horizontalDominanceRatio: round(horizontalDominance),
        directionConsistency: round(directionConsistency),
      },
    };
  }

  function finishSession(reason = "manual") {
    if (!activeSession) {
      return null;
    }

    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }

    const session = activeSession;
    activeSession = null;
    const evaluation = candidateEvaluation(session);
    const summary = {
      sessionId: session.id,
      reason,
      durationMs: round(session.lastEventAtMs - session.startedAtMs),
      eventCount: session.eventCount,
      deltas: {
        netX: round(session.netX),
        netY: round(session.netY),
        absoluteX: round(session.absoluteX),
        absoluteY: round(session.absoluteY),
        maxAbsoluteX: round(session.maxAbsoluteX),
        maxAbsoluteY: round(session.maxAbsoluteY),
        positiveX: round(session.positiveX),
        negativeX: round(session.negativeX),
        modes: [...session.deltaModes],
      },
      cancellation: {
        cancelableCount: session.cancelableCount,
        nonCancelableCount: session.nonCancelableCount,
        preventDefaultMode: config.preventDefaultMode,
        attemptedCount: session.preventDefaultAttemptCount,
        successfulCount: session.preventDefaultSuccessCount,
        downstreamPreventedCount: session.downstreamPreventedCount,
      },
      context: {
        horizontalScrollerEventCount: session.horizontalScrollerEventCount,
        horizontalScrollerTags: [...session.horizontalScrollerTags],
        modifierEventCount: session.modifierEventCount,
        startPosition: session.startPosition,
      },
      momentum: {
        standardDomPhaseAvailable: false,
        heuristic: "DECAY_TAIL_ONLY",
        possibleTailEventCount: session.possibleMomentumTailEventCount,
      },
      evaluation,
    };

    record("session-end", summary, "info");
    return summary;
  }

  function scheduleSessionFinish() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
    }

    settleTimer = window.setTimeout(() => {
      finishSession("settled");
    }, config.settleMs);
  }

  function shouldPreventDefault(normalized) {
    if (config.preventDefaultMode === "all") {
      return true;
    }

    return (
      config.preventDefaultMode === "horizontal" &&
      Math.abs(normalized.x) > 0 &&
      Math.abs(normalized.x) >=
        Math.abs(normalized.y) * config.preventDefaultEventDominanceRatio
    );
  }

  function handleWheel(event) {
    const now = performance.now();
    const normalized = normalizeDeltas(event);

    if (
      activeSession &&
      now - activeSession.lastEventAtMs > config.sessionGapMs
    ) {
      finishSession("gap-before-next-event");
    }

    if (!activeSession) {
      activeSession = createSession(now);
      record(
        "session-start",
        {
          sessionId: activeSession.id,
          config: { ...config },
        },
        "info",
      );
    }

    const session = activeSession;
    const previousEventAtMs =
      session.eventCount === 0 ? null : session.lastEventAtMs;
    const defaultPreventedBefore = event.defaultPrevented;
    const preventDefaultAttempted = shouldPreventDefault(normalized);
    if (preventDefaultAttempted) {
      session.preventDefaultAttemptCount += 1;
      event.preventDefault();
      if (event.defaultPrevented) {
        session.preventDefaultSuccessCount += 1;
      }
    }

    const horizontalScrollContext = findHorizontalScrollContext(
      event,
      normalized.x,
    );
    const absoluteX = Math.abs(normalized.x);
    const absoluteY = Math.abs(normalized.y);
    const previousPeak = session.peakHorizontalDelta;
    let possibleMomentumTail = false;

    session.eventCount += 1;
    session.lastEventAtMs = now;
    session.netX += normalized.x;
    session.netY += normalized.y;
    session.absoluteX += absoluteX;
    session.absoluteY += absoluteY;
    session.maxAbsoluteX = Math.max(session.maxAbsoluteX, absoluteX);
    session.maxAbsoluteY = Math.max(session.maxAbsoluteY, absoluteY);
    session.positiveX += Math.max(0, normalized.x);
    session.negativeX += Math.min(0, normalized.x);
    session.deltaModes.add(DELTA_MODE_NAMES[event.deltaMode] ?? `UNKNOWN_${event.deltaMode}`);
    session.cancelableCount += event.cancelable ? 1 : 0;
    session.nonCancelableCount += event.cancelable ? 0 : 1;

    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
      session.modifierEventCount += 1;
    }

    if (horizontalScrollContext) {
      session.horizontalScrollerEventCount += 1;
      session.horizontalScrollerTags.add(horizontalScrollContext.tag);
    }

    if (!session.startPosition) {
      session.startPosition = {
        clientX: round(event.clientX),
        clientY: round(event.clientY),
        distanceFromLeftPx: round(event.clientX),
        distanceFromRightPx: round(window.innerWidth - event.clientX),
      };
    }

    if (absoluteX > session.peakHorizontalDelta) {
      session.peakHorizontalDelta = absoluteX;
      session.peakHorizontalEventIndex = session.eventCount;
    } else if (
      session.eventCount >= 5 &&
      previousPeak > 0 &&
      absoluteX <= previousPeak * 0.45 &&
      session.eventCount - session.peakHorizontalEventIndex >= 2 &&
      Math.sign(normalized.x) === Math.sign(session.netX)
    ) {
      session.possibleMomentumTailEventCount += 1;
      possibleMomentumTail = true;
    }

    const nativePhaseFields = {
      phase: readOptionalEventValue(event, "phase"),
      momentumPhase: readOptionalEventValue(event, "momentumPhase"),
      webkitMomentumPhase: readOptionalEventValue(event, "webkitMomentumPhase"),
    };

    const eventDetails = {
      sessionId: session.id,
      eventIndex: session.eventCount,
      sincePreviousEventMs:
        previousEventAtMs === null ? null : round(now - previousEventAtMs),
      raw: {
        deltaX: round(event.deltaX),
        deltaY: round(event.deltaY),
        deltaZ: round(event.deltaZ),
        deltaMode: event.deltaMode,
        deltaModeName: DELTA_MODE_NAMES[event.deltaMode] ?? "UNKNOWN",
      },
      normalized: {
        deltaX: round(normalized.x),
        deltaY: round(normalized.y),
        deltaZ: round(normalized.z),
        approximate: normalized.approximate,
        factorDescription: normalized.factorDescription,
      },
      shape: {
        dominantAxis:
          absoluteX > absoluteY ? "HORIZONTAL" : absoluteY > absoluteX ? "VERTICAL" : "EVEN",
        horizontalDirection: directionFor(normalized.x),
        horizontalToVerticalRatio:
          absoluteY === 0 ? null : round(absoluteX / absoluteY),
      },
      timing: {
        eventTimeStamp: round(event.timeStamp),
        possibleMomentumTail,
        nativePhaseFields,
        phaseNotice:
          "WheelEvent has no standard gesture/momentum phase; values above are probes only.",
      },
      cancellation: {
        cancelable: event.cancelable,
        defaultPreventedBefore,
        preventDefaultMode: config.preventDefaultMode,
        attempted: preventDefaultAttempted,
        defaultPreventedAfterOwnHandler: event.defaultPrevented,
      },
      input: {
        isTrusted: event.isTrusted,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      },
      position: {
        clientX: round(event.clientX),
        clientY: round(event.clientY),
        distanceFromLeftPx: round(event.clientX),
        distanceFromRightPx: round(window.innerWidth - event.clientX),
      },
      target: describeElement(event.target),
      horizontalScrollContext,
      legacyProbe: {
        wheelDelta: readOptionalEventValue(event, "wheelDelta"),
        wheelDeltaX: readOptionalEventValue(event, "wheelDeltaX"),
        wheelDeltaY: readOptionalEventValue(event, "wheelDeltaY"),
        webkitDirectionInvertedFromDevice: readOptionalEventValue(
          event,
          "webkitDirectionInvertedFromDevice",
        ),
      },
    };

    if (config.logEveryWheelEvent) {
      record("wheel", eventDetails);
    }

    const evaluation = candidateEvaluation(session);
    const thresholdOnlyBlockers = evaluation.blockers.filter(
      (blocker) =>
        ![
          "HORIZONTAL_SCROLL_CONTEXT",
          "PAGE_PREVENTED_DEFAULT",
        ].includes(blocker),
    );
    if (!session.thresholdReported && thresholdOnlyBlockers.length === 0) {
      session.thresholdReported = true;
      record(
        "threshold-crossed",
        {
          sessionId: session.id,
          provisionalDirection: directionFor(session.netX),
          semanticNavigationDirection: "UNCALIBRATED",
          notice: "Research signal only. No navigation action is performed.",
          evaluation,
        },
        "info",
      );
    }

    queueMicrotask(() => {
      const preventedBySomethingElse =
        event.defaultPrevented &&
        !defaultPreventedBefore &&
        !preventDefaultAttempted;

      if (preventedBySomethingElse) {
        session.downstreamPreventedCount += 1;
        record("post-dispatch-default-prevented", {
          sessionId: session.id,
          eventIndex: session.eventCount,
          notice: "A later page listener appears to have canceled this event.",
        });
      }
    });

    scheduleSessionFinish();
  }

  function validateConfigPatch(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("configure() expects an object.");
    }

    const next = { ...config };
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_CONFIG)) {
        throw new TypeError(`Unknown configuration key: ${key}`);
      }

      if (key === "preventDefaultMode") {
        if (typeof value !== "string" || !PREVENT_DEFAULT_MODES.has(value)) {
          throw new TypeError(
            'preventDefaultMode must be "off", "horizontal", or "all".',
          );
        }
      } else if (key === "logEveryWheelEvent") {
        if (typeof value !== "boolean") {
          throw new TypeError("logEveryWheelEvent must be a boolean.");
        }
      } else if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${key} must be a positive finite number.`);
      }

      Object.assign(next, { [key]: value });
    }

    return next;
  }

  function configure(patch) {
    finishSession("configuration-change");
    config = validateConfigPatch(patch);
    record("config-change", { config: { ...config } }, "info");
    return { ...config };
  }

  function applyRootOverscrollBehavior(mode) {
    if (!ROOT_OVERSCROLL_MODES.has(mode)) {
      throw new TypeError(
        'Root overscroll mode must be "unchanged", "contain", or "none".',
      );
    }

    requestedRootOverscrollMode = mode;
    const root = document.documentElement;
    if (!root) {
      document.addEventListener(
        "DOMContentLoaded",
        () => applyRootOverscrollBehavior(requestedRootOverscrollMode),
        { once: true },
      );
      return mode;
    }

    if (!rootOverscrollBackup) {
      rootOverscrollBackup = {
        value: root.style.getPropertyValue("overscroll-behavior-x"),
        priority: root.style.getPropertyPriority("overscroll-behavior-x"),
      };
    }

    if (mode === "unchanged") {
      if (rootOverscrollBackup.value) {
        root.style.setProperty(
          "overscroll-behavior-x",
          rootOverscrollBackup.value,
          rootOverscrollBackup.priority,
        );
      } else {
        root.style.removeProperty("overscroll-behavior-x");
      }
      rootOverscrollBackup = null;
    } else {
      root.style.setProperty("overscroll-behavior-x", mode, "important");
    }

    record(
      "root-overscroll-change",
      {
        requestedMode: mode,
        computedMode: getComputedStyle(root).overscrollBehaviorX,
        warning: "Controlled research toggle; restore with mode=unchanged.",
      },
      "info",
    );
    return mode;
  }

  function start() {
    if (listening) {
      return false;
    }

    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    listening = true;
    record(
      "listener-start",
      {
        version: VERSION,
        listener: { target: "window", capture: true, passive: false },
        config: { ...config },
        notice:
          "Directions are intentionally uncalibrated; no tab or history action exists in this PoC.",
      },
      "info",
    );
    return true;
  }

  function stop() {
    if (!listening) {
      return false;
    }

    finishSession("listener-stop");
    window.removeEventListener("wheel", handleWheel, { capture: true });
    listening = false;
    record("listener-stop", {}, "info");
    return true;
  }

  function clearLog() {
    finishSession("log-clear");
    logBuffer.length = 0;
    logSequence = 0;
    console.clear();
    record("log-cleared", {}, "info");
  }

  const api = Object.freeze({
    version: VERSION,
    getConfig: () => ({ ...config }),
    configure,
    getStatus: () => ({
      listening,
      frame: { ...frameContext },
      activeSessionId: activeSession?.id ?? null,
      bufferedEntries: logBuffer.length,
      rootOverscrollMode: requestedRootOverscrollMode,
    }),
    getSnapshot: () => structuredClone(logBuffer),
    exportJson: () => JSON.stringify(logBuffer, null, 2),
    finishSession,
    clearLog,
    setRootOverscrollBehavior: applyRootOverscrollBehavior,
    start,
    stop,
  });

  Object.defineProperty(globalThis, API_NAME, {
    value: api,
    writable: false,
    configurable: false,
    enumerable: false,
  });

  window.addEventListener(
    "pagehide",
    () => {
      finishSession("pagehide");
    },
    { capture: true },
  );

  start();
})();
