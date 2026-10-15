// Known accounts. A missing or unknown X-User header is anonymous.
const USERS = {
  alice: { name: "alice", role: "member" },
  bob: { name: "bob", role: "member" },
  ada: { name: "ada", role: "admin" }
};

function authenticate(req) {
  const name = req.headers["x-user"];
  return typeof name === "string" && Object.hasOwn(USERS, name) ? USERS[name] : null;
}

module.exports = { USERS, authenticate };
