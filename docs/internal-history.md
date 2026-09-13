# Internal Back History

Status: September 13, 2026

## Purpose of this step

This second Phase 2 component answers one question only:

> Can the current child tab meaningfully navigate back inside its own history,
> or is it back at its original entry point?

Backtrack returns one of three conservative decisions:

| Decision | Meaning in this version |
| --- | --- |
| `USE_INTERNAL_HISTORY` | The tab is beyond its entry point. The tab-action layer must leave the tabs untouched so internal back navigation wins. |
| `RETURN_TO_OPENER_ELIGIBLE` | The tab is back at the captured entry point and its opener is still safe. The guarded tab-action layer may revalidate and return to the opener. |
| `NO_SPECIAL_ACTION` | The state is unclear or unsafe for child closure. Backtrack must not activate an opener or close the tab. |

The decision function itself performs none of those actions. Since version
`0.4.0`, the separate guarded tab-action layer may consume
`RETURN_TO_OPENER_ELIGIBLE` to return to the opener. Since `0.6.1`, confirmed
automatic gestures also preserve ordinary browser Back when there is no safe
opener or tracked entry. The action layer revalidates the active sender and
returns `USE_BROWSER_HISTORY`; the page calls `history.back()` once. This
requires no invented entry point and cannot authorize tab closure. In-progress
navigation and failed safety/action checks still stop the request.

## Why `history.length` is insufficient

`history.length` counts entries in the joint session history of a browser
frame. It does not reveal which entry was the child tab's starting point. The
value may also be greater than one when the child opens, and back/forward
traversal does not change it in a way that uniquely identifies the current
position.

Backtrack therefore captures the value for local diagnostics only. It is not
used as a decision signal.

## The tracking model

Chromium's Navigation API assigns an opaque key
(`NavigationHistoryEntry.key`) to every session-history position. The key
remains stable when the browser revisits that position. When a safely
validated child tab starts, Backtrack captures:

- the key of its entry position;
- the key of its current history position;
- the most recent navigation type: push, replace, reload, or traversal;
- small safety signals such as whether a navigation is still in progress.

No URL, page title, favicon, or page content is stored.

```text
Entry A → new entry B → new entry C
   ↑                           │
   └────── back to B ← back ───┘

current key != entry key  → internal back history exists
current key == entry key  → back at the child entry point
```

### Navigation-type handling

| Browser signal | Handling |
| --- | --- |
| `push` | A new history position. If its key differs from the entry key, internal back history exists. This includes full-document navigation and `history.pushState()` in single-page applications (SPAs). |
| `traverse` | Back or forward traversal to an existing key. The tab is back at its entry point only when the entry key is reached. |
| `replace` at the entry point | Replaces the entry without adding another back step. The replacement key becomes the new entry key. |
| `replace` beyond the entry point | Replaces only the current internal step. The original entry remains unchanged. |
| `reload` with the same key | The position remains known. |
| unexpected key change | Unsafe state; no special action. |

## Why `navigation.canGoBack` is only a cross-check

For privacy reasons, the Navigation API can expose only a limited set of
same-origin history entries. `canGoBack` can therefore be `false` even when a
meaningful cross-origin page precedes the current page in the tab history.

Backtrack uses the opaque key captured across document changes as its primary
signal. If the browser simultaneously reports `canGoBack: true` at the tracked
entry point, the signals contradict each other. Backtrack then returns
`NO_SPECIAL_ACTION`, except for a same-origin predecessor already proven to
belong to the automatic opening redirect chain described below.

## Automatic opening redirects (0.6.4)

A link-created tab can load a wrapper before reaching the intended landing
page. Keeping the wrapper as the baseline leaves the landing page classified
as internal history, even after the user has returned from later pages.

The entry may advance to the landing page only with all of this evidence:

- The child and its opener were already tracked and validated.
- The current entry is the known baseline and its opening chain is still open.
- A top-level, active-document `webNavigation.onCommitted` event reports type
  `link` with qualifier `client_redirect`, not `forward_back` or
  `from_address_bar`.
- The source document has no reported user activation or trusted input.
  Pointer, click, key, touch, wheel, and confirmed Back input freeze the chain.
- A passive Navigation API snapshot with type `push` or `replace` arrives
  from the exact destination document identified by the browser.

Chrome documents `client_redirect` as JavaScript or meta-refresh redirection;
this signal alone is insufficient, hence the additional entry and interaction
guards. See the [Web Navigation API reference](https://developer.chrome.com/docs/extensions/reference/api/webNavigation).

While the destination snapshot is pending, closure is blocked. An opaque
`sender.documentId` binds snapshots to the current committed document; late
messages from a previous page cannot overwrite it. Decision/action queries
never rewrite the passive tracker. A live entry-key mismatch blocks closure
until the passive state catches up.

Unattended opening redirects can repeat. The first trusted interaction or
ordinary history step ends the chain; later redirects cannot reset the entry.
Returning through full-document history or the back-forward cache preserves
the landing baseline. A same-origin redirect predecessor may make
`canGoBack` true at that baseline; this narrow, recorded exception does not
apply to ordinary child entries. Missing or ambiguous evidence keeps the
original entry and never authorizes an inferred close.

This is not a URL-based redirect detector and uses no elapsed-time heuristic.
No site-specific rules, redirect URL list, or persistent history is stored.

## Redirected-Back loop recovery (0.6.5)

A page reached after deliberate child-tab navigation can make its predecessor
unreachable: browser Back reaches that predecessor, which immediately redirects
to the exact page the user just left. Merely seeing a redirect or a changed
Navigation API key is not enough to close the child.

Backtrack recognizes an effective return boundary only when every following
condition is present:

- Backtrack itself authorized an automatic `USE_INTERNAL_HISTORY` action from
  a tracked child and recorded its exact document and opaque entry identity.
- The next top-level active-document commit arrives within ten seconds.
- Chromium labels that commit `forward_back` and also `server_redirect` or
  `client_redirect`.
- The committed HTTP(S) address is exactly the address from which Back was
  requested. The two addresses are held only in volatile service-worker memory
  for this equality check and are then discarded.
- The attempted opaque entry still matches the tracker's current entry.
- The destination document reports a fresh `push` or `replace` entry and
  `navigation.canGoBack === false` for its visible same-origin history.
- The live action snapshot still identifies that exact loop entry.

The next deliberate Back may then use the existing guarded opener-return path.
The opener must still exist in the same window and is validated before and
after focus changes. A different destination, remaining same-origin history,
an expired/missing correlation, worker restart before the commit, changed
entry, protected page, or incomplete browser metadata does not authorize a
close. A later normal navigation also removes the loop marker.

The short-lived full-address comparison is not part of the persistent
development log or `storage.session`. Only the resulting boolean safety marker,
opaque entry/document identity and reason code may survive worker suspension.

## Full pages and single-page applications

The content script runs early on ordinary `http://` and `https://` pages. It
publishes a snapshot at document start, when a page is shown, and for the
Navigation API events `currententrychange` and `navigatesuccess`. This covers:

- full-document navigation;
- `history.pushState()` and `history.replaceState()`;
- back/forward traversal with `popstate`-like behavior;
- route changes in modern SPAs that use browser history correctly.

Pure view changes without a browser-history entry are not meaningful browser
back steps and are deliberately not counted.

## Volatile state and permission

Manifest V3 background processes can be stopped and restarted by the browser
at any time. A normal JavaScript object could then lose the captured child
entry. Backtrack therefore uses `chrome.storage.session` through the `storage`
permission.

This session storage:

- lives only in memory;
- survives the background process going to sleep and restarting;
- is cleared when the extension is disabled, reloaded, or updated, and when
  the browser restarts;
- is not exposed directly to webpage content scripts by default;
- stores only tab IDs, the opener tab ID, opaque entry/document keys, and a few
  status values for Backtrack, including the opening-chain safety flags.

The permission could theoretically also allow persistent extension storage.
The history component itself calls only `storage.session`; since version
`0.6.3`, a separate diagnostic ring uses `storage.local`. With the developer
user's explicit authorization, `0.6.5` retains 400 action attempts and 1,600
context events, including origins and opaque navigation/document UUIDs.
Full addresses, titles, page text and raw input remain excluded. The live
tracker never reads this log or restores closure eligibility from it. See
[`diagnostic-log.md`](diagnostic-log.md). Without session storage, the entry point
would become unknown after a routine background-process restart. Inventing a
new baseline would be more dangerous than keeping this small volatile state.

Version `0.5.1` added `webNavigation.onCreatedNavigationTarget` for exact
source-to-child relationships when `openerTabId` is missing. Version `0.6.4`
also observes top-level `onCommitted` metadata for opening redirects, and
`0.6.5` correlates one pending internal Back with a redirected return to the
exact same address. No new permission is added. Internal-history positions
still come from the page-side Navigation API. Full addresses are never stored:
only the equality result, tab IDs, opaque entry/document keys and safety flags
enter session state.

## Safe behavior when evidence is missing

Backtrack returns `NO_SPECIAL_ACTION`, among other cases, when:

- the tab was not tracked as a safe child from the moment it was created;
- the extension or browser restarted after the tab opened;
- the Navigation API is missing or returns incomplete data;
- a navigation is still in progress;
- entry keys and browser signals contradict each other;
- the opener is missing or no longer safely reachable;
- the page is protected and cannot run the content script.

A tab that was already open when the extension was reloaded is not adopted
retroactively. Backtrack cannot prove its real entry point and therefore does
not invent one.

A manual decision or action request also cannot establish a missing baseline.
Only the passive navigation snapshot sent as the tracked child loads may
capture its entry point. This prevents a late request on a page reached after
several navigations from being mistaken for the original child entry.

## Local test

[`navigation-fixture.html`](navigation-fixture.html) contains a small SPA with
no external resources. After starting a local web server, it can create and
replace history positions and traverse back through multiple steps.

In the isolated Backtrack DevTools context, this command displays the current
diagnostic decision:

```js
BacktrackNavigationState.requestBackDecision()
```

## Manual Brave smoke test

On August 30, 2026, version `0.3.0` was reloaded in Brave `152.1.94.117` on
macOS and tested with a real child tab opened through the fixture link.

| Child-tab state | Diagnostic decision |
| --- | --- |
| Directly at the entry point | `RETURN_TO_OPENER_ELIGIBLE` |
| After two `history.pushState()` steps | `USE_INTERNAL_HISTORY` |
| After one back step, still beyond the entry point | `USE_INTERNAL_HISTORY` |
| After the second back step, back at the entry point | `RETURN_TO_OPENER_ELIGIBLE` |
| After a full-document navigation | `USE_INTERNAL_HISTORY` |
| Manually opened tab without `openerTabId` | `NO_SPECIAL_ACTION` with `NO_OPENER` |

The child fixture also reported `history.length: 1` at its entry point. The
decision still came from the captured entry key, not from that number. The
test changed neither browser history nor tabs; every result was diagnostic
only.

## Sources

- [Chrome: Navigation API](https://developer.chrome.com/docs/web-platform/navigation-api/)
- [WHATWG HTML: Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html)
- [Chrome: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage/)
- [Chrome: Web Navigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
