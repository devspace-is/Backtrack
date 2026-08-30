# Conservative Gesture Safety

Status: August 30, 2026  
Implementation: development version `0.5.0`

## Purpose

This layer turns a completed horizontal `wheel` sequence into a semantic
`BACK_GESTURE` only when the evidence is deliberately one-sided. Its governing
rule is:

```text
unclear movement → no special action
```

A missed tab return is acceptable. An accidental tab closure is not.

## Decision sequence

Backtrack does not act when a distance threshold is crossed. It waits until no
new related event arrives for 220 ms, then evaluates the whole sequence:

```text
wheel events
  → completed sequence
  → physical-shape checks
  → page and scroll-ownership checks
  → calibrated back-direction check
  → root-containment check
  → tab-level momentum gate
  → live internal-history and opener decision
```

The existing navigation and tab-action layers still make the final decision.
The gesture classifier cannot directly close a tab.

## Minimum physical evidence

All of these thresholds must pass:

| Signal | Minimum |
| --- | ---: |
| Net horizontal distance | 240 CSS pixels |
| Horizontal-to-vertical accumulated movement | 4:1 |
| Movement retained in one horizontal direction | 90% |
| Pixel-mode events | 8 |
| Largest individual horizontal delta | 8 CSS pixels |

The sequence is rejected if any event uses line or page delta mode, is
synthetic (`isTrusted: false`), contains a modifier key, or appears to have been
canceled by a page listener. These rules also reduce the chance that a mouse
wheel, Shift-plus-wheel shortcut, zoom gesture, or custom page interaction is
treated as browser navigation.

The thresholds are intentionally well below the real back sequences observed
in the controlled Brave/macOS matrix, which reached roughly 2,300–5,500 pixels
while remaining strongly horizontal. They are also far above the incidental
horizontal drift in the fastest measured vertical scroll, which accumulated
only 22 horizontal pixels.

## Horizontal scroll ownership

For every event, Backtrack inspects the event path for a horizontally
scrollable element and records whether it can consume movement in that event's
direction.

| Context | Policy |
| --- | --- |
| Inner scroller can move | Reject the sequence |
| Inner scroller is already at its edge | Reject the sequence |
| Scroll direction cannot be interpreted safely, including RTL | Reject the sequence |
| Root viewport scroller can move horizontally | Reject the sequence |
| Root viewport scroller is at the relevant boundary | May continue through the remaining checks |

Blocking an inner scroller even at its boundary is deliberate. A carousel,
Kanban board, gallery, table, timeline, or custom code view may attach its own
edge behavior that DOM geometry alone cannot reveal. Version 1 therefore
prefers a missed back action over stealing that interaction.

## Direction calibration

The sign of `deltaX` is not assigned a universal meaning. Hardware, macOS
Natural Scrolling, and browser behavior can change the relationship between a
physical movement and the reported sign.

Automatic behavior starts disabled. Development version `0.5.0` requires one
of these explicit local calibrations in the extension's isolated DevTools
context:

```js
await BacktrackGestureDebug.calibrateBackDirection("NEGATIVE_X")
await BacktrackGestureDebug.calibrateBackDirection("POSITIVE_X")
```

The current test Mac reported physical back as `NEGATIVE_X`, but that result is
not hard-coded. The opposite calibrated sign becomes `FORWARD_GESTURE` and
never requests a back action.

The stored object contains only schema version, direction, and enabled state.
Settings from an unknown schema version are ignored and therefore disable
automatic behavior. The object contains no URL, history entry, page content,
or gesture samples.

## Native-navigation containment

The Phase 1 evidence showed that DOM `preventDefault()` did not suppress
Brave's native history swipe reliably. Root
`overscroll-behavior-x: contain !important` did suppress it in the controlled
test while the inner fixture remained horizontally scrollable.

Backtrack therefore applies root containment only after automatic actions are
explicitly enabled. Immediately before an action request it also verifies that
the computed root value is still `contain`. If the page or browser prevents
that state, the request becomes a no-op. Disabling actions or clearing the
calibration restores the root's previous inline value.

This CSS intervention remains the largest compatibility risk and requires the
extended real-site matrix before a production MVP decision.

## Momentum deduplication

Standard `WheelEvent` exposes no dependable momentum phase. Backtrack uses two
independent boundaries instead:

1. A content sequence can request an action only after it ends, never at its
   preliminary threshold crossing.
2. The service worker atomically claims the gesture ID per tab in
   `chrome.storage.session` and enforces a 1.8-second per-tab cooldown.

The second guard survives a document navigation and service-worker suspension.
If one physical movement is split into two apparent sequences, the later tail
is rejected. The tradeoff is that an unusually fast intentional second back
gesture may be ignored.

## Internal history and opener behavior

After a gesture survives all checks, the background still re-evaluates the
current tab:

- `USE_INTERNAL_HISTORY`: the content script calls `history.back()` once;
- `RETURN_TO_OPENER_ELIGIBLE`: the guarded action activates the exact opener,
  revalidates it, then closes the child;
- `NO_SPECIAL_ACTION`: nothing happens.

Missing baselines, closed openers, moved children, pinned children, protected
pages, stale senders, unsupported message sources, and API failures all remain
no-ops.

## Automated coverage

The tests cover:

- both physical direction signs and forward rejection;
- disabled and uncalibrated states;
- distance, dominance, consistency, event-count, and peak thresholds;
- line/page delta mode, synthetic events, modifiers, and page cancellation;
- consumable, boundary, incomplete, and unknown horizontal scroll state;
- duplicate gesture IDs and split momentum tails;
- per-tab cooldown isolation and cleanup;
- gate enforcement before any tab action;
- internal-history precedence and guarded nested opener actions.

Run all tests with:

```sh
npm test
```

## Brave development smoke test

On August 30, 2026, the unpacked development build was reloaded in Brave
`152.1.94.117` on macOS `26.6.2`. The isolated content API reported gesture
module `0.2.0`, navigation module `0.3.0`, no calibration, automatic actions
disabled, and unchanged root overscroll behavior at startup.

A deliberately strong synthetic ten-event sequence reached 500 horizontal
pixels with 50:1 dominance. It still ended as `NO_CANDIDATE` with the sole
physical blocker `UNTRUSTED_EVENT`; no navigation request occurred. Explicit
`NEGATIVE_X` calibration then enabled automatic actions and reported root mode
`contain`. This confirms the browser wiring for safe defaults, settings,
containment, completed-sequence classification, and synthetic-event rejection.

This smoke test by itself did not count as a new physical-trackpad run. A later
calibrated version `0.5.0` run completed the core vertical-scroll,
horizontal-scroller, entry-point action, and multi-step internal-history cases.
See [regression-matrix.md](regression-matrix.md) for the measured values and
visible browser outcomes.

## Remaining manual validation

The core regression gate passed on the recorded Brave/macOS setup. Before
calling version 1 production-ready, extend real two-finger coverage across:

- Natural Scrolling on and off;
- slow, normal, and fast back gestures;
- ordinary pages with and without internal history;
- large tables, carousels, Kanban boards, image galleries, and code panes;
- long pages with vertical momentum;
- multiple current Brave and Chrome versions;
- at least one additional Mac and trackpad.

Any regular false tab closure is a No-Go. The keyboard-command fallback remains
the smallest pure-extension alternative if root containment or scroll ownership
cannot be made sufficiently safe.
