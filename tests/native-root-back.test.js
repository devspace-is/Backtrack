import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const sources = [
  "shared/gesture-classifier.js",
  "shared/gesture-commit-policy.js",
  "shared/gesture-visual-policy.js",
  "content/gesture-debug.js",
].map((path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"));

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const rootDecision = { decision: "NO_SPECIAL_ACTION", reason: "NO_OPENER" };
const childDecision = { decision: "RETURN_TO_OPENER_ELIGIBLE", reason: "TRACKED_ENTRY_POINT" };

async function createPage(initialDecision = rootDecision, originalStyle = "") {
  let decision = initialDecision;
  let now = 0;
  let timerId = 0;
  let calls = 0;
  let previews = 0;
  const timers = new Map();
  const listeners = new Map();
  const changed = [];
  const properties = new Map(originalStyle ? [["overscroll-behavior-x", [originalStyle, ""]]] : []);
  class Element {
    tagName = "HTML";
    scrollWidth = 800;
    clientWidth = 800;
    style = {
      getPropertyValue: (key) => properties.get(key)?.[0] ?? "",
      getPropertyPriority: (key) => properties.get(key)?.[1] ?? "",
      setProperty: (key, value, priority = "") => properties.set(key, [value, priority]),
      removeProperty: (key) => properties.delete(key),
    };
    getAttribute() { return null; }
  }
  const root = new Element();
  const addEventListener = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  };
  const settings = {
    schemaVersion: 2, backDirection: "NEGATIVE_X", automaticActionsEnabled: true,
  };
  const context = vm.createContext({
    Element, Text: class {}, structuredClone, queueMicrotask,
    console: { info() {}, debug() {} },
    crypto: { randomUUID: () => "test-root" },
    performance: { now: () => now },
    document: { documentElement: root, scrollingElement: root, visibilityState: "visible", addEventListener },
    getComputedStyle: () => ({ overscrollBehaviorX: root.style.getPropertyValue("overscroll-behavior-x") || "auto", overflowX: "visible", direction: "ltr" }),
    addEventListener,
    navigation: { addEventListener },
    innerWidth: 800, innerHeight: 600,
    WheelEvent: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id) => timers.delete(id),
    chrome: { storage: {
      local: { async get() { return { "backtrack.gesture.settings": settings }; } },
      onChanged: { addListener: (listener) => changed.push(listener) },
    } },
    BacktrackNavigationState: {
      async requestBackDecision() { return typeof decision === "function" ? decision() : decision; },
      getDiagnosticSnapshot: () => ({}),
      async requestAutomaticBackAction() { calls++; return { action: "USE_BROWSER_HISTORY" }; },
    },
    BacktrackGestureIndicator: {
      update() { previews++; }, hide() {}, commit() {}, destroy() {}, getStatus: () => ({}),
    },
  });
  vm.runInContext("window = globalThis; top = window;", context);
  for (const source of sources) vm.runInContext(source, context);
  await flush();
  const emit = (type, event = {}) => listeners.get(type)?.forEach(handler => handler(event));
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  return {
    api: context.BacktrackGestureDebug, root,
    get calls() { return calls; }, get previews() { return previews; },
    emit, advance,
    async decide(next) { decision = next; emit("visibilitychange"); await flush(); },
    async disable() { changed.forEach(fn => fn({ "backtrack.gesture.settings": { newValue: { ...settings, automaticActionsEnabled: false } } }, "local")); await flush(); },
    async wheel(count = 12) {
      for (let i = 0; i < count; i++) {
        emit("wheel", {
          deltaX: -70, deltaY: 0, deltaZ: 0, deltaMode: 0, isTrusted: true,
          cancelable: true, defaultPrevented: false, clientX: 400, clientY: 300,
          composedPath: () => [root], target: root,
          preventDefault() { assert.fail("Do not cancel ordinary wheel input"); },
        });
        await advance(10);
      }
    },
  };
}

test("a verified root leaves normal Back to Chromium without a custom action or icon", async () => {
  const page = await createPage();
  assert.equal(page.api.getStatus().navigationOwner, "BROWSER");
  assert.equal(page.root.style.getPropertyValue("overscroll-behavior-x"), "");
  // Two intentional inputs less than the action gate's 1.8 seconds apart must
  // never enter that gate at all. Native momentum handling stays browser-owned.
  await page.wheel();
  await page.advance(350);
  await page.wheel();
  await page.advance(250);
  assert.equal(page.calls, 0);
  assert.equal(page.previews, 0);
  assert.equal(page.api.getStatus().activeSessionId, null);
});

test("native root ownership preserves site-supplied overscroll styles", async () => {
  const page = await createPage(rootDecision, "none");
  assert.equal(page.root.style.getPropertyValue("overscroll-behavior-x"), "none");
  assert.equal(page.root.style.getPropertyPriority("overscroll-behavior-x"), "");
});

test("a child still requires the existing classifier and commits only once", async () => {
  const page = await createPage(childDecision);
  assert.equal(page.api.getStatus().navigationOwner, "BACKTRACK");
  assert.equal(page.root.style.getPropertyValue("overscroll-behavior-x"), "contain");
  await page.wheel();
  await page.advance(100);
  assert.equal(page.calls, 1);
  await page.wheel(60);
  assert.equal(page.calls, 1);
});

test("missing child history or a closed opener is not proof of a root", async () => {
  for (const reason of ["NOT_TRACKED", "OPENER_UNAVAILABLE", "INTERNAL_ERROR", "NAVIGATION_IN_PROGRESS"]) {
    const page = await createPage({ decision: "NO_SPECIAL_ACTION", reason });
    assert.equal(page.api.getStatus().navigationOwner, "BACKTRACK", reason);
  }
});

test("ownership does not switch midway through an active wheel sequence", async () => {
  const page = await createPage(childDecision);
  await page.wheel(2);
  await page.decide(rootDecision);
  assert.equal(page.api.getStatus().navigationOwner, "BACKTRACK");
  await page.advance(250);
  assert.equal(page.api.getStatus().navigationOwner, "BROWSER");
  assert.equal(page.calls, 0);
});

test("a stale root reply cannot override a more recent child decision", async () => {
  const page = await createPage(childDecision);
  let resolve;
  await page.decide(() => new Promise(done => { resolve = done; }));
  await page.decide(childDecision);
  resolve(rootDecision);
  await flush();
  assert.equal(page.api.getStatus().navigationOwner, "BACKTRACK");
});

test("a transient refresh failure leaves a verified root browser-owned", async () => {
  const page = await createPage();
  await page.decide(() => { throw new Error("Worker temporarily unavailable"); });
  assert.equal(page.api.getStatus().navigationOwner, "BROWSER");
});

test("disabling actions invalidates outstanding ownership requests", async () => {
  const page = await createPage();
  let resolve;
  await page.decide(() => new Promise(done => { resolve = done; }));
  await page.disable();
  resolve(childDecision);
  await flush();
  assert.equal(page.root.style.getPropertyValue("overscroll-behavior-x"), "");
  assert.equal(page.api.getStatus().semanticSettings.automaticActionsEnabled, false);
});
