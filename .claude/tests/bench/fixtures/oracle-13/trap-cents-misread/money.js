function money(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function parseMoney(s) { return Number(s); }
module.exports = { money, parseMoney };
