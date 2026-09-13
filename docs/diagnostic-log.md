# Local Development Event Log

Status: September 13, 2026 — development version `0.6.5`.

## Browse now, investigate later

Recording runs automatically in this development build. DevTools and Codex do
not need to be open. Nothing must be copied, saved or reported at the moment
an incident occurs. The log is stored in the installed extension's
`chrome.storage.local`, not in this repository or on a server.

The explicit development scope is **400 Backtrack action attempts plus 1,600
context events**, up to 2,000 records total. Rejected attempts count as actions.
Each group discards its own oldest records when full. Frequent navigation
events cannot push the retained actions out. This is a count limit, not a
guaranteed number of days; sufficiently old incidents are eventually lost.

Stored records survive tab closure, worker suspension, browser restart and
extension reload/update under the same extension ID. Clearing extension data,
uninstalling it or changing profiles/IDs can remove or separate the log.
Private and normal browsing should not be assumed to have separate retention
if the user enables this development extension in private windows.

## Captured evidence

| Record | Purpose |
| --- | --- |
| `BACK_ACTION` | Action attempted, result/rejection reason, decision reason, source tab/document/entry, opener when available, response duration, remaining cooldown when rejected. |
| `GESTURE_SESSION` | Significant horizontal movement, classification, direction, thresholds, blockers and action-request timing. Not every raw wheel event. |
| `GESTURE_OWNERSHIP` | Whether Backtrack or the browser currently owns navigation. |
| `NAVIGATION_STATE` | Passive page state and tracked baseline, entry/document UUIDs, same-origin Back signal, history count, redirect and uncertainty flags. Identical snapshots are deduplicated. |
| `NAVIGATION_COMMIT` | Browser-observed document navigation, client/server redirect and back/forward qualifiers, destination origin and document identity. `BACK_REDIRECT_LOOP_DETECTED` records a successful in-memory equality correlation without storing either full address. |
| `NAVIGATION_RESULT` | Whether the content script requested ordinary Back after an action response; this does not itself prove completion. |
| `TAB_EVENT` | Creation, opener validation, activation, close, move to another window or replacement. |
| `RUNTIME_EVENT` | Worker/browser startup and installation/update with extension version. |

The log includes timestamps and website origins (`https://example.com` or
`http://10.0.0.5:5000`), but strips credentials, paths, queries and fragments.
It never reads cookies, passwords, form contents, page text, titles, complete
addresses or downloaded files. Opaque entry/document identifiers must match
the UUID format; arbitrary strings cannot enter those fields. The wider
metadata collection is explicitly authorized for local development, not an
accepted production analytics feature. Production logging needs a separate
decision before distribution.

The live history tracker does not consume this persistent log. Clearing it or
failure to write it cannot make a tab eligible for closure. Storage work is
not awaited before returning the navigation action response. Recording is
best effort: abrupt process termination or storage failure can lose pending
writes. No timing or completeness guarantee is inferred from a missing event.

## Later inspection

On an ordinary page with the current content script, select the **Backtrack
Development** isolated context in DevTools. No command is needed while merely
browsing. Later, inspect all retained data and the preliminary review with:

```js
await BacktrackGestureDebug.getPersistentDiagnosticReport()
```

The report contains records, capacity, date coverage, storage status and
investigation hints. An extension/read failure is explicit (`ok: false`),
not silently presented as a clean report. If a file is useful for analysis,
the DevTools `copy()` helper can copy the returned JSON for a local save:

```js
copy(JSON.stringify(await BacktrackGestureDebug.getPersistentDiagnosticReport(), null, 2))
```

There is no automatic export, upload, notification or background Codex task.
Codex can inspect the report when asked. Do not commit exported personal logs
or attach them publicly without separately reviewing the contents.

The preliminary review identifies action failures, slow responses, missing
closure evidence, browser-confirmed redirected-Back loops and repeated Back
requests from the same document/history entry without an intervening observed
change. These are **investigation hints, not confirmed bugs**. A loop can have
been recovered successfully. Normal cooldown rejections are not classified as
bugs. A missing event, protected page, browser-owned gesture, cleared log or
expired context prevents firm conclusions. The log cannot know whether an
apparently successful action matched the user's intent.

Clear both retained groups explicitly after inspection, if desired:

```js
await BacktrackGestureDebug.clearPersistentDiagnosticLog()
```

## Activation and verification

Reload the unpacked extension and verify version `0.6.5`. Refresh already-open
pages so their content scripts match the worker. Test closure only with
freshly link-opened child tabs: persistent diagnostic records do not restore
the live entry baseline of tabs that predate an update.

Automated coverage checks separate capacities, re-instantiation, deletion,
schema migration, sensitive-field filtering, passive-state deduplication,
write failures/recovery, non-blocking action responses, report generation,
hint false-positive guards and the actual worker's event wiring. A physical
Brave run with the updated build remains separate acceptance evidence.
