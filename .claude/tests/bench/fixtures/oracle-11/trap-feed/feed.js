const { lastN } = require("./window");
function activityStrip(events, windowSize) {
  if (windowSize === 0) return [];
  return lastN(events, windowSize).map((e) => e.label);
}
module.exports = { activityStrip };
