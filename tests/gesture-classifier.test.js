import assert from "node:assert/strict";
import test from "node:test";

await import("../src/shared/gesture-classifier.js");

const classifier = globalThis.BacktrackGestureClassifier;

function session(overrides = {}) {
  return {
    netX: -1200,
    absoluteX: 1200,
    absoluteY: 30,
    eventCount: 60,
    maxAbsoluteX: 70,
    nonPixelDeltaModeEventCount: 0,
    modifierEventCount: 0,
    untrustedEventCount: 0,
    downstreamPreventedCount: 0,
    horizontalScrollerEventCount: 0,
    horizontalScrollerConsumableEventCount: 0,
    horizontalScrollerBoundaryEventCount: 0,
    horizontalScrollerUnknownEventCount: 0,
    innerScrollerBoundaryEventCount: 0,
    ...overrides,
  };
}

function evaluate(overrides = {}, options = {}) {
  return classifier.evaluate(session(overrides), {
    backDirection: classifier.DIRECTIONS.NEGATIVE_X,
    automaticActionsEnabled: true,
    ...options,
  });
}

test("a strong calibrated back sequence is action eligible", () => {
  const result = evaluate();

  assert.equal(result.classification, "HORIZONTAL_NEGATIVE_X");
  assert.equal(
    result.semanticNavigationDirection,
    classifier.SEMANTIC_DIRECTIONS.BACK_GESTURE,
  );
  assert.equal(result.automaticAction.eligible, true);
});

test("direction calibration maps the opposite sign to forward", () => {
  const result = evaluate({ netX: 1200 });

  assert.equal(
    result.semanticNavigationDirection,
    classifier.SEMANTIC_DIRECTIONS.FORWARD_GESTURE,
  );
  assert.equal(result.automaticAction.eligible, false);
  assert.ok(result.automaticAction.blockers.includes("NOT_BACK_GESTURE"));
});

test("the same physical sign can be calibrated as back", () => {
  const result = evaluate(
    { netX: 1200 },
    { backDirection: classifier.DIRECTIONS.POSITIVE_X },
  );

  assert.equal(
    result.semanticNavigationDirection,
    classifier.SEMANTIC_DIRECTIONS.BACK_GESTURE,
  );
  assert.equal(result.automaticAction.eligible, true);
});

test("uncalibrated and disabled states cannot perform actions", async (t) => {
  await t.test("uncalibrated", () => {
    const result = evaluate({}, { backDirection: null });
    assert.equal(
      result.semanticNavigationDirection,
      classifier.SEMANTIC_DIRECTIONS.UNCALIBRATED,
    );
    assert.ok(
      result.automaticAction.blockers.includes("BACK_DIRECTION_UNCALIBRATED"),
    );
  });

  await t.test("disabled", () => {
    const result = evaluate({}, { automaticActionsEnabled: false });
    assert.ok(
      result.automaticAction.blockers.includes("AUTOMATIC_ACTIONS_DISABLED"),
    );
  });
});

test("vertical, short, inconsistent, and tiny sequences are rejected", async (t) => {
  await t.test("vertical dominant", () => {
    const result = evaluate({ netX: 20, absoluteX: 25, absoluteY: 900 });
    assert.ok(result.blockers.includes("INSUFFICIENT_HORIZONTAL_DOMINANCE"));
  });

  await t.test("short distance", () => {
    const result = evaluate({ netX: -100, absoluteX: 100 });
    assert.ok(result.blockers.includes("BELOW_MIN_HORIZONTAL_DISTANCE"));
  });

  await t.test("direction reversal", () => {
    const result = evaluate({ netX: -300, absoluteX: 1000 });
    assert.ok(result.blockers.includes("INCONSISTENT_HORIZONTAL_DIRECTION"));
  });

  await t.test("too few events", () => {
    const result = evaluate({ eventCount: 3 });
    assert.ok(result.blockers.includes("TOO_FEW_EVENTS"));
  });

  await t.test("tiny peak", () => {
    const result = evaluate({ maxAbsoluteX: 3 });
    assert.ok(result.blockers.includes("PEAK_HORIZONTAL_DELTA_TOO_SMALL"));
  });
});

test("mouse-like, synthetic, modified, and page-owned input is rejected", async (t) => {
  await t.test("non-pixel delta", () => {
    const result = evaluate({ nonPixelDeltaModeEventCount: 1 });
    assert.ok(result.blockers.includes("NON_PIXEL_DELTA_MODE"));
  });

  await t.test("modifier", () => {
    const result = evaluate({ modifierEventCount: 1 });
    assert.ok(result.blockers.includes("MODIFIER_KEY_PRESENT"));
  });

  await t.test("synthetic event", () => {
    const result = evaluate({ untrustedEventCount: 1 });
    assert.ok(result.blockers.includes("UNTRUSTED_EVENT"));
  });

  await t.test("page canceled", () => {
    const result = evaluate({ downstreamPreventedCount: 1 });
    assert.ok(result.blockers.includes("PAGE_PREVENTED_DEFAULT"));
  });
});

test("horizontal scroll state is evaluated conservatively", async (t) => {
  await t.test("scroller can consume", () => {
    const result = evaluate({
      horizontalScrollerEventCount: 20,
      horizontalScrollerConsumableEventCount: 20,
    });
    assert.ok(result.blockers.includes("HORIZONTAL_SCROLL_CAN_CONSUME"));
  });

  await t.test("RTL or unknown direction", () => {
    const result = evaluate({
      horizontalScrollerEventCount: 20,
      horizontalScrollerUnknownEventCount: 20,
    });
    assert.ok(
      result.blockers.includes("HORIZONTAL_SCROLL_DIRECTION_UNKNOWN"),
    );
  });

  await t.test("inner scroller at its edge", () => {
    const result = evaluate({
      horizontalScrollerEventCount: 20,
      horizontalScrollerBoundaryEventCount: 20,
      innerScrollerBoundaryEventCount: 20,
    });
    assert.ok(result.blockers.includes("INNER_HORIZONTAL_SCROLL_EDGE_GUARD"));
  });

  await t.test("viewport at its boundary", () => {
    const result = evaluate({
      horizontalScrollerEventCount: 20,
      horizontalScrollerBoundaryEventCount: 20,
    });
    assert.equal(result.automaticAction.eligible, true);
  });
});
