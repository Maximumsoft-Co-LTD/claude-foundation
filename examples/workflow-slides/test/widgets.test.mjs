import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

function installWindow(markup) {
  const window = new Window();
  window.document.body.innerHTML = markup;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.CustomEvent = window.CustomEvent;
  return window;
}

function fakeTimers(t) {
  const scheduled = [];
  const cleared = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback) => {
    scheduled.push(callback);
    return scheduled.length;
  };
  globalThis.clearTimeout = (timer) => cleared.push(timer);
  t.after(() => {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });
  return {
    cleared,
    runNext() {
      const callback = scheduled.shift();
      if (callback) callback();
      return Boolean(callback);
    },
    run(count) {
      for (let index = 0; index < count && this.runNext(); index += 1) {}
    }
  };
}

test("flow widget plays every step, tracks cycles, resets, and pauses off-slide", async (t) => {
  const steps = Array.from({ length: 10 }, (_, index) =>
    `<div class="flow-step" data-step="${index + 1}"></div>`).join("");
  const window = installWindow(`
    <div id="flow-strip">${steps}</div><div id="flow-log"></div>
    <button id="flow-play"></button><button id="flow-reset"></button>
    <span id="cycle-review"></span><span id="cycle-test"></span>`);
  const timers = fakeTimers(t);
  const { initFlow } = await import(`../src/slides/flow.js?test=${Date.now()}`);
  initFlow();
  document.getElementById("flow-play").click();
  timers.run(30);
  assert.equal(document.getElementById("flow-play").textContent, "play again");
  assert.equal(document.getElementById("cycle-review").textContent, "1");
  assert.equal(document.getElementById("cycle-test").textContent, "1");
  assert.equal(document.getElementById("flow-log").children.length, 8);
  assert.equal(document.querySelector('[data-step="10"]').classList.contains("active"), true);

  document.getElementById("flow-play").click();
  assert.equal(document.getElementById("flow-play").disabled, true);
  document.dispatchEvent(new window.CustomEvent("slidechange", {
    detail: { slide: "title" }
  }));
  assert.equal(document.getElementById("flow-play").disabled, false);
  document.getElementById("flow-reset").click();
  assert.equal(document.getElementById("flow-play").textContent, "play");
  assert.ok(timers.cleared.length > 0);
});

test("title widget types, holds, deletes, pauses, and resumes", async (t) => {
  installWindow("<main></main>");
  const timers = fakeTimers(t);
  const originalRandom = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = originalRandom; });
  const { initTitle } = await import(`../src/slides/title.js?test=${Date.now()}`);
  assert.doesNotThrow(() => initTitle());

  const typer = document.createElement("span");
  typer.id = "cmd-typer";
  document.body.appendChild(typer);
  initTitle();
  timers.run(80);
  assert.notEqual(typer.textContent, "");
  document.dispatchEvent(new CustomEvent("slidechange", { detail: { slide: "flow" } }));
  assert.ok(timers.cleared.length > 0);
  document.dispatchEvent(new CustomEvent("slidechange", { detail: { slide: "title" } }));
  assert.equal(timers.runNext(), true);
});

test("resume widget advances cycle state through completion and resets", async () => {
  const window = installWindow(`
    <pre id="state-json"></pre><button id="resume-tick"></button>
    <button id="resume-reset"></button>`);
  const { initResume } = await import(`../src/slides/resume.js?test=${Date.now()}`);
  initResume();
  const tick = document.getElementById("resume-tick");
  for (let index = 0; index < 9; index += 1) tick.click();
  let state = JSON.parse(document.getElementById("state-json").textContent);
  assert.equal(state.phase, "done");
  assert.deepEqual(state.cycles, { review: 1, test: 1 });
  assert.equal(tick.disabled, true);
  tick.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(tick.textContent, "run complete");

  document.getElementById("resume-reset").click();
  state = JSON.parse(document.getElementById("state-json").textContent);
  assert.equal(state.step, "spec");
  assert.equal(tick.disabled, false);
});
