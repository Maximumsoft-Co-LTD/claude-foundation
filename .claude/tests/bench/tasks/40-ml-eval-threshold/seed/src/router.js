"use strict";

const classifier = require("./classifier");

const QUEUES = { billing: "billing-team", technical: "tech-support", account: "account-desk", other: "general" };

function routeTicket(text, { model = classifier } = {}) {
  const label = model.predict(text);
  return { queue: QUEUES[label], label };
}

module.exports = { routeTicket, QUEUES };
