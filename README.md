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

**Phase 2, two bounded components complete.**

The Phase 1 gesture proof of concept remains available. A Manifest V3 service
worker now validates whether a newly opened tab has a still-existing,
unambiguous opener (`openerTabId`) in the same browser window. Backtrack also
distinguishes meaningful internal history from the captured child-tab entry
point across full-document navigation and single-page applications that use
`history.pushState()` or `history.replaceState()`.

The extension currently returns diagnostic decisions only. It does not
navigate browser history, activate tabs, or close tabs.

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
│   ├── navigation-message-handler.js
│   ├── navigation-tracker.js
│   ├── opener-message-handler.js
│   ├── opener-resolver.js
│   └── service-worker.js
├── content/
│   ├── gesture-debug.js
│   └── navigation-state.js
└── shared/
    ├── messages.js
    └── navigation-snapshot.js
docs/
├── gesture-fixture.html
├── gesture-research.md
├── internal-history.md
├── navigation-fixture.html
└── opener-safety.md
tests/
├── back-decision.test.js
├── navigation-message-handler.test.js
├── navigation-snapshot.test.js
├── navigation-tracker.test.js
├── opener-message-handler.test.js
└── opener-resolver.test.js
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
scroll context, preliminary thresholds, and sequence boundaries. It never
performs navigation.

### Safe opener validation

The background process validates `openerTabId` without requesting the broad
`tabs` permission. It rejects missing, closed, moved, discarded, pinned-child,
or cross-context relationships. The same relationship must be validated again
immediately before any future tab action.

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

All three are diagnostic-only in version `0.3.0`.

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

## Gesture log format

Each structured object has a `kind` field:

- `wheel`: one raw and normalized `wheel` event;
- `session-start`: start of one related event sequence;
- `threshold-crossed`: a preliminary measurement signal, never an action;
- `session-end`: summary and conservative classification;
- `post-dispatch-default-prevented`: the page probably canceled the event
  after Backtrack's capture listener.

Completed measurements are also emitted as one compact
`[Backtrack:Gesture:SessionJSON]` line. Threshold crossings are preserved as
`[Backtrack:Gesture:ThresholdJSON]`, keeping the last scroll context visible
with Preserve log even if Brave destroys the old page during navigation.

`POSITIVE_X` and `NEGATIVE_X` deliberately do not mean back or forward. The
mapping depends on hardware, macOS settings, and browser behavior and must be
measured.

## Gesture research controls

The content script runs in an isolated JavaScript world. Choose
**Backtrack Gesture Research** or **Backtrack Development** from the DevTools
context menu before using these commands.

Show status:

```js
BacktrackGestureDebug.getStatus()
```

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

Gesture measurements remain only in the memory of the current page frame.
Reloading or closing the page removes them. They are never transmitted or
stored persistently.

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
[gesture-research.md](docs/gesture-research.md).

## Conservative preliminary heuristic

A sequence is classified as a horizontal **measurement candidate** only when:

- net horizontal distance is at least 80 normalized pixels;
- accumulated horizontal movement is at least 2.5 times vertical movement;
- at least 80% of horizontal movement keeps the same direction;
- no detectable horizontal scroll area is involved;
- no modifier key is pressed;
- the page did not observably cancel the default behavior itself.

These are research starting values, not production gesture detection.
`threshold-crossed` never performs navigation.

## Permissions and privacy

| Access | Why needed? | Can it be avoided? | Theoretical data access |
| --- | --- | --- | --- |
| `storage` | `chrome.storage.session` keeps the opaque child entry key in memory when Chromium suspends and restarts the short-lived service worker. | Not safely. A lost entry must not be replaced with an invented baseline. | The permission could also allow persistent extension storage. Backtrack uses only volatile session storage and stores no URLs, titles, or content. |
| No `tabs` permission | The background uses `chrome.tabs.onCreated` and `chrome.tabs.get()` only for non-sensitive fields such as IDs, window, pinned/grouped state, and `openerTabId`. | Already avoided. | Without `tabs`, the API does not expose privileged URL, title, or favicon fields to Backtrack. |
| No `webNavigation` permission | Full-document and SPA changes are observed through the Navigation API in the content script. | Already avoided. | Backtrack gains no additional extension-level navigation event or address access. |
| Automatic content script on `http://*/*` and `https://*/*` | Gesture and history changes must be observed early across ordinary websites. | An `activeTab` research build is possible but would require a toolbar action, service worker, and an extra step on every page. Reassess before production. | A content script could theoretically read or alter page DOM. Backtrack processes only event, geometry, scroll-context, and opaque navigation-entry data. It logs no URL and contacts no server. |

Backtrack does not run on `brave://`, `chrome://`, the Chrome Web Store, or
other protected browser pages. `file://` is not matched. Subframes are included
only when their own address matches `http://` or `https://`.

## Known limitations

- Web content does not necessarily receive the same information as Brave's
  native macOS gesture machinery.
- Standard `WheelEvent` cannot reliably identify trackpad versus mouse and
  exposes no standardized gesture or momentum phase.
- Sites with custom JavaScript gesture logic may look like ordinary scroll
  areas or evade DOM scroll detection entirely.
- DevTools Preserve log is required if logs must survive real navigation.
- Measurement buffers in embedded frames are separate.
- X directions are not yet calibrated semantically as `BACK_GESTURE` and
  `FORWARD_GESTURE`.
- Tabs open before the extension is loaded or reloaded receive no invented
  entry point.
- Browser or extension restart clears volatile history state; affected tabs
  remain untouched.
- Protected pages provide no content-script history evidence and therefore
  trigger no special action.

## Sources

- [Chrome: content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome: Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome: Navigation API](https://developer.chrome.com/docs/web-platform/navigation-api/)
- [WHATWG: Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html)
- [Chrome: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/)
- [Chrome: extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
- [W3C UI Events](https://www.w3.org/TR/uievents/)
- [Chromium: macOS HistorySwiper](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/renderer_host/chrome_render_widget_host_view_mac_history_swiper.h)
- [Chromium: OverscrollController](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/renderer_host/overscroll_controller.cc)
- [Chrome: overscroll behavior](https://developer.chrome.com/blog/overscroll-behavior/)

## Deliberately not included yet

- calls to `chrome.tabs.remove()` or `chrome.tabs.update()`;
- actual back navigation inside the child tab;
- opener activation or child-tab closure;
- a persistently stored tab tree or browser history;
- an options page;
- telemetry, server access, or persistent storage.
