export function orderCharged(order) {
  return {
    type: "order.charged",
    version: 1,
    eventId: order.eventId,
    orderId: order.id,
    totalCents: String(order.totalCents)
  };
}
