import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS, renderSettings } from "../src/settings.js";

test("renderSettings returns the settings root element", () => {
  assert.match(renderSettings(DEFAULT_SETTINGS), /^<main class="settings">/);
});
