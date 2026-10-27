export function initialState() { return { filter: '' }; }
export function reduce(state, action) {
  return action.type === 'filter' ? { ...state, filter: action.value } : state;
}
