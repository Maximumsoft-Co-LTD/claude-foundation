import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const module = await import(`${pathToFileURL(resolve(root, "src/panel-state.js"))}?oracle=${Date.now()}`);
const initial = module.initialPanelState();
const opened = module.reducePanelState(initial, { type: "toggle" });
const queried = module.reducePanelState({ ...opened, query: "Ada", selectedId: "c1" },
  { type: "toggle" });
const reopened = module.reducePanelState(queried, { type: "toggle" });
const results = {
  CASE_INITIAL_CLOSED: initial.open === false ? "pass" : "fail",
  CASE_TOGGLE_OPEN: opened.open === true ? "pass" : "fail",
  CASE_TOGGLE_CLOSE: queried.open === false ? "pass" : "fail",
  CASE_STATE_PRESERVED: queried.query === "Ada" && queried.selectedId === "c1"
    ? "pass" : "fail",
  CASE_REOPEN: reopened.open === true ? "pass" : "fail"
};
process.stdout.write(JSON.stringify({ results }));
