import assert from "node:assert/strict";
import test from "node:test";
import { NavigationTracker } from "../src/background/navigation-tracker.js";
import { performConfirmedBackAction } from "../src/background/tab-action.js";

function storage() {
  const values = new Map();
  return {
    async get(key) { return { [key]: structuredClone(values.get(key)) }; },
    async set(items) { for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); },
  };
}
const snap = (key, type = "push", extra = {}) => ({
  apiAvailable: true, currentEntryKey: key, navigationType: type,
  sameOriginCanGoBack: false, transitionActive: false, hasUserActivation: false,
  ...extra,
});
const commit = (documentId, extra = {}) => ({
  tabId: 20, frameId: 0, documentId, documentLifecycle: "active",
  transitionType: "link", transitionQualifiers: ["client_redirect"], ...extra,
});

async function setup() {
  const area = storage();
  const tracker = new NavigationTracker(area);
  const child = { id: 20, openerTabId: 10, windowId: 1, active: true };
  const tabs = new Map([[10, { id: 10, windowId: 1, active: false }], [20, child]]);
  const closed = [];
  const tabsApi = {
    async get(id) { if (!tabs.has(id)) throw new Error("Missing tab"); return structuredClone(tabs.get(id)); },
    async update(id, patch) {
      if (patch.active) for (const tab of tabs.values()) tab.active = tab.id === id;
      Object.assign(tabs.get(id), patch);
      return this.get(id);
    },
    async remove(id) { closed.push(id); tabs.delete(id); },
  };
  await tracker.beginCandidate(child);
  await tracker.confirmCandidate(20, 10);
  await tracker.recordSnapshot(20, snap("redirect-wrapper"), "wrapper-document");
  return { tracker, area, child, tabs, tabsApi, closed };
}

for (const sameOrigin of [false, true]) {
  test(`initial ${sameOrigin ? "same-origin" : "cross-origin"} redirect, two internal steps, back to landing, then close`, async () => {
    const { tracker, child, tabs, tabsApi, closed } = await setup();
    await tracker.recordDocumentCommit(commit("landing-document"));
    assert.equal((await tracker.assess(20)).reason, "NAVIGATION_IN_PROGRESS");
    const landing = snap("landing", "push", { sameOriginCanGoBack: sameOrigin });
    await tracker.recordSnapshot(20, landing, "landing-document");
    assert.equal((await tracker.assess(20)).availability, "AT_ENTRY_POINT");
    assert.equal((await tracker.assess(20)).reason, "TRACKED_REDIRECT_ENTRY_POINT");

    await tracker.recordInteraction(20, "landing-document");
    for (const key of ["page-2", "page-3"]) {
      const step = snap(key, "push", { sameOriginCanGoBack: true });
      await tracker.recordSnapshot(20, step, "landing-document");
      assert.equal((await performConfirmedBackAction(child, step, tabsApi, tracker)).action, "USE_INTERNAL_HISTORY");
    }
    await tracker.recordSnapshot(20, snap("page-2", "traverse", { sameOriginCanGoBack: true }), "landing-document");
    assert.equal((await tracker.assess(20)).availability, "INTERNAL_BACK_AVAILABLE");
    assert.deepEqual(closed, []);
    const returned = { ...landing, navigationType: "traverse" };
    await tracker.recordSnapshot(20, returned, "landing-document");
    assert.equal((await performConfirmedBackAction(child, returned, tabsApi, tracker)).action, "RETURNED_TO_OPENER");
    assert.deepEqual(closed, [20]);
    assert.equal(tabs.get(10).active, true);
  });
}

test("unattended initial redirects can span multiple documents and a worker restart", async () => {
  const { tracker, area } = await setup();
  await tracker.recordDocumentCommit(commit("middle-document"));
  await tracker.recordSnapshot(20, snap("middle"), "middle-document");
  const restarted = new NavigationTracker(area);
  await restarted.recordDocumentCommit(commit("landing-document"));
  await restarted.recordSnapshot(20, snap("landing"), "landing-document");
  assert.equal((await restarted.assess(20)).availability, "AT_ENTRY_POINT");
});

for (const interaction of ["message", "sticky-activation", "missing-activation"]) {
  test(`${interaction} prevents a later script redirect from redefining entry`, async () => {
    const { tracker } = await setup();
    if (interaction === "message") await tracker.recordInteraction(20, "wrapper-document");
    else await tracker.recordSnapshot(20, snap("redirect-wrapper", "push", {
      hasUserActivation: interaction === "sticky-activation" ? true : undefined,
    }), "wrapper-document");
    await tracker.recordDocumentCommit(commit("landing-document"));
    await tracker.recordSnapshot(20, snap("landing"), "landing-document");
    assert.equal((await tracker.assess(20)).availability, "INTERNAL_BACK_AVAILABLE");
  });
}

for (const extra of [
  { transitionQualifiers: [] },
  { transitionQualifiers: ["server_redirect"] },
  { transitionQualifiers: ["client_redirect", "forward_back"] },
  { transitionQualifiers: ["client_redirect", "from_address_bar"] },
  { transitionType: "form_submit" },
  { transitionType: "reload" },
]) {
  test(`ordinary navigation is not an initial redirect: ${JSON.stringify(extra)}`, async () => {
    const { tracker } = await setup();
    await tracker.recordDocumentCommit(commit("landing-document", extra));
    await tracker.recordSnapshot(20, snap("landing"), "landing-document");
    assert.notEqual((await tracker.assess(20)).availability, "AT_ENTRY_POINT");
  });
}

test("unknown tabs, subframes, prerenders and missing document IDs cannot move entry", async () => {
  const { tracker } = await setup();
  for (const extra of [{ tabId: 999 }, { frameId: 1 }, { documentLifecycle: "prerender" }, { documentId: undefined }]) {
    assert.equal(await tracker.recordDocumentCommit(commit("other", extra)), null);
  }
  assert.equal((await tracker.assess(20)).availability, "AT_ENTRY_POINT");
});

test("stale source snapshots cannot consume a redirect or overwrite its landing", async () => {
  const { tracker } = await setup();
  await tracker.recordDocumentCommit(commit("landing-document"));
  await tracker.recordSnapshot(20, snap("stale-wrapper"), "wrapper-document");
  assert.equal((await tracker.assess(20)).reason, "NAVIGATION_IN_PROGRESS");
  await tracker.recordSnapshot(20, snap("landing"), "landing-document");
  await tracker.recordSnapshot(20, snap("stale-wrapper"), "wrapper-document");
  assert.equal((await tracker.assess(20)).availability, "AT_ENTRY_POINT");
  assert.equal((await tracker.assess(20, snap("stale-wrapper"))).reason, "LIVE_ENTRY_MISMATCH");
});

test("a snapshot arriving before its commit is retried at pageshow without inventing entry", async () => {
  const { tracker } = await setup();
  await tracker.recordSnapshot(20, snap("landing"), "landing-document");
  assert.equal((await tracker.assess(20, snap("landing"))).reason, "LIVE_ENTRY_MISMATCH");
  await tracker.recordDocumentCommit(commit("landing-document"));
  await tracker.recordSnapshot(20, snap("landing"), "landing-document");
  assert.equal((await tracker.assess(20)).availability, "AT_ENTRY_POINT");
});

test("a full-document trip and bfcache return preserve the promoted landing", async () => {
  const { tracker } = await setup();
  await tracker.recordDocumentCommit(commit("landing-document"));
  await tracker.recordSnapshot(20, snap("landing"), "landing-document");
  await tracker.recordDocumentCommit(commit("further-document", { transitionQualifiers: [] }));
  await tracker.recordSnapshot(20, snap("further"), "further-document");
  assert.equal((await tracker.assess(20)).availability, "INTERNAL_BACK_AVAILABLE");
  await tracker.recordDocumentCommit(commit("landing-document", { transitionQualifiers: ["forward_back"] }));
  await tracker.recordSnapshot(20, snap("landing", "traverse"), "landing-document");
  assert.equal((await tracker.assess(20)).availability, "AT_ENTRY_POINT");
});

test("a missing opener still prevents closure at the promoted landing", async () => {
  const { tracker, child, tabs, tabsApi, closed } = await setup();
  await tracker.recordDocumentCommit(commit("landing-document"));
  await tracker.recordSnapshot(20, snap("landing"), "landing-document");
  tabs.delete(10);
  assert.equal((await performConfirmedBackAction(child, snap("landing"), tabsApi, tracker)).action, "USE_BROWSER_HISTORY");
  assert.deepEqual(closed, []);
});
