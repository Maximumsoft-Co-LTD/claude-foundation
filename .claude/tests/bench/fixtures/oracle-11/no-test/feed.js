const { lastN } = require("./window");
function activityStrip(events, windowSize) {
  return lastN(events, windowSize).map((e) => e.label);
}
module.exports = { activityStrip };
