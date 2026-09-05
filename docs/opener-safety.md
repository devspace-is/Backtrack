# Safe Opener-Tab Validation

Status: August 30, 2026

## Purpose of this step

This first Phase 2 component answers one question only:

> Does the current tab have an opener tab that still exists and can be reached
> unambiguously?

When a tab is opened from another tab, Chromium often exposes the opener tab
ID as `openerTabId`. A real Brave test also produced a link-created tab where
that optional property was missing. Version `0.5.1` therefore uses
`webNavigation.onCreatedNavigationTarget` as a narrow fallback. That browser
event supplies both the exact source-tab ID and the exact new child-tab ID.

Backtrack never infers an opener from the currently active tab, tab order, a
time window, or a URL match. The fallback is accepted only for the dedicated
browser event and is kept in volatile session storage. Since version `0.4.0`,
a separate action module uses the validated relationship immediately before
activating an opener and closing its child.

## Safety decision

Backtrack accepts the relationship only when all of the following are true:

- the current tab and its browser-provided source ID have valid numeric IDs;
- the source is either the live `openerTabId` or an exact
  `onCreatedNavigationTarget` relationship;
- live and session-tracked relationships do not conflict;
- a tab does not refer to itself as its opener;
- the current tab is not pinned;
- the opener can be resolved immediately through `chrome.tabs.get()`;
- the returned tab has exactly the expected ID;
- both tabs are currently in the same browser window;
- both tabs belong to either the regular or the private browser context;
- the opener has not been discarded from memory by the browser.

If any condition cannot be confirmed safely, the result is `ok: false`. The
action layer then stops without closing the current tab.

## Special cases

| Situation | Decision | Reason |
| --- | --- | --- |
| Opener was closed | Reject | The stored ID can no longer be resolved. |
| Link-created child has no `openerTabId`, but Chromium reports an exact navigation target | Accept | The browser supplied both source and child IDs; all normal live checks still apply. |
| Tab has neither `openerTabId` nor an exact navigation-target event | Reject | Backtrack does not guess from focus, timing, tab order, or addresses. |
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
Tab C → validated immediate source of Tab C → Tab B
Tab B → validated immediate source of Tab B → Tab A
```

Nested opener relationships therefore remain possible without building a
long-lived browser-history model.

## No persistent storage

The validation processes only short-lived tab metadata in the background:

- tab ID;
- window ID;
- opener/source tab ID and whether it came from `openerTabId` or the exact
  navigation-target event;
- active, pinned, discarded, private, and group state.

Diagnostic objects contain no URL, page title, favicon, or page content. Since
version `0.3.0`, the separate history component uses volatile session storage
(`storage.session`) for opaque navigation-entry keys. Version `0.6.3` adds a
separate bounded local diagnostic ring for development: it accepts only
whitelisted numeric tab/window IDs, rounded gesture thresholds, and action or
decision codes. It explicitly rejects URLs, titles, page text, raw wheel
events, arbitrary page data, and browsing history. There is no telemetry or
server connection.

## Permission

The manifest still does not request the `tabs` permission. According to the
[Chrome Tabs API documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs),
most Tabs API functions can be used without an additional permission. The
`tabs` permission is primarily required for sensitive properties such as URL,
page title, and favicon; Backtrack does not access those fields.

The `storage` permission added in version `0.3.0` belongs primarily to the
separate history component. [`internal-history.md`](internal-history.md)
documents why that component uses only `storage.session`. Version `0.6.3` also
uses `storage.local` for the user-selected direction, enabled state, and the
bounded privacy-filtered diagnostic ring described above.

Version `0.5.1` adds the `webNavigation` permission solely for
`onCreatedNavigationTarget`. The event can theoretically expose the URL being
opened, but Backtrack neither logs nor stores that field. It retains only the
numeric source and child tab IDs in `storage.session`. This avoids a much less
reliable and more dangerous guess based on the active tab or tab position.

The background process is registered as a module service worker in the
manifest. Its event listeners are registered immediately at load time, as
recommended by the
[Chrome extension service-worker documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics).

## Requirement for tab actions

A positive validation result is not a lasting promise. Tabs can be closed or
moved between validation and action. The version `0.4.0` action layer resolves
the current tab from the browser and validates the same relationship before
activation. It validates it again after activation and before closure.

This resolver remains read-only. The separate `tab-action.js` module calls
`chrome.tabs.update()` and `chrome.tabs.remove()` only after the resolver and
history decision both succeed. See [tab-action.md](tab-action.md).

## Automated coverage

Tests cover, among other cases:

- a valid opener and safe diagnostic fields;
- a missing or closed opener;
- a validated navigation-target fallback with no live `openerTabId`;
- untrusted fallback sources and conflicting relationships;
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
