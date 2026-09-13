const DEFAULT_ATTEMPT_TTL_MS = 10_000;

function usableId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function usableKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function comparableHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Correlate one extension-requested Back with the browser's next commit.
 *
 * Full URLs are compared only inside this short-lived in-memory object. They
 * are never written to storage or diagnostics. Losing the service worker also
 * loses the attempt, which deliberately produces a safe false negative.
 */
export class BackNavigationLoopGuard {
  constructor(now = Date.now, attemptTtlMs = DEFAULT_ATTEMPT_TTL_MS) {
    if (typeof now !== "function") {
      throw new TypeError("BackNavigationLoopGuard requires a clock function.");
    }
    if (!Number.isFinite(attemptTtlMs) || attemptTtlMs < 1) {
      throw new TypeError("BackNavigationLoopGuard requires a positive TTL.");
    }
    this.now = now;
    this.attemptTtlMs = attemptTtlMs;
    this.attempts = new Map();
  }

  recordAttempt({ tabId, documentId, entryKey, url }) {
    const safeTabId = usableId(tabId);
    const safeDocumentId = usableKey(documentId);
    const safeEntryKey = usableKey(entryKey);
    const safeUrl = comparableHttpUrl(url);
    if (
      safeTabId === null ||
      safeDocumentId === null ||
      safeEntryKey === null ||
      safeUrl === null
    ) {
      return false;
    }
    const attempt = {
      documentId: safeDocumentId,
      entryKey: safeEntryKey,
      url: safeUrl,
      recordedAtMs: this.now(),
    };
    this.attempts.set(safeTabId, attempt);
    const expiryTimer = setTimeout(() => {
      if (this.attempts.get(safeTabId) === attempt) {
        this.attempts.delete(safeTabId);
      }
    }, this.attemptTtlMs);
    // Do not keep a Node test process alive; browser timers return a number.
    expiryTimer?.unref?.();
    return true;
  }

  consumeCommit(details) {
    const tabId = usableId(details?.tabId);
    if (
      tabId === null ||
      details?.frameId !== 0 ||
      details?.documentLifecycle !== "active"
    ) {
      return { detected: false, reason: "INELIGIBLE_COMMIT" };
    }

    const attempt = this.attempts.get(tabId);
    if (!attempt) {
      return { detected: false, reason: "NO_PENDING_ATTEMPT" };
    }
    this.attempts.delete(tabId);

    if (this.now() - attempt.recordedAtMs > this.attemptTtlMs) {
      return { detected: false, reason: "ATTEMPT_EXPIRED" };
    }

    const qualifiers = Array.isArray(details.transitionQualifiers)
      ? details.transitionQualifiers
      : [];
    const redirectedHistoryTraversal =
      qualifiers.includes("forward_back") &&
      (qualifiers.includes("server_redirect") ||
        qualifiers.includes("client_redirect"));
    if (!redirectedHistoryTraversal) {
      return { detected: false, reason: "NOT_REDIRECTED_HISTORY" };
    }

    const destinationUrl = comparableHttpUrl(details.url);
    if (destinationUrl === null || destinationUrl !== attempt.url) {
      return { detected: false, reason: "DIFFERENT_DESTINATION" };
    }

    return {
      detected: true,
      reason: "RETURNED_TO_SAME_URL_AFTER_REDIRECTED_BACK",
      attemptedEntryKey: attempt.entryKey,
      attemptedDocumentId: attempt.documentId,
    };
  }

  remove(tabId) {
    const safeTabId = usableId(tabId);
    if (safeTabId !== null) {
      this.attempts.delete(safeTabId);
    }
  }
}
