const fs = require("node:fs");

// The ledger is the single JSON document of record. Writes replace the file
// atomically through a temporary sibling.
function loadLedger(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { payments: {}, ...data };
  } catch (error) {
    if (error.code === "ENOENT") return { payments: {} };
    throw error;
  }
}

async function saveLedger(file, ledger) {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(ledger, null, 2)}\n`);
  await fs.promises.rename(temp, file);
}

module.exports = { loadLedger, saveLedger };
