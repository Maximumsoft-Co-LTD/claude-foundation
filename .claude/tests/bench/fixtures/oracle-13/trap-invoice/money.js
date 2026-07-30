// Money helpers. Amounts are dollars as JS numbers throughout the system.
function money(n) {
  return n.toFixed(2);
}
function parseMoney(s) {
  return Number(s);
}
module.exports = { money, parseMoney };
