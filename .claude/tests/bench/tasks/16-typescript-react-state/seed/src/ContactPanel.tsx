import React, { useReducer } from "react";
import { initialPanelState, reducePanelState } from "./panel-state.js";

export function ContactPanel() {
  const [state, dispatch] = useReducer(reducePanelState, undefined, initialPanelState);
  return <section>
    <button aria-expanded={state.open} onClick={() => dispatch({ type: "toggle" })}>
      Contacts
    </button>
    {state.open && <input aria-label="Search contacts" value={state.query}
      onChange={(event) => dispatch({ type: "query", value: event.target.value })} />}
  </section>;
}
