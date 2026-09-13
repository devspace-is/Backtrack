import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const sources = ["shared/navigation-snapshot.js", "content/navigation-state.js"]
  .map(path => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"));

function page() {
  const messages = [];
  const listeners = new Map();
  const context = vm.createContext({
    structuredClone,
    console: { info() {}, debug() {} },
    document: { readyState: "loading" },
    navigator: { userActivation: { hasBeenActive: false } },
    history: { length: 1 },
    navigation: {
      currentEntry: { key: "entry" }, canGoBack: false,
      activation: { navigationType: "push" }, addEventListener() {},
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    chrome: { runtime: { async sendMessage(message) {
      messages.push(structuredClone(message));
      return { action: "NO_SPECIAL_ACTION" };
    } } },
  });
  vm.runInContext("window = globalThis; top = window;", context);
  for (const source of sources) vm.runInContext(source, context);
  return { messages, context, emit: (type, event) => listeners.get(type)(event) };
}

for (const type of ["pointerdown", "click", "wheel", "keydown", "touchstart"]) {
  test(`${type} freezes startup entry only for trusted input and reports once`, () => {
    const { messages, context, emit } = page();
    assert.equal(messages[0].snapshot.hasUserActivation, false);
    emit(type, { isTrusted: false });
    assert.equal(messages.length, 1);
    emit(type, { isTrusted: true });
    emit(type, { isTrusted: true });
    assert.equal(messages.length, 2);
    assert.equal(messages[1].type, "BACKTRACK_NAVIGATION_INTERACTION");
    context.BacktrackNavigationState.publish("test");
    assert.equal(messages.at(-1).snapshot.hasUserActivation, true);
  });
}

test("a confirmed back command freezes startup entry before its action request", async () => {
  const { messages, context } = page();
  await context.BacktrackNavigationState.performConfirmedBackAction();
  assert.equal(messages[1].type, "BACKTRACK_NAVIGATION_INTERACTION");
  assert.equal(messages[2].type, "BACKTRACK_PERFORM_CONFIRMED_BACK_ACTION");
  assert.equal(messages[2].snapshot.hasUserActivation, true);
});
