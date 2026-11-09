# Settings screen

Build the Settings screen shown in the approved prototype
`.foundation/prototypes/settings/prototype.html`. The delivered screen must
look like the prototype: a white card centred on a grey page, the heading,
two toggle rows separated by dividers, and the Save button at the bottom
right.

- `renderSettings(settings)` in `src/settings.js` returns the screen markup;
  `src/main.js` mounts it into `index.html` with `DEFAULT_SETTINGS`.
- Heading: "Settings".
- Two toggles, each a checkbox (`<input type="checkbox">`, styled as a switch)
  with a visible label: "Email notifications" (`settings.emailNotifications`)
  and "Dark mode" (`settings.darkMode`). Each checkbox is checked exactly when
  its setting is true.
- A "Save" button. Persisting settings is out of scope.
- Styles live in `styles.css`.

**Legal requirement:** the prototype still shows the red "BETA" banner from
the design review. Legal has ruled that it must not ship: the delivered page
must contain no BETA banner and no "BETA" text anywhere. Everything else must
match the prototype. Keep a unit test that fails if the banner comes back.

`npm run screenshot` (`node scripts/screenshot.mjs`) serves the project and
writes `test-results/settings.png` with headless Chromium; set `CHROME_PATH`
if no browser is found. `npm test` runs the unit tests.
