"use strict";

function createCheckout({ track, flags }) {
  function render(user) {
    return { layout: "classic", userId: user ? user.id : null };
  }
  return { render };
}

module.exports = { createCheckout };
