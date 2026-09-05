import assert from "node:assert/strict";
import test from "node:test";

await import("../src/shared/gesture-classifier.js");
await import("../src/shared/gesture-commit-policy.js");

const classifier = globalThis.BacktrackGestureClassifier;
const commitPolicy = globalThis.BacktrackGestureCommitPolicy;

function session(overrides = {}) {
  return {
    netX: -900,
    absoluteX: 900,
    absoluteY: 30,
    eventCount: 20,
    maxAbsoluteX: 60,
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

function evaluate(overrides = {}) {
  return commitPolicy.evaluate(session(overrides), {
    backDirection: classifier.DIRECTIONS.NEGATIVE_X,
    automaticActionsEnabled: true,
  });
}

test("a strong in-progress back gesture can commit before its momentum tail ends", () => {
  const result = evaluate();

  assert.equal(result.eligible, true);
  assert.equal(result.confirmationMs, 90);
  assert.equal(
    result.classification.semanticNavigationDirection,
    classifier.SEMANTIC_DIRECTIONS.BACK_GESTURE,
  );
});

test("the early commit requires stronger evidence than final classification", () => {
  const partial = session({
    netX: -400,
    absoluteX: 400,
    eventCount: 10,
    maxAbsoluteX: 10,
  });
  const finalClassification = classifier.evaluate(partial, {
    backDirection: classifier.DIRECTIONS.NEGATIVE_X,
    automaticActionsEnabled: true,
  });
  const earlyClassification = commitPolicy.evaluate(partial, {
    backDirection: classifier.DIRECTIONS.NEGATIVE_X,
    automaticActionsEnabled: true,
  });

  assert.equal(finalClassification.automaticAction.eligible, true);
  assert.equal(earlyClassification.eligible, false);
  assert.deepEqual(
    earlyClassification.classification.automaticAction.blockers.sort(),
    [
      "BELOW_MIN_HORIZONTAL_DISTANCE",
      "PEAK_HORIZONTAL_DELTA_TOO_SMALL",
      "TOO_FEW_EVENTS",
    ],
  );
});

test("page-owned horizontal input can never use the fast path", async (t) => {
  await t.test("consumable scroller", () => {
    const result = evaluate({
      horizontalScrollerEventCount: 20,
      horizontalScrollerConsumableEventCount: 20,
    });
    assert.equal(result.eligible, false);
    assert.ok(
      result.classification.blockers.includes("HORIZONTAL_SCROLL_CAN_CONSUME"),
    );
  });

  await t.test("inner scroller boundary", () => {
    const result = evaluate({
      horizontalScrollerEventCount: 20,
      horizontalScrollerBoundaryEventCount: 20,
      innerScrollerBoundaryEventCount: 20,
    });
    assert.equal(result.eligible, false);
    assert.ok(
      result.classification.blockers.includes(
        "INNER_HORIZONTAL_SCROLL_EDGE_GUARD",
      ),
    );
  });

  await t.test("page cancellation", () => {
    const result = evaluate({ downstreamPreventedCount: 1 });
    assert.equal(result.eligible, false);
    assert.ok(
      result.classification.blockers.includes("PAGE_PREVENTED_DEFAULT"),
    );
  });
});

test("forward, uncalibrated, and disabled gestures cannot commit", async (t) => {
  await t.test("forward", () => {
    const result = evaluate({ netX: 900 });
    assert.equal(result.eligible, false);
    assert.ok(
      result.classification.automaticAction.blockers.includes(
        "NOT_BACK_GESTURE",
      ),
    );
  });

  await t.test("uncalibrated", () => {
    const result = commitPolicy.evaluate(session(), {
      backDirection: null,
      automaticActionsEnabled: true,
    });
    assert.equal(result.eligible, false);
  });

  await t.test("disabled", () => {
    const result = commitPolicy.evaluate(session(), {
      backDirection: classifier.DIRECTIONS.NEGATIVE_X,
      automaticActionsEnabled: false,
    });
    assert.equal(result.eligible, false);
  });
});
