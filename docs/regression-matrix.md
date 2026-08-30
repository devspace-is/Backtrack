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

Result: **85 passed, 0 failed**.

The suite covers:

- gesture distance, dominance, consistency, event-count, peak, and direction
  mapping;
- disabled, uncalibrated, forward, modified, synthetic, non-pixel, and
  page-canceled input;
- consumable, boundary, incomplete, and unknown horizontal scroll ownership;
- per-tab gesture ID deduplication, momentum cooldown, cleanup, and
  service-worker suspension-safe session state;
- internal-history precedence, multiple internal steps, SPA push/replace,
  cross-origin history, contradictory state, and missing baselines;
- manual, invalid, closed, moved, pinned, grouped, discarded, mismatched, and
  private opener relationships;
- exact one-level-at-a-time nested opener resolution and action;
- activation, post-activation validation, close failure, and focus restoration.

## Physical Brave/macOS matrix

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

