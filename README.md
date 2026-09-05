# Backtrack

Backtrack explores Atlas-like back navigation across tabs in Brave and other
Chromium browsers on macOS.

When a link opens a child tab, the intended final behavior is:

```text
Child tab has meaningful internal back history
→ navigate back inside the child tab first

Child tab is back at its original entry point
→ close the child tab and focus its opener
```

False positives are considered much worse than a missed transition. Any
unclear state must result in no special action.

Repository documentation, user-visible development text, tests, and GitHub
planning are maintained in English.

## Current status

**Phase 2, four bounded components complete.**

The Phase 1 gesture proof of concept remains available. A Manifest V3 service
worker now validates whether a newly opened tab has a still-existing,
unambiguous opener in the same browser window. It prefers Chromium's
`openerTabId` and, since version `0.5.1`, supplements a missing value only when
the browser's `webNavigation.onCreatedNavigationTarget` event provides the
exact source-tab and child-tab IDs. Backtrack also
distinguishes meaningful internal history from the captured child-tab entry
point across full-document navigation and single-page applications that use
`history.pushState()` or `history.replaceState()`. A guarded action layer can
now activate a freshly revalidated opener and close its child tab at the
tracked entry point.

Version `0.5.0` added the first conservative physical-gesture orchestration.
Automatic actions are disabled by default and remain disabled until the local
back direction is explicitly calibrated. Version `0.5.2` no longer waits for
the full macOS momentum tail: a stronger early policy must remain eligible for
90 ms before it requests the guarded history or opener action. Ambiguous,
vertical, or page-owned horizontal movement still fails closed. A window-wide
cooldown prevents the remainder of the same physical movement from acting in
the newly active document or opener tab.

Version `0.6.0` adds local visual feedback without changing that action gate.
Once a calibrated back movement is already clear, a small arrow appears in the
middle of the page and its ring follows gesture progress. It becomes blue when
the stronger early-action threshold is armed, then moves toward the back
direction and fades on commit.
Rejected or incomplete movement simply fades the arrow away. The indicator is
an isolated, non-interactive overlay: it neither reads page content nor delays
the guarded navigation request, and reduced-motion preferences are respected.

Version `0.6.1` restores ordinary back navigation in tabs without a safe opener
or a tracked child entry. Previously, root overscroll containment suppressed
native Back there, but the action layer supplied no replacement. A confirmed
gesture now requests normal browser history traversal in the freshly checked
active tab unless the tab qualifies for the separately guarded opener action.
Missing closure evidence never authorizes a close. Momentum, in-progress
navigation, inactive senders, and action failures still block further action.

Version `0.6.2` leaves normal navigation in verified root tabs to Brave itself.
When neither `openerTabId` nor the browser's exact navigation-target fallback
provides an opener, Backtrack restores the page's original overscroll style
and does not classify or animate its wheel input. These tabs no longer pass
through Backtrack's 1.8-second action gate. Child tabs retain the existing
gesture, history, and closure guards. Ownership changes wait until any active
Backtrack sequence and action have ended. This is a bounded root-tab fix, not
a claim that rapid consecutive gestures in nested child tabs are solved.

Real trackpad measurements produced a **Conditional Go** for a bounded Phase 2
prototype:

- DOM `preventDefault()` did not stop Brave's native back gesture.
- `overscroll-behavior-x: contain` on the root element did stop it in the
  controlled test.
- Slow and fast vertical scrolling produced no horizontal candidate.
- The local horizontal scroll area remained usable and was correctly blocked
  as a navigation candidate.
- Real tables, carousels, Kanban boards, and complex web applications still
  belong to the open extended compatibility matrix.

See [gesture-research.md](docs/gesture-research.md) for the evidence and the
exact Phase 1 decision.

## Repository layout

```text
manifest.json
package.json
src/
├── background/
│   ├── back-decision.js
│   ├── gesture-action-gate.js
│   ├── navigation-message-handler.js
│   ├── navigation-target-handler.js
│   ├── navigation-tracker.js
│   ├── opener-message-handler.js
│   ├── opener-resolver.js
│   ├── service-worker.js
│   └── tab-action.js
├── content/
│   ├── gesture-debug.js
│   ├── gesture-indicator.js
│   └── navigation-state.js
└── shared/
    ├── gesture-commit-policy.js
    ├── gesture-classifier.js
    ├── gesture-visual-policy.js
    ├── messages.js
    └── navigation-snapshot.js
docs/
├── gesture-fixture.html
├── indicator-fixture.html
├── gesture-research.md
├── gesture-safety.md
├── internal-history.md
├── navigation-fixture.html
├── opener-safety.md
└── tab-action.md
tests/
├── back-decision.test.js
├── back-navigation-regression.test.js
├── gesture-action-gate.test.js
├── gesture-classifier.test.js
├── gesture-commit-policy.test.js
├── gesture-visual-policy.test.js
├── navigation-message-handler.test.js
├── navigation-target-handler.test.js
├── navigation-snapshot.test.js
├── navigation-tracker.test.js
├── native-root-back.test.js
├── opener-message-handler.test.js
├── opener-resolver.test.js
└── tab-action.test.js
```

There is deliberately no build step and no external dependency. Brave can
load this directory directly as an unpacked extension. `package.json` contains
only the local test command.

## Install in Brave

1. Open `brave://extensions`.
2. Enable **Developer mode** in the upper-right corner.
3. Select **Load unpacked**.
4. Select the repository directory.
5. Reload any test pages that were already open.

Local repository path used during development:

```text
/Users/bodhi/Documents/Codex/Backtrack
```

The extension is also expected to load in Google Chrome and other Chromium
browsers, but Brave on macOS is the primary target.

## Architecture

### Gesture instrumentation

`src/content/gesture-debug.js` observes horizontal `wheel` sequences at
`document_start`. It records normalized deltas, axis dominance, cancelability,
scroll context, preliminary thresholds, and sequence boundaries. The pure
classifier rejects vertical movement, short or inconsistent input, synthetic
events, modifiers, non-pixel wheel input, page-canceled events, and horizontal
scroll areas that may own the interaction.

If and only if the direction was calibrated and automatic actions were
enabled and the tab is not a verified root, the content layer applies root
overscroll containment, confirms that the CSS took effect, and sends one
semantic `BACK_GESTURE` request. It can send
that request before the diagnostic sequence ends only after the stronger
early-commit thresholds remain valid for 90 ms. A session-only background gate
enforces one action per gesture ID and a 1.8-second cooldown across the whole
window against split or retargeted momentum tails. See
[gesture-safety.md](docs/gesture-safety.md).

In a verified root tab, Brave owns ordinary Back, Forward, and momentum
handling, including its own native feedback. Backtrack shows its custom arrow
only on the extension-controlled path. `BacktrackGestureDebug.getStatus()`
reports `navigationOwner: "BROWSER"` or `"BACKTRACK"` for local diagnosis.

### Gesture feedback

`src/shared/gesture-visual-policy.js` permits feedback earlier than an action,
but reuses all direction, page-ownership, scroll-area, modifier, trust, and
calibration blockers. The indicator begins at 80 horizontal pixels and never
performs navigation itself. `src/content/gesture-indicator.js` renders only a
fixed, pointer-transparent overlay inside a closed Shadow DOM, so site styles
cannot normally alter it and it cannot intercept clicks or scrolling.

The ring shows progress toward the stricter 720-pixel early-commit distance.
The action thresholds and 90 ms confirmation remain unchanged. If the gesture
does not reach an action, the arrow fades out without changing the page. The
visual itself stays centered in the viewport so it is not missed at the edge.

### Safe opener validation

The background process prefers `openerTabId` without requesting the broad
`tabs` permission. Some link-created tabs do not expose that property. For
those tabs only, Backtrack accepts Chromium's dedicated
`onCreatedNavigationTarget` event as a session-only source-to-child mapping.
It rejects missing, conflicting, closed, moved, discarded, pinned-child, or
cross-context relationships. The same exact relationship is validated again
immediately before activation and immediately before child-tab closure.

See [opener-safety.md](docs/opener-safety.md).

### Internal-history detection

The content script reads opaque `NavigationHistoryEntry.key` values from the
Navigation API. The background process remembers the captured child entry key
and compares it with the current entry key:

```text
current key differs from child entry key
→ USE_INTERNAL_HISTORY

current key equals child entry key and opener is still safe
→ RETURN_TO_OPENER_ELIGIBLE

missing or contradictory evidence
→ NO_SPECIAL_ACTION
```

`history.length` is logged for diagnostics only and is never used as the sole
decision signal. See [internal-history.md](docs/internal-history.md).

These are child-closure decisions, not permission to disable ordinary Back.
When closure is ineligible, the action layer can return `USE_BROWSER_HISTORY`:
the content script requests `history.back()` without assuming that the
Navigation API exposes every earlier entry. At the start of browser history,
that request does nothing and the tab stays open.

### Guarded tab action

`src/background/tab-action.js` consumes only a confirmed semantic back request.
It takes control only when the decision layer reports the exact tracked entry
point and a live, same-window opener. It activates the opener first, validates
the relationship once more, and only then closes the child. If closing fails,
it attempts to restore focus to the still-open child.

The gesture layer can call this action only after either the stronger confirmed
early classification or the completed-sequence fallback succeeds. See
[tab-action.md](docs/tab-action.md).

## Debugging

### Open the page log

1. Open an ordinary `https://` page.
2. Open DevTools (`⌥⌘I`).
3. Enable **Preserve log**.
4. Enable the **Verbose** log level. Individual events use `console.debug`;
   sequence start, end, and threshold crossings are also highlighted.
5. Filter for `[Backtrack:Gesture]` or `[Backtrack:Navigation]`.

For real navigation tests, close DevTools before performing the physical
gesture. In the tested Brave version, DevTools docked on the right prevented
native two-finger back navigation by itself. DevTools is useful for capturing
events but cannot alone prove that Backtrack suppressed browser navigation.

### Persistent diagnostic ring

For an intermittent missed close, Backtrack also keeps the most recent 160
meaningful gesture and action decisions in an on-device diagnostic ring. It
survives a page, tab, extension-service-worker, or browser restart, and is
overwritten from oldest to newest once it is full. This is a development aid,
not telemetry: nothing is sent anywhere.

On any ordinary `http://` or `https://` page, choose **Backtrack Development**
in DevTools' JavaScript context and run:

```js
await BacktrackGestureDebug.getPersistentDiagnosticLog()
```

The important sequence is normally one `GESTURE_SESSION` followed by a
`BACK_ACTION`. The session shows whether the movement became an action
candidate (and which safety blocker stopped it); the action shows the resolved
decision, for example `RETURNED_TO_OPENER`, `USE_INTERNAL_HISTORY`, or
`NO_SPECIAL_ACTION` with its exact reason. `GESTURE_OWNERSHIP` explains whether
the current tab was intentionally left to Brave's normal navigation.

Clear the ring after we have inspected an incident:

```js
await BacktrackGestureDebug.clearPersistentDiagnosticLog()
```

The ring keeps only a whitelisted, compact diagnostic schema: numeric tab and
window IDs; gesture classification, direction, and rounded threshold values;
and action/decision reason codes. It rejects URLs, page titles, page text, raw
wheel events, arbitrary page data, and browser history. Ordinary vertical
scrolling is not written to the persistent ring.

### Inspect opener validation in the background

1. Open `brave://extensions`.
2. Select the service-worker link for **Backtrack Development**.
3. Open a link from an existing tab in a new tab.
4. Filter for `[Backtrack:Opener]`.

An `ok: true` result confirms only the current opener relationship. It performs
no action. The diagnostic object contains no URL, title, favicon, or page
content.

### Inspect the internal-history decision

On an ordinary page, choose **Backtrack Development** from the JavaScript
context menu in DevTools, then run:

```js
BacktrackNavigationState.requestBackDecision()
```

Possible results:

- `USE_INTERNAL_HISTORY`: the child still has an internal back step;
- `RETURN_TO_OPENER_ELIGIBLE`: the child is back at its captured entry point
  and its opener is still safe;
- `NO_SPECIAL_ACTION`: evidence is missing or contradictory, or the opener is
  no longer safe.

This method remains diagnostic-only.

The manual Brave `152.1.94.117` smoke test on August 30, 2026 covered:

```text
child entry
→ two SPA push steps
→ one back step, still internal
→ second back step, entry reached
→ full-document navigation
→ tab without opener
```

The decision changed from `USE_INTERNAL_HISTORY` to
`RETURN_TO_OPENER_ELIGIBLE` only when the real child entry was reached.

### Run the guarded action manually

For a controlled smoke test, open a fresh child tab from an
ordinary `http://` or `https://` page. In the child tab's isolated **Backtrack
Development** DevTools context, run:

```js
BacktrackNavigationState.performConfirmedBackAction()
```

This command can close the current child tab. It returns one of:

- `RETURNED_TO_OPENER`: the opener was activated and the child was closed;
- `USE_INTERNAL_HISTORY`: the child still has internal back history, so no tab
  action occurred;
- `USE_BROWSER_HISTORY`: no safe child-close decision; ordinary browser Back
  is available to automatic gesture orchestration;
- `NO_SPECIAL_ACTION`: the sender is no longer eligible, navigation is in
  progress, or an API step failed.

The manual development command only reports either history result; unlike an
automatic gesture request, it does not call `history.back()`.

This development command bypasses gesture classification but not the opener or
history safety checks. The provisional `threshold-crossed` signal never calls
it.

The successful controlled run used Brave `152.1.94.117` on macOS `26.6.2`: a
fresh fixture child closed and its exact opener became the visibly selected
tab. See [tab-action.md](docs/tab-action.md) for the action order and failure
behavior.

## Gesture log format

Each structured object has a `kind` field:

- `wheel`: one raw and normalized `wheel` event;
- `session-start`: start of one related event sequence;
- `threshold-crossed`: the preliminary base threshold, never an action by
  itself;
- `early-commit-armed`: the stronger fast-path threshold became eligible;
- `early-commit-disarmed`: a safety condition changed during confirmation;
- `gesture-committed`: the stronger evidence remained eligible for 90 ms and
  an action request is about to be considered;
- `gesture-indicator-shown`: the safe visual-only preview threshold was met;
- `gesture-indicator-phase`: the stronger action threshold became armed;
- `gesture-indicator-hidden`: later evidence invalidated the visual preview;
- `session-end`: summary and conservative classification;
- `post-dispatch-default-prevented`: the page probably canceled the event
  after Backtrack's capture listener.

Completed measurements are also emitted as one compact
`[Backtrack:Gesture:SessionJSON]` line. Threshold crossings are preserved as
`[Backtrack:Gesture:ThresholdJSON]`, keeping the last scroll context visible
with Preserve log even if Brave destroys the old page during navigation.

`POSITIVE_X` and `NEGATIVE_X` do not inherently mean back or forward. The
mapping depends on hardware, macOS settings, and browser behavior. Backtrack
stores the explicitly calibrated mapping locally.

## Gesture research controls

The content script runs in an isolated JavaScript world. Choose
**Backtrack Gesture Research** or **Backtrack Development** from the DevTools
context menu before using these commands.

Show status:

```js
BacktrackGestureDebug.getStatus()
```

Preview the visual states without performing navigation:

```js
BacktrackGestureDebug.previewIndicator(0.55, "tracking")
BacktrackGestureDebug.previewIndicator(1, "armed")
BacktrackGestureDebug.hideIndicator()
```

These development commands only display or hide the overlay. They neither
simulate a trusted trackpad event nor request any history or tab action.

Enable automatic actions only after observing which sign the normal physical
back swipe produces on this Mac:

```js
await BacktrackGestureDebug.calibrateBackDirection("NEGATIVE_X")
// or "POSITIVE_X" on a configuration that reports the opposite sign
```

Disable actions while keeping the measured direction:

```js
await BacktrackGestureDebug.disableAutomaticActions()
```

Remove the calibration completely:

```js
await BacktrackGestureDebug.clearCalibration()
```

Calibration stores only the direction and enabled/disabled state in local
extension storage. The separate, bounded diagnostic ring above stores no
address, page content, raw wheel events, or browser history. Automatic actions require computed root
`overscroll-behavior-x: contain`; a failed containment check becomes a no-op.

Clear the measurement buffer:

```js
BacktrackGestureDebug.clearLog()
```

Finish and summarize the current sequence:

```js
BacktrackGestureDebug.finishSession()
```

Export measurements as JSON:

```js
copy(BacktrackGestureDebug.exportJson())
```

Raw gesture measurements remain only in the memory of the current page frame.
Reloading or closing the page removes them. They are never transmitted or
stored persistently. The direction calibration and the separate compact
diagnostic ring described above survive a reload.

### Controlled `preventDefault()` experiment

The PoC observes only by default:

```js
BacktrackGestureDebug.getConfig().preventDefaultMode
// "off"
```

Temporarily cancel horizontally dominant events for test case D:

```js
BacktrackGestureDebug.configure({ preventDefaultMode: "horizontal" })
```

Disable the experiment afterwards:

```js
BacktrackGestureDebug.configure({ preventDefaultMode: "off" })
```

The `horizontal` mode may interfere with horizontal scrolling. The stronger
`all` mode cancels every cancelable wheel event and must not remain active
during ordinary browsing.

Test root overscroll containment separately:

```js
BacktrackGestureDebug.setRootOverscrollBehavior("contain")
BacktrackGestureDebug.setRootOverscrollBehavior("unchanged")
```

This is also a research switch only. `unchanged` restores the previous inline
value.

## Manual gesture test sequence

Before every case, clear the buffer, perform exactly one gesture, wait briefly,
and save the JSON export. Record the browser version, macOS version, trackpad
model, and the **Natural scrolling** setting.

Start the local fixture server from the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8765/docs/gesture-fixture.html
```

The page loads no external resources. Its blue horizontal area starts in a
middle position so both directions can be tested.

### A. Page without horizontal scrolling

- Use a simple ordinary page.
- Swipe right once, then left in a separate measurement.
- Record sign, event count, total distance, and native browser behavior.

### B. Vertically scrollable page

- Scroll up and down normally several times.
- Expected: `session-end.evaluation.classification` remains `NO_CANDIDATE`,
  usually because horizontal dominance is too low.

### C. Horizontal scroll area

- Swipe over a large table, carousel, or horizontal code area.
- Check whether `horizontalScrollContext` is detected.
- The PoC blocks a candidate whenever a detectable horizontal scroll area is
  involved, even if that area is currently at an edge.

### D. Native Brave back gesture

- Navigate to a second page in the same tab.
- Perform native back with `preventDefaultMode` off.
- Compare the visible `wheel` stream with actual browser navigation.
- Repeat with `preventDefaultMode: "horizontal"`.
- Optionally run a separate comparison with root containment enabled.
- Reset every research switch after the test.

### E. Momentum or trailing decay

- Perform a short fast movement and lift both fingers.
- Inspect how many decaying events follow.
- `DECAY_TAIL_ONLY` is explicitly a heuristic. Standard `WheelEvent` exposes
  no reliable momentum phase.

The complete evidence matrix is in
[gesture-research.md](docs/gesture-research.md). Automated suites through
version `0.6.0` and calibrated physical end-to-end results are recorded separately in
[regression-matrix.md](docs/regression-matrix.md).

## Conservative gesture policy

The completed diagnostic sequence is classified as a horizontal candidate
when:

- net horizontal distance is at least 240 CSS pixels;
- accumulated horizontal movement is at least 4 times vertical movement;
- at least 90% of horizontal movement keeps the same direction;
- at least 8 pixel-mode events are present and one reaches 8 horizontal pixels;
- no horizontal scroll area can consume the movement;
- an inner horizontal scroll area is rejected even at its boundary;
- no modifier key is pressed;
- the page did not observably cancel the default behavior itself.

`threshold-crossed` remains a provisional research log and never requests an
action by itself. Version `0.6.0` may show the non-interactive arrow after 80
horizontal pixels, 3:1 dominance, 85% direction consistency, four pixel-mode
events, and a 6-pixel peak, but only when every ordinary safety blocker passes.
Visual eligibility is not action eligibility. To avoid waiting several seconds
for macOS momentum, version `0.5.2` added a stricter early action path: at least
720 horizontal pixels, 5:1
dominance, 95% direction consistency, 12 pixel events, a 12-pixel peak, every
normal safety check, and a further 90 ms confirmation period. If that path is
not conclusive, Backtrack retains the completed-sequence fallback. The policy
and its conservative tradeoffs are documented in
[gesture-safety.md](docs/gesture-safety.md).

## Permissions and privacy

| Access | Why needed? | Can it be avoided? | Theoretical data access |
| --- | --- | --- | --- |
| `storage` | `chrome.storage.session` keeps opaque child-entry and short gesture-cooldown state across service-worker suspension. `chrome.storage.local` keeps the user's explicit direction calibration and enabled/disabled choice plus a bounded, local diagnostic ring of 160 safe summaries. | Not safely for the current design. Losing an entry baseline or momentum claim must fail closed, the chosen direction must survive page reloads, and an intermittent issue needs evidence across tab closure. | The permission could also store arbitrary extension data. Backtrack stores only the documented diagnostic schema: numeric tab/window IDs, rounded gesture-threshold values, classification, and action/decision codes. It stores no URLs, titles, page content, raw wheel events, or browsing history. |
| `webNavigation` | `onCreatedNavigationTarget` supplies the exact source-tab and child-tab IDs when Brave omits `openerTabId` for a link-created tab. Backtrack ignores the event URL and keeps only the two numeric IDs in session memory. | Avoiding it caused real link-created tabs to fail with `NO_OPENER`. Inferring the source from the active tab or tab position would be unsafe. | The API can theoretically expose navigation events and their URLs. Backtrack subscribes only to the new-target event, does not log or store its URL, and contacts no server. |
| No `tabs` permission | The background uses tab lifecycle events plus `chrome.tabs.get()`, `chrome.tabs.update()`, and `chrome.tabs.remove()` for IDs, state validation, activation, and exact child closure. These operations do not require the broad permission. | Already avoided. | Without `tabs`, the API does not expose privileged URL, title, or favicon fields to Backtrack. |
| Automatic content script on `http://*/*` and `https://*/*` | Gesture and history changes must be observed early across ordinary websites. | An `activeTab` research build is possible but would require a toolbar action, service worker, and an extra step on every page. Reassess before production. | A content script could theoretically read or alter page DOM. Backtrack processes only event, geometry, scroll-context, and opaque navigation-entry data. It logs no URL and contacts no server. |

Backtrack does not run on `brave://`, `chrome://`, the Chrome Web Store, or
other protected browser pages. This also includes Chromium's internal
`chrome-error://chromewebdata/` document: when an `https://` navigation fails
because of TLS, DNS, or another network error, the address bar may still show
the requested site while the actual document is a protected browser error
page. Backtrack cannot receive trackpad events there. `file://` is not matched.
Subframes are included only when their own address matches `http://` or
`https://`.

## Known limitations

- Web content does not necessarily receive the same information as Brave's
  native macOS gesture machinery.
- Standard `WheelEvent` cannot reliably identify trackpad versus mouse and
  exposes no standardized gesture or momentum phase.
- Browser-generated network and certificate error pages are protected pages;
  the ordinary two-finger gesture cannot be detected there by a content
  script.
- Sites with custom JavaScript gesture logic may look like ordinary scroll
  areas or evade DOM scroll detection entirely.
- DevTools Preserve log is still useful for the raw per-page research log. The
  separate persistent diagnostic ring is available after real navigation and
  tab closure.
- Measurement buffers in embedded frames are separate.
- Direction calibration currently uses the isolated development API; there is
  no user-facing calibration screen yet.
- Automatic behavior is intentionally off until calibration succeeds.
- Inner horizontal scroll areas are blocked even at their edge, which prefers
  a missed back action over an accidental tab closure.
- Tabs open before the extension is loaded or reloaded receive no invented
  entry point.
- Tabs created by browser UI, extensions, restored sessions, or other paths
  that provide neither `openerTabId` nor an exact navigation-target event stay
  open.
- Browser or extension restart clears volatile history state; affected tabs
  are never automatically closed. Ordinary Back remains available after the
  current content scripts have loaded; refresh pages open before an update.
- Protected pages provide no content-script history evidence and therefore
  trigger no special action.

## Sources

- [Chrome: content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome: Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome: Web Navigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
- [Chrome: Navigation API](https://developer.chrome.com/docs/web-platform/navigation-api/)
- [WHATWG: Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html)
- [Chrome: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/)
- [Chrome: extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
- [W3C UI Events](https://www.w3.org/TR/uievents/)
- [Chromium: macOS HistorySwiper](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/renderer_host/chrome_render_widget_host_view_mac_history_swiper.h)
- [Chromium: OverscrollController](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/renderer_host/overscroll_controller.cc)
- [Chrome: overscroll behavior](https://developer.chrome.com/blog/overscroll-behavior/)

## Deliberately not included yet

- automatic tab action before explicit direction calibration;
- a persistently stored tab tree or browser history;
- an options page;
- telemetry, server access, a persistent tab tree, or browsing-history
  storage.
