// Existing consumer. The activity strip asks for a window of recent events.
// The team runs this file as-is.
const { lastN } = require("./window");

function activityStrip(events, windowSize) {
  return lastN(events, windowSize).map((e) => e.label);
}

module.exports = { activityStrip };
