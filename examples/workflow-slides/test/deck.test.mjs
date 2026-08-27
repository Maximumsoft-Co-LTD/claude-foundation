import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

function fixture() {
  const window = new Window();
  window.document.body.innerHTML = `
    <div id="progress-bar"></div><span id="slide-current"></span><span id="slide-total"></span>
    <button id="prev-btn"></button><button id="next-btn"></button><div id="dots"></div>
    <div id="help" hidden><button id="help-close"></button></div><main id="deck" tabindex="-1"></main>
    <section class="slide is-active" data-slide="one"></section>
    <section class="slide" data-slide="two"></section>
    <section class="slide" data-slide="three"></section>`;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.CustomEvent = window.CustomEvent;
  return window;
}

test("example deck navigation updates controls, dots, and slide events", async () => {
  const window = fixture();
  const { initDeck } = await import(`../src/deck.js?navigation=${Date.now()}`);
  const changes = [];
  document.addEventListener("slidechange", (event) => changes.push(event.detail));
  initDeck();
  assert.equal(document.getElementById("slide-total").textContent, "3");
  assert.equal(document.getElementById("dots").children.length, 3);
  assert.equal(document.getElementById("prev-btn").disabled, true);

  document.getElementById("next-btn").click();
  assert.equal(document.getElementById("slide-current").textContent, "2");
  assert.deepEqual(changes[0], { index: 1, slide: "two" });
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(document.getElementById("slide-current").textContent, "3");
  document.getElementById("dots").children[0].click();
  assert.equal(document.getElementById("slide-current").textContent, "1");
});

test("example deck help and editable targets handle keyboard input safely", async () => {
  const window = fixture();
  const { initDeck } = await import(`../src/deck.js?help=${Date.now()}`);
  initDeck();
  const help = document.getElementById("help");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "?", bubbles: true }));
  assert.equal(help.hidden, false);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(help.hidden, true);
  help.hidden = false;
  document.getElementById("help-close").click();
  assert.equal(help.hidden, true);
  help.hidden = false;
  help.click();
  assert.equal(help.hidden, true);

  const input = document.createElement("input");
  document.body.appendChild(input);
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(document.getElementById("slide-current").textContent, "1");
});
