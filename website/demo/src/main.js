import { initDeck } from "./deck.js";

document.addEventListener("DOMContentLoaded", () => {
  initDeck();
  const help = document.getElementById("help");
  document.getElementById("help-button").addEventListener("click", () => {
    help.hidden = false;
  });
});
