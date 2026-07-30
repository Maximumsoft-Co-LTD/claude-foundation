// Contact store. The address-book screen and the CSV exporter both import this —
// keep the exported names and the shape of what listContacts returns.
const CONTACTS = [
  { id: 1, name: "Ada Lovelace",   email: "ada@example.com",   company: "Analytical" },
  { id: 2, name: "Grace Hopper",   email: "grace@example.com", company: "Navy" },
  { id: 3, name: "alan turing",    email: "alan@example.com",  company: "NPL" },
  // Imported from the old CRM in 2019; some rows never got a name back then.
  { id: 4, name: null,             email: "k.zuse@example.com", company: "Zuse KG" },
  { id: 5, name: "Jean Bartik",    email: "jean@example.com",  company: "ENIAC" },
];

function listContacts() {
  return CONTACTS;
}

module.exports = { listContacts };

function searchContacts(q) { return CONTACTS.filter((c) => c.name.includes(q)); }
module.exports.searchContacts = searchContacts;
