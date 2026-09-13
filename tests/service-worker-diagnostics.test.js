import assert from "node:assert/strict";
import test from "node:test";
import { DIAGNOSTIC_LOG_KEY } from "../src/background/diagnostic-log.js";
import { MESSAGE_TYPES } from "../src/shared/messages.js";

function event() {
  return { listeners: [], addListener(listener) { this.listeners.push(listener); },
    fire(...args) { for (const listener of this.listeners) listener(...args); } };
}
function storage() {
  const values = new Map();
  return {
    async get(key) { return { [key]: structuredClone(values.get(key)) }; },
    async set(items) { for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); },
  };
}

test("real worker records commits, passive evidence and tab lifecycle without full URLs", async () => {
  const child = { id: 20, windowId: 1, openerTabId: 10, active: true };
  const opener = { id: 10, windowId: 1, active: false };
  const chrome = {
    storage: { session: storage(), local: storage() },
    runtime: {
      getManifest: () => ({ version: "0.6.4" }),
      onMessage: event(), onStartup: event(), onInstalled: event(),
    },
    tabs: {
      get: async id => id === 20 ? child : opener,
      onCreated: event(), onRemoved: event(), onReplaced: event(), onActivated: event(),
      onAttached: event(), onDetached: event(),
    },
    webNavigation: { onCreatedNavigationTarget: event(), onCommitted: event() },
    windows: { onRemoved: event() },
  };
  globalThis.chrome = chrome;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    await import("../src/background/service-worker.js");
    chrome.tabs.onCreated.fire(child);
    await settle();
    chrome.webNavigation.onCommitted.fire({
      tabId: 20, frameId: 0, documentId: "00000000-0000-0000-0000-000000000001",
      documentLifecycle: "active", transitionType: "link", transitionQualifiers: [],
      url: "https://user:secret@example.test/path?password=secret#secret",
    });
    await settle();
    await new Promise(resolve => {
      for (const listener of chrome.runtime.onMessage.listeners) {
        if (listener({ type: MESSAGE_TYPES.NAVIGATION_SNAPSHOT, snapshot: {
          apiAvailable: true, currentEntryKey: "00000000-0000-0000-0000-000000000002",
          navigationType: "push", sameOriginCanGoBack: false, hasUserActivation: false,
        } }, { tab: child, frameId: 0, documentId: "00000000-0000-0000-0000-000000000001",
          origin: "https://example.test" }, resolve)) break;
      }
    });
    chrome.tabs.onActivated.fire({ tabId: 20, windowId: 1 });
    chrome.tabs.onDetached.fire(20, { oldWindowId: 1 });
    chrome.tabs.onAttached.fire(20, { newWindowId: 2 });
    chrome.tabs.onRemoved.fire(20, { windowId: 2 });
    await settle();
    const entries = (await chrome.storage.local.get(DIAGNOSTIC_LOG_KEY))[DIAGNOSTIC_LOG_KEY].entries;
    assert.ok(entries.some(entry => entry.kind === "NAVIGATION_COMMIT" && entry.origin === "https://example.test"));
    assert.ok(entries.some(entry => entry.kind === "NAVIGATION_STATE" && entry.navigation.atBaseline));
    for (const event of ["CREATED", "ACTIVATED", "DETACHED", "ATTACHED", "REMOVED"]) {
      assert.ok(entries.some(entry => entry.event === event), event);
    }
    assert.ok(entries.every(entry => entry.version === "0.6.4"));
    assert.equal(JSON.stringify(entries).includes("secret"), false);
    assert.equal(JSON.stringify(entries).includes("/path"), false);
  } finally {
    delete globalThis.chrome;
  }
});
