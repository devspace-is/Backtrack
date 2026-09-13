import assert from "node:assert/strict";
import test from "node:test";
import { reviewDiagnosticLog } from "../src/background/diagnostic-review.js";

const action = (time, extra = {}) => ({
  kind: "BACK_ACTION", recordedAtMs: time, tabId: 20, documentId: "document-a",
  source: "AUTOMATIC", action: "USE_INTERNAL_HISTORY", navigation: { entryKey: "a" }, ...extra,
});

test("a browser-confirmed redirected-Back loop is visible in the later review", () => {
  const report = reviewDiagnosticLog([{
    kind: "NAVIGATION_COMMIT",
    event: "BACK_REDIRECT_LOOP_DETECTED",
    recordedAtMs: 2_000,
    tabId: 20,
    origin: "https://github.com",
  }], 3_000);
  assert.deepEqual(report.hints, [{
    code: "REDIRECTED_BACK_LOOP_OBSERVED",
    recordedAtMs: 2_000,
    tabId: 20,
    origin: "https://github.com",
    reason: undefined,
  }]);
});

test("repeated back on the same entry is a hint, not a proven failure", () => {
  const report = reviewDiagnosticLog([action(1000), action(6000)], 15000);
  assert.equal(report.hints[0].code, "REPEATED_BACK_WITHOUT_OBSERVED_PROGRESS");
  assert.match(report.notice, /not confirmed bugs/);
});

for (const event of [
  { kind: "NAVIGATION_COMMIT" },
  { kind: "NAVIGATION_STATE", navigation: { entryKey: "b" } },
  { kind: "TAB_EVENT", event: "REMOVED" },
  { kind: "TAB_EVENT", event: "REPLACED" },
]) {
  test(`observed ${event.kind}/${event.event ?? "change"} prevents a no-progress claim`, () => {
    const report = reviewDiagnosticLog([
      action(1000), { ...event, tabId: 20, recordedAtMs: 2000 }, action(6000),
    ], 15000);
    assert.deepEqual(report.hints, []);
  });
}

test("isolated actions, momentum rejections and stale reused tab IDs do not prove a failure", () => {
  assert.deepEqual(reviewDiagnosticLog([action(1000)], 15000).hints, []);
  assert.deepEqual(reviewDiagnosticLog([
    action(1000), action(6000, { action: "NO_SPECIAL_ACTION", reason: "GESTURE_DEDUPLICATED" }),
    action(7000, { documentId: "different-browser-document" }),
  ], 15000).hints, []);
});

test("slow responses and missing closure evidence are separately identifiable", () => {
  const report = reviewDiagnosticLog([action(1000, { durationMs: 700, decisionReason: "NOT_TRACKED" })], 15000);
  assert.deepEqual(report.hints.map(hint => hint.code), ["CLOSURE_EVIDENCE_MISSING", "SLOW_ACTION_RESPONSE"]);
});
