# Safe Opener-Tab Validation

Status: August 30, 2026

## Purpose of this step

This first Phase 2 component answers one question only:

> Does the current tab have an opener tab that still exists and can be reached
> unambiguously?

When a tab is opened from another tab, Chromium exposes the opener tab ID as
`openerTabId`. Backtrack reads this relationship in a Manifest V3 background
process (service worker) and validates it conservatively. It does not activate
or close any tabs yet.

## Safety decision

Backtrack accepts the relationship only when all of the following are true:

- the current tab and `openerTabId` have valid numeric IDs;
- a tab does not refer to itself as its opener;
- the current tab is not pinned;
- the opener can be resolved immediately through `chrome.tabs.get()`;
- the returned tab has exactly the expected ID;
- both tabs are currently in the same browser window;
- both tabs belong to either the regular or the private browser context;
- the opener has not been discarded from memory by the browser.

If any condition cannot be confirmed safely, the result is `ok: false`. A
later action step must then stop without closing the current tab.

## Special cases

| Situation | Decision | Reason |
| --- | --- | --- |
| Opener was closed | Reject | The stored ID can no longer be resolved. |
| Only the child tab was moved to another window | Reject | The opener is no longer in the same visible navigation context. |
| Both tabs were moved together to the same other window | Accept | The current unambiguous relationship in one window still exists. |
| Current tab is pinned | Reject | Automatically closing a pinned tab would be surprising. |
| Opener is pinned | Accept | It is an unambiguous, stable focus target; only the unpinned current tab would be closed. |
| Tabs are grouped | Accept | Group membership does not change the exact `openerTabId` relationship. |
| Opener was discarded | Reject | Backtrack must not trigger an unexpected reload while focusing the opener. |
| Regular and private contexts differ | Reject | Backtrack does not cross context boundaries. |

## Nested tabs

A chain such as `Tab A → Tab B → Tab C` does not require a stored tab tree.
Backtrack always validates only the immediate relationship:

```text
Tab C → openerTabId of Tab C → Tab B
Tab B → openerTabId of Tab B → Tab A
```

Nested opener relationships therefore remain possible without building a
long-lived browser-history model.

## No persistent storage

The validation processes only short-lived tab metadata in the background:

- tab ID;
- window ID;
- opener tab ID;
- active, pinned, discarded, private, and group state.

Diagnostic objects contain no URL, page title, favicon, or page content. Since
version `0.3.0`, the separate history component uses volatile session storage
(`storage.session`) for opaque navigation-entry keys. There is still no local
database, persistent storage, telemetry, or server connection.

## Permission

The manifest still does not request the `tabs` permission. According to the
[Chrome Tabs API documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs),
most Tabs API functions can be used without an additional permission. The
`tabs` permission is primarily required for sensitive properties such as URL,
page title, and favicon; Backtrack does not access those fields.

The `storage` permission added in version `0.3.0` belongs to the separate
history component. [`internal-history.md`](internal-history.md) documents why
that component uses only `storage.session`.

The background process is registered as a module service worker in the
manifest. Its event listeners are registered immediately at load time, as
recommended by the
[Chrome extension service-worker documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics).

## Requirement for later tab actions

A positive validation result is not a lasting promise. Tabs can be closed or
moved between validation and action. Before a later version activates an
opener or closes the current tab, it must resolve and validate the same
relationship again immediately.

The safe ordering for that future action is developed and tested separately.
This module deliberately calls neither `chrome.tabs.update()` nor
`chrome.tabs.remove()`.

## Automated coverage

Tests cover, among other cases:

- a valid opener and safe diagnostic fields;
- a missing or closed opener;
- nested relationships;
- window changes;
- pinned and grouped tabs;
- a discarded opener;
- self-references, ID mismatches, and private-context boundaries;
- the message interface between the content script and background process.

Run them with:

```sh
npm test
```

## Manual Brave smoke test

On August 30, 2026, unpacked version `0.2.0` was reloaded in Brave. A child tab
created under controlled conditions in the same window carried the real
`openerTabId` of its opener. The background process returned:

```text
ok: true
reason: VALID_OPENER
```

The log also confirmed the intended scope: diagnostics only, no tab action,
and no persistent storage.
