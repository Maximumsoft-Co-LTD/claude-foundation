import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

test("landing page copies the selected install command", async () => {
  const window = new Window({ url: "https://example.test/" });
  window.document.write(readFileSync(new URL("../../index.html", import.meta.url), "utf8"));
  window.matchMedia = () => ({ matches: true });
  window.setTimeout = (callback) => { callback(); return 1; };
  let copied = "";
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value) => { copied = value; } }
  });
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: window.navigator
  });

  await import(`../../app.js?copy=${Date.now()}`);
  const command = document.getElementById("install-command").textContent;
  document.getElementById("copy-install").click();
  await Promise.resolve();

  assert.equal(copied, command);
  assert.equal(document.getElementById("copy-install").textContent, "Copy");
});
