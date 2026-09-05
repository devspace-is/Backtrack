# Regression Matrix

Date: **August 30, 2026**

This document records the automated regression suite and the physical
Brave/macOS validation for development version `0.5.0`. It separates real
two-finger evidence from synthetic browser input. Synthetic `WheelEvent`
dispatches are never accepted as proof of physical gesture behavior.

## Environment

| Component | Version or state |
| --- | --- |
| macOS | 26.6.2 (Build 25G83) |
| Brave | 152.1.94.117 (Chromium build 194.117) |
| Extension | Unpacked Backtrack Development 0.5.0 |
| Test origin | `http://127.0.0.1:8765` |
| Back direction | Physical swipe right measured as `NEGATIVE_X` |
| Automatic actions | Enabled only after explicit direction calibration |
| Root containment | `overscroll-behavior-x: contain` while enabled |
| Natural Scrolling setting | Not changed during this run; preference value was not recorded |

## Automated suite

Command:

```sh
npm test
```

Version `0.5.0` result: **85 passed, 0 failed**.

Version `0.5.1` follow-up after the live `NO_OPENER` diagnosis: **97 passed,
0 failed**. The additional cases cover an exact
`onCreatedNavigationTarget` fallback, missing and untrusted relationships,
live-versus-tracked conflicts, different windows, decision eligibility, and
the guarded close path without a live `openerTabId`.

Version `0.5.2` latency follow-up: **108 passed, 0 failed**. The added cases
cover stronger early-commit evidence, rejection of page-owned input on the
fast path, and momentum rejection after a same-window document or tab switch.
The physical latency retest is still pending and must not be inferred from the
automated result.

Version `0.6.0` visual-feedback follow-up: **123 passed, 0 failed**. The added
cases cover early preview eligibility, progress clamping, and rejection of
vertical, forward, modified, synthetic, page-canceled, scroll-owned,
uncalibrated, and disabled input. This proves the pure preview policy, not the
appearance of the rendered overlay.

The real indicator module was also rendered in Brave on the local
`indicator-fixture.html`. Tracking, armed, and hidden states were exercised;
the arrow remained non-interactive, the fixture controls remained clickable,
and the browser console contained no Backtrack or fixture error. The initial
visual run exposed and corrected an overly strict paint-containment rule that
had clipped the overlay. This rendered check validates the overlay itself, not
a new physical trackpad latency measurement.

The suite covers:

- gesture distance, dominance, consistency, event-count, peak, and direction
  mapping;
- visual-only preview thresholds, progress, and fail-closed blockers;
- disabled, uncalibrated, forward, modified, synthetic, non-pixel, and
  page-canceled input;
- consumable, boundary, incomplete, and unknown horizontal scroll ownership;
- tab-and-window gesture ID deduplication, momentum cooldown, cleanup, and
  service-worker suspension-safe session state;
- internal-history precedence, multiple internal steps, SPA push/replace,
  cross-origin history, contradictory state, and missing baselines;
- manual, invalid, closed, moved, pinned, grouped, discarded, mismatched, and
  private opener relationships;
- exact one-level-at-a-time nested opener resolution and action;
- activation, post-activation validation, close failure, and focus restoration.

## September 5, 2026: ordinary Back after closing a child

Version `0.6.1`: **138 passed, 0 failed**. A new regression test first failed
against the previous implementation: after closing a child, its untracked
opener received a gesture but did not traverse its own history. Root
containment had disabled native Back while the missing opener relationship
caused the replacement action to do nothing.

The test runs the real content-side navigation script, message listener,
gesture gate, history tracker, and action layer with a controlled browser API
and history model. It now verifies:

- close the tracked child and focus its exact opener;
- reject the same movement's momentum in that opener;
- accept later gestures and traverse two ordinary history steps;
- retain the opener at the start of history;
- preserve this behavior for a cross-origin history model that reports
  `navigation.canGoBack: false`;
- allow ordinary Back without the Navigation API or after loss of a child
  baseline, without inventing closure eligibility;
- keep the manual development command non-navigating for history results;
- reject subframe actions and inactive, discarded, or changing sender tabs.

The unpacked extension was reloaded in Brave and displayed version `0.6.1`.
The controlled live browser sequence was not completed because DevTools UI
automation became unreliable. The automated result is not a physical trackpad
retest or a completed browser-integration result. The real sequence to repeat
is: navigate twice in a parent tab, open and gesture-close a child, then use
two separate back gestures in the parent. Refresh pages that were open before
the extension update before testing.

## Physical Brave/macOS matrix

### September 5, 2026: root-tab responsiveness follow-up

Version `0.6.2`: **146 passed, 0 failed**, including eight new tests that run
the real gesture content script with a controlled document and clock. They
cover native root input bypass, unchanged child classification/deduplication,
original site-style restoration, deferred ownership changes, stale replies,
missing child-history evidence, transient failures, and settings changes.

During the preceding live investigation, a physical horizontal sequence on
the opener lasted **3,752.8 ms** and contained **434 events**. Its automatic
action had already been requested after **241.2 ms**. A later accepted
history request returned in approximately **4 ms**. The evidence identifies
the long-lived sequence and fixed action gate as a responsiveness risk; it
does not prove the exact rejection reason for that earlier request because
its response object was lost during navigation.

The subsequently requested repeat reached the opener's home page, but its
complete action logs did not survive the browser-control turn boundary. No
timing or rejection claim is based on that incomplete repeat.

The fix gives a verified root's normal Back to Chromium instead of weakening
the destructive child-close guard. Physical confirmation is still required:
one gesture must close the child without also navigating the opener, and the
next intentional gesture must perform exactly one native Back. The browser
tool blocked opening the extension-management page. The user subsequently
reloaded version `0.6.2`, and the affected root page was refreshed. Live
inspection then confirmed content-script version `0.6.2`,
`navigationOwner: "BROWSER"`, and computed `overscroll-behavior-x: auto`
(previously `contain`). This verifies the active ownership change, not
physical macOS momentum behavior.

The normal browser Back command then reached the site's home page, and
Forward restored the article. The restored article again reported version
`0.6.2`, browser ownership, and `auto` overscroll. The console contained
pre-existing/repeated asynchronous message-channel errors attributed to the
page, without an identified responsible extension; this is not a clean-console
claim. The controlled Back/Forward result does not replace the physical
child-close-to-native-Back retest.

### Original August 30 physical run

All physical cases used ordinary two-finger trackpad movement. The extension
was freshly reloaded before the run so the version 2 local settings schema was
active and earlier development calibration was ignored.

| Case | Physical result | Backtrack result | Status |
| --- | --- | --- | --- |
| Native Brave back before containment | A swipe right delivered only the beginning of the DOM stream before Brave navigated from the gesture fixture back to `brave://extensions`. | No automatic action was possible because calibration was disabled. This reconfirms that DOM `preventDefault()` is not the control mechanism. | PASS, research observation |
| Direction calibration on child entry | 175 events over 1,704.3 ms; `netX: -7650`, `netY: -31`, `absoluteX: 7650`, peak X 254 px. | `HORIZONTAL_NEGATIVE_X`, no classifier blocker. `NEGATIVE_X` was explicitly stored as back and automatic actions became enabled. | PASS |
| Fast vertical scroll with momentum | 159 events over 1,540.4 ms; `netX: 12`, `netY: 4817`, `absoluteX: 22`, peak X 4 px. | Rejected as `NO_CANDIDATE`; the child stayed open and no navigation occurred. | PASS |
| Inner horizontal scroller, back direction | 162 events over 1,563.5 ms; `netX: -5141`, `netY: -12`, 116 decay-tail events. The scroller consumed 17 events and reached its boundary for 145 events. | Rejected as `NO_CANDIDATE` with `HORIZONTAL_SCROLL_CAN_CONSUME` and `INNER_HORIZONTAL_SCROLL_EDGE_GUARD`; the child stayed open. | PASS |
| Child at entry point | One calibrated physical back gesture outside a scroller. | The gesture-fixture child closed and its exact navigation-fixture opener became active. | PASS |
| Child with two SPA history steps | Physical sequence from `step=2`: back to `step=1`, back to `?child=1`, then back once more. | First two gestures stayed inside the child. The third gesture closed the child and activated its exact opener. | PASS |

One instructed internal-history attempt produced no `wheel` session and no
automatic action. The same case was repeated immediately and passed. It is
recorded as a missed test input, not as a navigation failure: the fail-closed
path left the tab and URL unchanged.

### Protected network-error page observation

On August 30, 2026, `https://auth.devlab.is/` failed in Brave with
`ERR_SSL_UNRECOGNIZED_NAME_ALERT`; a separate HTTPS client reproduced the TLS
`unrecognized name` failure. Brave displayed its protected
`chrome-error://chromewebdata/` document behind the requested address. The
Backtrack content script cannot run on that internal error document, so no
ordinary trackpad gesture can reach the extension there. This is an explicit
pure-extension limitation, not a gesture-classifier result.

## Acceptance result

The issue-level regression gate passes for the tested Brave/macOS setup:

- vertical movement did not become a back action;
- a strong back-direction movement inside a horizontal scroller was blocked,
  including its momentum tail and boundary phase;
- a calibrated entry-point back gesture closed only the verified child and
  focused its exact opener;
- meaningful internal history was exhausted before opener behavior;
- all automated invalid-opener, nested-opener, deduplication, and failure paths
  passed.

This is not a broad production-compatibility claim. The extended research
matrix still needs Natural Scrolling on/off comparison, more gesture speeds,
real-world tables/carousels/Kanban boards, Chrome, additional Brave versions,
and another Mac/trackpad. Any repeatable false tab closure remains a No-Go.
