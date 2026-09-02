export function applyOrderCharged(state, event) {
  if (event.type !== "order.charged" || event.version !== 2)
    throw new Error("unsupported order event");
  if (state.processed.includes(event.eventId)) return state;
  return {
    processed: [...state.processed, event.eventId],
    balances: { ...state.balances, [event.orderId]: event.totalCents }
  };
}
