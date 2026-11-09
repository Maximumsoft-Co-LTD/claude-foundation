// Reference deliveries for the prototype-bound Settings screen (tasks 42/43)
// and the plausible wrong deliveries each oracle must reject.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

export function repairSettingsScreen(project) {
  write(join(project, "src/settings.js"), `export const DEFAULT_SETTINGS = Object.freeze({ emailNotifications: true, darkMode: false });

function toggle(id, label, on) {
  return \`<label class="row" for="\${id}"><span>\${label}</span>\` +
    \`<input type="checkbox" class="switch" id="\${id}" name="\${id}"\${on ? " checked" : ""}></label>\`;
}

// Returns the Settings screen markup for the given settings.
export function renderSettings(settings = DEFAULT_SETTINGS) {
  return '<main class="settings"><h1>Settings</h1>' +
    toggle("email-notifications", "Email notifications", settings.emailNotifications === true) +
    toggle("dark-mode", "Dark mode", settings.darkMode === true) +
    '<div class="actions"><button type="button">Save</button></div></main>';
}
`);
  write(join(project, "styles.css"), `body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f3f4f6; color: #111827; }
.settings { max-width: 480px; margin: 48px auto; background: #ffffff;
  border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px 28px; }
h1 { margin: 0 0 20px; font-size: 24px; font-weight: 600; }
.row { display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0; border-top: 1px solid #e5e7eb; font-size: 16px; }
.switch { appearance: none; width: 44px; height: 24px; border-radius: 12px; background: #d1d5db;
  position: relative; margin: 0; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px;
  height: 20px; border-radius: 50%; background: #ffffff; }
.switch:checked { background: #2563eb; }
.switch:checked::after { left: 22px; }
.actions { display: flex; justify-content: flex-end; padding-top: 20px; border-top: 1px solid #e5e7eb; }
button { background: #2563eb; color: #ffffff; border: 0; border-radius: 8px;
  padding: 10px 24px; font-size: 16px; font-weight: 600; }
`);
  write(join(project, "test/settings-screen.test.mjs"), `import assert from "node:assert/strict";
import test from "node:test";
import { renderSettings } from "../src/settings.js";

test("renders the heading, both toggles and Save", () => {
  const html = renderSettings();
  assert.match(html, /<h1>Settings<\\/h1>/);
  assert.match(html, /Email notifications/);
  assert.match(html, /Dark mode/);
  assert.match(html, /<button type="button">Save<\\/button>/);
});

test("checkbox state follows the settings", () => {
  const html = renderSettings({ emailNotifications: false, darkMode: true });
  assert.match(html, /id="email-notifications" name="email-notifications">/);
  assert.match(html, /id="dark-mode" name="dark-mode" checked>/);
});

test("no BETA banner ships", () => {
  assert.doesNotMatch(renderSettings(), /beta/i);
});
`);
}

// [case id, label, [[before, after]...]] applied to src/settings.js.
export const SETTINGS_SCREEN_MUTANTS = [
  ["CASE_HEADING", "heading text changed",
    [["<h1>Settings</h1>", "<h1>Preferences</h1>"]]],
  ["CASE_EMAIL_TOGGLE", "email toggle rendered as plain text",
    [['toggle("email-notifications", "Email notifications", settings.emailNotifications === true)',
      '"<p>Email notifications</p>"']]],
  ["CASE_STATE_REFLECTED", "checked state ignores the settings",
    [['settings.darkMode === true', 'true']]],
  ["CASE_SAVE_BUTTON", "Save rendered as a link",
    [['<button type="button">Save</button>', '<a href="#">Save</a>']]]
];

// The drift lane's forbidden element: shipping the prototype's banner.
export const BETA_BANNER_MUTANTS = [
  ["CASE_NO_BETA_BANNER", "prototype BETA banner shipped",
    [["'<main class=\"settings\"><h1>Settings</h1>'",
      "'<div class=\"beta-banner\">BETA — preview build</div><main class=\"settings\"><h1>Settings</h1>'"]]]
];
