// Evidence-based hints for later inspection, never input to navigation decisions.
export function reviewDiagnosticLog(entries, nowMs = Date.now()) {
  const actions = entries.filter(entry => entry.kind === "BACK_ACTION");
  const context = entries.filter(entry => entry.kind !== "BACK_ACTION");
  const hints = [];
  const add = (entry, code) => hints.push({
    code, recordedAtMs: entry.recordedAtMs, tabId: entry.tabId,
    origin: entry.origin, reason: entry.reason ?? entry.decisionReason,
  });
  for (const entry of context) {
    if (
      entry.kind === "NAVIGATION_COMMIT" &&
      entry.event === "BACK_REDIRECT_LOOP_DETECTED"
    ) {
      add(entry, "REDIRECTED_BACK_LOOP_OBSERVED");
    }
  }
  for (const entry of actions) {
    const reason = entry.decisionReason ?? entry.reason;
    if (["INTERNAL_ERROR", "OPENER_ACTIVATION_FAILED", "OPENER_ACTIVATION_UNCONFIRMED",
      "POST_ACTIVATION_VALIDATION_FAILED", "CHILD_CLOSE_FAILED"].includes(entry.reason)) {
      add(entry, "ACTION_ERROR");
    }
    if (["NOT_TRACKED", "AWAITING_ENTRY", "LIVE_ENTRY_MISMATCH",
      "UNEXPECTED_ENTRY_CHANGE", "CONTRADICTORY_BROWSER_SIGNAL",
      "NAVIGATION_API_UNAVAILABLE"].includes(reason)) add(entry, "CLOSURE_EVIDENCE_MISSING");
    if (entry.durationMs > 500) add(entry, "SLOW_ACTION_RESPONSE");

    if (!["USE_INTERNAL_HISTORY", "USE_BROWSER_HISTORY"].includes(entry.action) ||
      entry.source !== "AUTOMATIC" || !entry.navigation?.entryKey ||
      nowMs - entry.recordedAtMs < 5000) continue;
    // A new commit, changed entry, close, replacement, or log gap can explain
    // missing state. Only flag a repeated request from the SAME document/key.
    const following = entries.filter(item => item.tabId === entry.tabId &&
      item.recordedAtMs > entry.recordedAtMs && item.recordedAtMs - entry.recordedAtMs <= 30_000);
    const changed = following.some(item => item.kind === "NAVIGATION_COMMIT" ||
      (item.kind === "TAB_EVENT" && ["REMOVED", "REPLACED"].includes(item.event)) ||
      (item.kind === "NAVIGATION_STATE" && item.navigation?.entryKey &&
        item.navigation.entryKey !== entry.navigation.entryKey));
    const repeated = following.some(item => item.kind === "BACK_ACTION" &&
      ["USE_INTERNAL_HISTORY", "USE_BROWSER_HISTORY"].includes(item.action) &&
      item.documentId && item.documentId === entry.documentId &&
      item.navigation?.entryKey === entry.navigation.entryKey);
    if (!changed && repeated) add(entry, "REPEATED_BACK_WITHOUT_OBSERVED_PROGRESS");
  }
  return {
    actionCount: actions.length, contextCount: entries.length - actions.length,
    oldestAtMs: entries[0]?.recordedAtMs ?? null,
    newestAtMs: entries.at(-1)?.recordedAtMs ?? null,
    oldestActionAtMs: actions[0]?.recordedAtMs ?? null,
    oldestContextAtMs: context[0]?.recordedAtMs ?? null,
    hints,
    notice: "Hints are not confirmed bugs. Missing events, browser-owned input and unreported user intent limit diagnosis.",
  };
}
