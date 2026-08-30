# Guarded Child-Tab Action

Status: August 30, 2026

## Purpose

This Phase 2 component performs one narrowly guarded transition:

```text
confirmed semantic back request
        +
tracked child-tab entry point
        +
same-window opener validated live
        ↓
activate opener → validate again → close child
```

The raw horizontal gesture logger does not call this action yet. Its direction
is still uncalibrated, and false-positive hardening belongs to the next step.
Version `0.4.0` exposes the action through the isolated development API so its
tab behavior can be tested without treating every horizontal movement as back.

## Preconditions

The action stops without changing tabs unless all of these checks succeed:

- the request comes from a real browser tab;
- the sender tab is still the active tab in its window;
- it was tracked from creation as a child with a validated `openerTabId`;
- its entry point was captured passively before the action request;
- the history tracker reports the exact captured child entry point;
- the opener still exists, has the expected ID, and is in the same window;
- neither tab crossed regular/private browser contexts;
- the child is not pinned and the opener is not discarded;
- no navigation transition or contradictory browser signal is present.

Tabs opened manually, tabs already present when the extension was reloaded,
protected browser pages, moved children, and children with closed openers fail
closed: no tab is activated or closed.

## Action order

Backtrack activates the opener before closing the child. Closing first would
allow Chromium to choose an arbitrary remaining tab if opener activation then
failed. The implemented order keeps the destructive step last:

1. Evaluate the opener and internal-history decision.
2. Fetch the child from Chromium again and require it to still be active.
3. Validate its exact opener relationship again.
4. Activate that opener with `chrome.tabs.update(openerId, { active: true })`.
5. Fetch the child and validate the relationship and active opener again.
6. Close only the exact child ID with `chrome.tabs.remove(childId)`.

If opener activation fails, the child is never closed. If a check or the close
fails after activation, Backtrack attempts to reactivate the still-existing
child in the original window. A failed fallback is reported but never followed
by another close attempt.

## Internal history

`USE_INTERNAL_HISTORY` always wins over opener behavior. The action layer
returns that result without calling either tab-mutation API. Browser or later
gesture orchestration can then perform the normal in-tab back step.

Only `RETURN_TO_OPENER_ELIGIBLE` can reach the guarded action path.
`NO_SPECIAL_ACTION` always remains a no-op.

## Nested tabs

Nested relationships need no separate tree:

```text
Tab A → Tab B → Tab C
```

An eligible action in Tab C resolves and returns only to Tab B. Tab B keeps its
own independently tracked relationship to Tab A, so a later eligible action in
Tab B returns one more level.

## Restricted pages

The manifest injects content scripts only into ordinary `http://` and
`https://` pages. `brave://`, `chrome://`, extension stores, extension pages,
and other protected surfaces cannot send the page-side confirmed-action
message. A missing sender tab is also rejected by the background action.

## Permission and privacy

No `tabs` permission is requested. Chromium allows the extension to use
`tabs.get()`, `tabs.update()`, and `tabs.remove()` without that broad permission.
Backtrack reads only non-sensitive tab metadata needed for the decision and
does not access or retain URLs, titles, favicons, or page content.

The action uses no server, analytics, telemetry, persistent tab tree, or
persistent browsing history.

## Controlled manual test

Reload version `0.4.0` on `brave://extensions`, then open a link from an
ordinary page into a new active child tab. In the child tab's isolated
**Backtrack Development** DevTools context, run:

```js
BacktrackNavigationState.performConfirmedBackAction()
```

The command may close the current tab. Expected results:

| State | Result |
| --- | --- |
| Child at its tracked entry point, valid opener | Opener becomes active and child closes |
| Child beyond its entry point | `USE_INTERNAL_HISTORY`; no tab changes |
| Manually opened tab | `NO_SPECIAL_ACTION`; tab remains open |
| Opener was closed | `NO_SPECIAL_ACTION`; tab remains open |
| Child or opener moved to a different window | `NO_SPECIAL_ACTION`; tab remains open |

Automated tests also cover ordering, API failures, focus restoration, changed
relationships, missing sender tabs, and nested child tabs.

## Verified Brave run

On August 30, 2026, unpacked version `0.4.0` was reloaded in Brave
`152.1.94.117` on macOS `26.6.2`. A fresh local fixture child was opened from a
separate active opener and reported a tracked entry with no internal back step.
The isolated development action then:

1. activated the exact opener;
2. closed the child;
3. left the opener visibly active;
4. left the unrelated neighboring tabs unchanged.

The child disappeared from Brave's tab list and the original fixture tab became
the selected tab. The test used the explicit confirmed-action command, not the
uncalibrated physical gesture signal.
