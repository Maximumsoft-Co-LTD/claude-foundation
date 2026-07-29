// Tiny JSON-file store the app already uses. Do not change its contract.
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "users.json");

function readAll() {
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function writeAll(users) {
  fs.writeFileSync(FILE, JSON.stringify(users, null, 2) + "\n");
}
module.exports = { readAll, writeAll, FILE };
