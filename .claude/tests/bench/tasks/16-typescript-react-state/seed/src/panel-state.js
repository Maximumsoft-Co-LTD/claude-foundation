export function initialPanelState() {
  return { open: false, query: "", selectedId: null };
}

export function reducePanelState(state, action) {
  if (action.type === "toggle") return { ...state, open: true };
  if (action.type === "query") return { ...state, query: String(action.value) };
  if (action.type === "select") return { ...state, selectedId: action.id };
  return state;
}
