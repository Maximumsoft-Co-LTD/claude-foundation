export const DEFAULT_SETTINGS = Object.freeze({ emailNotifications: true, darkMode: false });

// Returns the Settings screen markup for the given settings.
export function renderSettings(settings = DEFAULT_SETTINGS) {
  void settings;
  return '<main class="settings"><p class="placeholder">The settings screen has not been built yet.</p></main>';
}
