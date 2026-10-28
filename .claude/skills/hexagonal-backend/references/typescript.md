# Hexagonal backend — TypeScript / Node

Runnable companion to the [skill steps](../SKILL.md#steps);
[patterns and pitfalls](patterns-and-pitfalls.md) covers transactions,
errors, and testing. The [Go examples](go.md) use a driving port; these call
the concrete use case. Both follow [the skill's boundary diagram](../SKILL.md).

## Folder structure

```
src/
  domain/order/            # entity, value objects, domain errors
  application/
    ports/                 # driven ports: order-repository.ts, payment-gateway.ts, clock.ts
    use-cases/             # place-order.ts, cancel-order.ts
  adapters/
    driving/http/          # order-controller.ts
    driven/persistence/    # postgres-order-adapter.ts implements OrderRepository
    driven/payment/        # stripe-payment-adapter.ts implements PaymentGateway
  config/composition-root.ts
```

## Driven port and adapter

Mapping lives in the adapter; the entity never carries storage tags.

```ts
// application/ports/order-repository.ts
export interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: OrderId): Promise<Order | null>
}

// adapters/driven/persistence/postgres-order-adapter.ts
export class PostgresOrderAdapter implements OrderRepository {
  constructor(private readonly db: Pool) {}
  async save(order: Order) {
    await this.db.query('INSERT INTO orders (id, status, total) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (id) DO UPDATE SET status = $2, total = $3',
      [order.id.value, order.status, order.total.amount])
  }
  async findById(id: OrderId) {
    const { rows } = await this.db.query('SELECT * FROM orders WHERE id = $1', [id.value])
    return rows.length ? Order.rehydrate(toDomainProps(rows[0])) : null  // rehydrate skips invariant checks
  }
}
```

## Use case and driving adapter

```ts
// application/use-cases/place-order.ts
export class PlaceOrder {
  constructor(private readonly orders: OrderRepository, private readonly payments: PaymentGateway) {}
  async execute(cmd: PlaceOrderCommand): Promise<OrderId> {
    const order = Order.create(cmd)                               // domain logic
    await this.payments.charge(order.total, cmd.paymentMethodId)  // driven port
    order.markPaid()
    await this.orders.save(order)
    return order.id
  }
}

// adapters/driving/http/order-controller.ts — translation lives here, not in the use case
export const orderRoutes = (placeOrder: PlaceOrder) => async (req: Request, res: Response) => {
  try {
    const id = await placeOrder.execute(req.body)
    res.status(201).json({ orderId: id.value })
  } catch (e) {
    const { status, body } = toHttp(e)
    res.status(status).json(body)
  }
}

export function toHttp(e: unknown): { status: number; body: object } {
  if (e instanceof InsufficientFundsError) return { status: 422, body: { code: 'INSUFFICIENT_FUNDS' } }
  if (e instanceof OrderNotFound)          return { status: 404, body: { code: 'NOT_FOUND' } }
  return { status: 500, body: { code: 'INTERNAL' } }
}
```

## Composition root

```ts
const orderRepo = new PostgresOrderAdapter(new Pool({ /* ... */ }))
const placeOrder = new PlaceOrder(orderRepo, new StripePaymentAdapter(stripeClient))
app.post('/orders', orderRoutes(placeOrder))
```

## Transactions — Unit of Work port

The use case hands the port a function; the adapter runs it in a transaction.
The use case knows transactions exist, not Postgres sessions or savepoints.

```ts
export interface UnitOfWork { run<T>(work: () => Promise<T>): Promise<T> }

export class TransferFunds {
  constructor(private readonly uow: UnitOfWork, private readonly accounts: AccountRepository) {}
  async execute(cmd: TransferCommand) {
    await this.uow.run(async () => {
      const from = await this.accounts.findById(cmd.fromId)
      const to = await this.accounts.findById(cmd.toId)
      from.debit(cmd.amount); to.credit(cmd.amount)
      await this.accounts.save(from); await this.accounts.save(to)
    })
  }
}
```

## Query port (CQRS read seam)

```ts
export interface OrderQueries {
  listByCustomer(customerId: CustomerId, page: Page): Promise<OrderSummaryDTO[]>
}
```

## Testing — in-memory fake

```ts
export class InMemoryOrderRepository implements OrderRepository {
  private store = new Map<string, Order>()
  async save(o: Order) { this.store.set(o.id.value, o) }
  async findById(id: OrderId) { return this.store.get(id.value) ?? null }
}
```
