import assert from "node:assert/strict";
import test from "node:test";

await import("../src/shared/gesture-classifier.js");
await import("../src/shared/gesture-visual-policy.js");

const classifier = globalThis.BacktrackGestureClassifier;
const visualPolicy = globalThis.BacktrackGestureVisualPolicy;

function session(overrides = {}) {
  return {
    netX: -180,
    absoluteX: 185,
    absoluteY: 20,
    eventCount: 7,
    maxAbsoluteX: 28,
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
  return visualPolicy.evaluate(session(overrides), {
    backDirection: classifier.DIRECTIONS.NEGATIVE_X,
    automaticActionsEnabled: true,
    ...options,
  });
}

test("a clear back movement can show feedback before the action threshold", () => {
  const result = evaluate();

  assert.equal(result.eligible, true);
  assert.equal(result.progress, 0.25);
  assert.equal(
    result.classification.semanticNavigationDirection,
    classifier.SEMANTIC_DIRECTIONS.BACK_GESTURE,
  );
  assert.ok(
    result.classification.measurements.netHorizontalDistancePx < 720,
  );
});

test("visual progress is clamped to the range from zero to one", async (t) => {
  await t.test("below the commit distance", () => {
    assert.equal(evaluate({ netX: -360, absoluteX: 360 }).progress, 0.5);
  });

  await t.test("above the commit distance", () => {
    assert.equal(evaluate({ netX: -1000, absoluteX: 1000 }).progress, 1);
  });
});

test("unsafe or non-back input never receives a visual promise", async (t) => {
  const cases = [
    ["vertical", { netX: -90, absoluteX: 100, absoluteY: 90 }],
    ["forward", { netX: 180 }],
    ["modifier", { modifierEventCount: 1 }],
    ["synthetic", { untrustedEventCount: 1 }],
    ["page cancellation", { downstreamPreventedCount: 1 }],
    [
      "consumable horizontal scroller",
      {
        horizontalScrollerEventCount: 7,
        horizontalScrollerConsumableEventCount: 7,
      },
    ],
    [
      "inner horizontal scroller edge",
      {
        horizontalScrollerEventCount: 7,
        horizontalScrollerBoundaryEventCount: 7,
        innerScrollerBoundaryEventCount: 7,
      },
    ],
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, () => {
      assert.equal(evaluate(overrides).eligible, false);
    });
  }
});

test("feedback requires calibration and enabled automatic behavior", async (t) => {
  await t.test("uncalibrated", () => {
    assert.equal(evaluate({}, { backDirection: null }).eligible, false);
  });

  await t.test("disabled", () => {
    assert.equal(
      evaluate({}, { automaticActionsEnabled: false }).eligible,
      false,
    );
  });
});
