// Address-book screen. Runs as-is.
const { listContacts } = require("./contacts");

function addressBook() {
  return listContacts().map((c) => `${c.name || "(no name)"} <${c.email}>`);
}

module.exports = { addressBook };
