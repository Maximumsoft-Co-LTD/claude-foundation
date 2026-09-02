# Order → billing event contract

Orders still emits the retired v1/string payload while Billing accepts only the
v2/integer contract. Upgrade the producer without weakening the consumer,
preserve duplicate-event idempotency, and add producer/consumer contract tests
that fail when the original producer is restored.
