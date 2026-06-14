---
name: hexagonal-backend
description: Apply hexagonal architecture (ports & adapters) to backend code. Use BEFORE writing or restructuring any backend with real business logic — services, APIs, repositories, use cases, domain models, persistence, message handling — even when the user doesn't say "hexagonal". Defines the 3-layer structure (domain / application / infrastructure), driving vs driven (primary/secondary) ports, dependency direction, persistence-model mapping, testing strategy, and common pitfalls, with TypeScript and Go (core/port/adapter) examples. Skip throwaway scripts and trivial CRUD with no real domain logic.
---

# Hexagonal Backend Architecture (Ports & Adapters)

## Why this exists

Standing preference: every backend with real domain logic uses hexagonal architecture. The goal is **resilience to requirement changes** — swapping a database, framework, broker, or external API touches only adapters, never the core. "Postgres → DynamoDB?" or "REST → gRPC?" is days in a hexagonal codebase, months in a coupled one.

## The 3 layers

### Domain (core)
- Entities, value objects, domain services, business rules
- **Zero external dependencies** — no ORM imports, no HTTP libs, no framework types, no `fetch`, no `db.query`
- Pure functions and plain types only; must compile and test in isolation

### Application (use cases)
- Orchestrates domain logic to fulfill a single user-facing intent (`PlaceOrder`, `CancelSubscription`, `RefundPayment`)
- Defines **ports** — both the *driven* interfaces it needs from outside (`OrderRepository`, `PaymentGateway`) and, optionally, the *driving* interface it offers callers (`OrderService`). See *Two kinds of ports* below.
- Depends on: domain only. Never imports infrastructure.

### Infrastructure (adapters)
Two flavors:
- **Driving adapters** (call into the application): HTTP controllers, gRPC handlers, CLI commands, message consumers, cron jobs
- **Driven adapters** (called by the application via ports): DB repositories, external API clients, message publishers, file storage, email senders

## Two kinds of ports: driving and driven

A *port* is an interface the application owns. Naming the two kinds keeps the dependency direction honest:

- **Driven (secondary) ports** — what the application *needs* from outside: `OrderRepository`, `PaymentGateway`, `Clock`. The application declares them; **driven adapters implement** them. This is what most people mean by "port".
- **Driving (primary) ports** — what the application *offers* its callers: the use-case surface (`OrderService`). **Driving adapters depend on** it. Publishing it as an interface lets several entry points (HTTP, queue, cron) share one application surface and lets you stub the application in driving-adapter tests.

Driving-port interface vs. calling the concrete use case directly is a judgement call: one caller → the concrete class is simpler ([[coding-discipline]] *simplicity-first*); many entry points (HTTP **and** queue **and** cron) → the interface earns its keep. The **Go examples below use a driving port** (`port.OrderService`); the **TypeScript ones call the concrete use case**. Both are correct — choose by how many driving adapters share the surface.

## The one rule you must not break

**Dependency direction: Infrastructure → Application → Domain**

Never the other way. Domain must compile without adapters. Application must compile without adapters. If a domain file imports anything from `adapters/` (or any concrete framework/library), the architecture is broken.

## Folder structure

### TypeScript / Node example
```
src/
  domain/
    order/
      order.ts                 # entity
      order-status.ts          # value object
      order-id.ts              # value object
      order-errors.ts          # domain errors
  application/
    ports/
      order-repository.ts      # driven port (interface)
      payment-gateway.ts       # driven port (interface)
      clock.ts                 # driven port — even time is a port
    use-cases/
      place-order.ts
      cancel-order.ts
  adapters/
    driving/                   # call INTO the application
      http/
        order-controller.ts          # HTTP driving adapter
    driven/                    # called BY the application through ports
      persistence/
        postgres-order-adapter.ts    # implements OrderRepository
      payment/
        stripe-payment-adapter.ts    # implements PaymentGateway
      clock/
        system-clock-adapter.ts      # implements Clock
  config/
    composition-root.ts        # wires concrete adapters into use cases
```

### Go example (`core` / `port` / `adapter` idiom)
```
_cmd/
  main.go                      # entrypoint = composition root (wires everything)
internal/
  core/                        # the hexagon — never imports anything under adapter/
    domain/
      order.go                 # rich entity + value objects + domain errors (no tags, no infra)
    port/
      order.go                 # driving port (OrderService) + driven ports (OrderRepository, PaymentGateway)
      mock/                    # generated test doubles (optional — see Testing strategy)
    service/
      order.go                 # use case — implements the driving port
      order_test.go
  adapter/
    config/
      config.go                # env → typed config container
    handler/                   # DRIVING adapters (call INTO the application)
      http/order.go            #   depends on port.OrderService
      amqp/order.go            #   queue subscriber — also a driving adapter
    storage/                   # DRIVEN adapters (called BY the application via ports)
      postgres/
        order_repository.go    #   implements port.OrderRepository, maps model ↔ domain
    payment/
      stripe.go                #   implements port.PaymentGateway
  util/                        # cross-cutting helpers (errors, mapping)
```

> **Layout naming.** TypeScript uses `domain/ application/ adapters/`; Go uses the community `core/ port/ adapter/` idiom (all ports in one `core/port` package). Same logical rule (*The one rule you must not break*), different names — the physical layout is a style choice (see *Relation to Vertical Slice Architecture*).

## Patterns

### Domain entity (Go)
Most templates ship an anemic struct with `json`/`bson` tags. A real entity hides its fields and changes state only through methods that protect invariants.
```go
// internal/core/domain/order.go
package domain

import "errors"

// Domain errors live next to the entity, in business language — no HTTP status, no SQL codes.
var (
    ErrEmptyOrder        = errors.New("order has no line items")
    ErrInsufficientFunds = errors.New("insufficient funds")
    ErrOrderNotFound     = errors.New("order not found")
)

type (
    OrderID     string
    CustomerID  string
    OrderStatus string
)

const (
    StatusPending OrderStatus = "pending"
    StatusPaid    OrderStatus = "paid"
)

// Order is a RICH entity: unexported fields, state changes only via invariant-
// enforcing methods. No json/bson tags or infra imports (the adapter's model carries those).
type Order struct {
    id         OrderID
    customerID CustomerID
    status     OrderStatus
    total      Money
}

// NewOrder is the only way to build a valid new order; it enforces invariants.
func NewOrder(customerID string, items []LineItem) (*Order, error) {
    if len(items) == 0 {
        return nil, ErrEmptyOrder
    }
    return &Order{OrderID(newID()), CustomerID(customerID), StatusPending, sum(items)}, nil
}

func (o *Order) MarkPaid()              { o.status = StatusPaid } // behavior, not a setter
func (o *Order) ID() OrderID            { return o.id }
func (o *Order) CustomerID() CustomerID { return o.customerID }
func (o *Order) Status() OrderStatus    { return o.status }
func (o *Order) Total() Money           { return o.total }

// RehydrateOrder rebuilds from already-valid storage state, skipping invariant
// checks. Adapters use this; application code always goes through NewOrder.
func RehydrateOrder(id OrderID, c CustomerID, s OrderStatus, total Money) *Order {
    return &Order{id, c, s, total}
}

// Money/LineItem value objects, newID(), and sum() elided for brevity.
```

### Port definition (TypeScript)
```ts
// application/ports/order-repository.ts
import type { Order, OrderId } from '../../domain/order/order'

export interface OrderRepository {
  save(order: Order): Promise<void>
  findById(id: OrderId): Promise<Order | null>
  findByCustomer(customerId: CustomerId): Promise<Order[]>
}
```

### Port definition (Go)
All ports — driving and driven — live in one `core/port` package, so the dependency arrows are visible in one place.
```go
// internal/core/port/order.go
package port

import (
    "context"

    "myapp/internal/core/domain"
)

// PlaceOrderCommand is part of the driving-port contract — lives here, not in service (avoids an import cycle).
type PlaceOrderCommand struct {
    CustomerID      string
    Items           []domain.LineItem
    PaymentMethodID string
}

// Driving (primary) port — the use-case surface. Driving adapters depend on THIS, not the concrete service.
type OrderService interface {
    PlaceOrder(ctx context.Context, cmd PlaceOrderCommand) (domain.OrderID, error)
}

// Driven (secondary) ports — what the app needs; driven adapters implement them. Keep narrow (ISP).
type OrderRepository interface {
    Save(ctx context.Context, o *domain.Order) error
    FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error)
}

type PaymentGateway interface {
    Charge(ctx context.Context, amount domain.Money, methodID string) error
}
```

### Adapter (TypeScript)
```ts
// adapters/driven/persistence/postgres-order-adapter.ts
import type { Pool } from 'pg'
import type { OrderRepository } from '../../../application/ports/order-repository'
import { Order } from '../../../domain/order/order'

export class PostgresOrderAdapter implements OrderRepository {
  constructor(private readonly db: Pool) {}

  async save(order: Order): Promise<void> {
    await this.db.query(
      'INSERT INTO orders (id, status, total) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (id) DO UPDATE SET status = $2, total = $3',
      [order.id.value, order.status, order.total.amount],
    )
  }

  async findById(id: OrderId): Promise<Order | null> {
    const result = await this.db.query('SELECT * FROM orders WHERE id = $1', [id.value])
    if (result.rows.length === 0) return null
    return this.toDomain(result.rows[0])
  }

  private toDomain(row: OrderRow): Order {
    // Mapping lives in the adapter. `rehydrate` is a static factory that skips invariant checks (row is already valid).
    return Order.rehydrate({
      id: new OrderId(row.id),
      customerId: new CustomerId(row.customer_id),
      status: row.status as OrderStatus,
      total: new Money(row.total_amount, row.total_currency),
      placedAt: new Date(row.placed_at),
    })
  }
}
```

### Driven adapter — repository (Go)
The repository implements a driven port and owns the **persistence model** plus mapping to/from the domain — so storage tags and column types never leak into `core/domain`.
```go
// internal/adapter/storage/postgres/order_repository.go
package postgres

import (
    "context"
    "database/sql"
    "errors"

    "myapp/internal/core/domain"
    "myapp/internal/core/port"
)

// Compile-time check we satisfy the driven port — breaks at build, not runtime.
var _ port.OrderRepository = (*OrderRepository)(nil)

type OrderRepository struct {
    db *sql.DB
}

func NewOrderRepository(db *sql.DB) *OrderRepository {
    return &OrderRepository{db: db}
}

func (r *OrderRepository) Save(ctx context.Context, o *domain.Order) error {
    _, err := r.db.ExecContext(ctx, `
        INSERT INTO orders (id, customer_id, status, total_amount, total_currency)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
          SET status = EXCLUDED.status,
              total_amount = EXCLUDED.total_amount`,
        o.ID().String(), o.CustomerID().String(), o.Status(),
        o.Total().Amount(), o.Total().Currency(),
    )
    return err
}

func (r *OrderRepository) FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error) {
    var m orderModel
    err := r.db.QueryRowContext(ctx,
        `SELECT id, customer_id, status, total_amount, total_currency
         FROM orders WHERE id = $1`, id.String(),
    ).Scan(&m.id, &m.customerID, &m.status, &m.amount, &m.currency)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    return m.toDomain(), nil
}

// orderModel is the PERSISTENCE model — shape follows the table, stays in the adapter.
// Bigger projects give it its own `model/` sub-package.
type orderModel struct {
    id, customerID, status, currency string
    amount                           int64
}

func (m orderModel) toDomain() *domain.Order {
    // RehydrateOrder skips invariant checks — storage holds already-valid state.
    return domain.RehydrateOrder(
        domain.OrderID(m.id),
        domain.CustomerID(m.customerID),
        domain.OrderStatus(m.status),
        domain.NewMoney(m.amount, m.currency),
    )
}
```

### Use case (TypeScript)
```ts
// application/use-cases/place-order.ts
import { Order } from '../../domain/order/order'
import type { OrderRepository } from '../ports/order-repository'
import type { PaymentGateway } from '../ports/payment-gateway'

export interface PlaceOrderCommand {
  customerId: string
  items: Array<{ sku: string; qty: number }>
  paymentMethodId: string
}

export class PlaceOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: PaymentGateway,
  ) {}

  async execute(cmd: PlaceOrderCommand): Promise<OrderId> {
    const order = Order.create(cmd)                              // domain logic
    await this.payments.charge(order.total, cmd.paymentMethodId) // driven port
    order.markPaid()
    await this.orders.save(order)                               // driven port
    return order.id
  }
}
```

### Use case / service (Go)
The service implements the **driving** port and depends only on **driven** ports, never on a concrete adapter.
```go
// internal/core/service/order.go
package service

import (
    "context"

    "myapp/internal/core/domain"
    "myapp/internal/core/port"
)

// Compile-time proof the service satisfies the driving port.
var _ port.OrderService = (*OrderService)(nil)

type OrderService struct {
    orders   port.OrderRepository
    payments port.PaymentGateway
}

func NewOrderService(o port.OrderRepository, p port.PaymentGateway) *OrderService {
    return &OrderService{orders: o, payments: p}
}

func (s *OrderService) PlaceOrder(ctx context.Context, cmd port.PlaceOrderCommand) (domain.OrderID, error) {
    o, err := domain.NewOrder(cmd.CustomerID, cmd.Items)   // domain logic + invariants
    if err != nil {
        return "", err
    }
    if err := s.payments.Charge(ctx, o.Total(), cmd.PaymentMethodID); err != nil {
        return "", err                                     // driven port
    }
    o.MarkPaid()                                           // domain logic
    if err := s.orders.Save(ctx, o); err != nil {
        return "", err                                     // driven port
    }
    return o.ID(), nil
}
```

### Driving adapter (HTTP controller, TS)
```ts
// adapters/driving/http/order-controller.ts
export function orderRoutes(placeOrder: PlaceOrder) {
  return async (req: Request, res: Response) => {
    try {
      const id = await placeOrder.execute({
        customerId: req.body.customerId,
        items: req.body.items,
        paymentMethodId: req.body.paymentMethodId,
      })
      res.status(201).json({ orderId: id.value })
    } catch (e) {
      // translate domain errors → HTTP status. Translation lives here, not in use case.
      res.status(400).json({ error: e.message })
    }
  }
}
```

### Driving adapter (HTTP handler, Go)
The handler depends on `port.OrderService`, so HTTP, a queue subscriber, or a cron job can drive the same use case.
```go
// internal/adapter/handler/http/order.go
package http

import (
    "encoding/json"
    "errors"
    "net/http"

    "myapp/internal/core/domain"
    "myapp/internal/core/port"
)

type OrderHandler struct {
    orders port.OrderService // the DRIVING port, not the concrete service
}

func NewOrderHandler(orders port.OrderService) *OrderHandler {
    return &OrderHandler{orders: orders}
}

func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    // Decode into a wire-shape struct, NOT into domain types — JSON tags and the
    // request format stay in the adapter (see the persistence/wire-model pitfall).
    var body struct {
        CustomerID string `json:"customerId"`
        Items      []struct {
            SKU string `json:"sku"`
            Qty int    `json:"qty"`
        } `json:"items"`
        PaymentMethodID string `json:"paymentMethodId"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }
    items := make([]domain.LineItem, len(body.Items)) // map wire shape → domain
    for i, it := range body.Items {
        items[i] = domain.NewLineItem(it.SKU, it.Qty)
    }
    id, err := h.orders.PlaceOrder(r.Context(), port.PlaceOrderCommand{
        CustomerID:      body.CustomerID,
        Items:           items,
        PaymentMethodID: body.PaymentMethodID,
    })
    if err != nil {
        writeError(w, err) // domain/app error → HTTP status, mapping lives here
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    _ = json.NewEncoder(w).Encode(map[string]string{"orderId": id.String()})
}

func writeError(w http.ResponseWriter, err error) {
    switch {
    case errors.Is(err, domain.ErrOrderNotFound):
        http.Error(w, "not found", http.StatusNotFound)
    case errors.Is(err, domain.ErrInsufficientFunds):
        http.Error(w, "insufficient funds", http.StatusUnprocessableEntity)
    default:
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}
```

### Composition root
One place wires concrete adapters into use cases. Everywhere else, code receives ports through constructors.

```ts
// config/composition-root.ts
const db = new Pool({ /* ... */ })
const orderRepo = new PostgresOrderAdapter(db)
const payments = new StripePaymentAdapter(stripeClient)
const placeOrder = new PlaceOrder(orderRepo, payments)

app.post('/orders', orderRoutes(placeOrder))
```

```go
// _cmd/main.go — entrypoint = composition root
package main

import (
    "database/sql"
    "log"
    "net/http"

    _ "github.com/lib/pq"
    "myapp/internal/adapter/handler/amqp"
    httpadapter "myapp/internal/adapter/handler/http"
    "myapp/internal/adapter/payment/stripe"
    "myapp/internal/adapter/storage/postgres"
    "myapp/internal/core/service"
)

func main() {
    db, err := sql.Open("postgres", "...")
    if err != nil {
        log.Fatal(err)
    }

    // ## driven adapters — implement driven ports ##
    orderRepo := postgres.NewOrderRepository(db)
    payments := stripe.NewPaymentGateway( /* stripe client */ )

    // ## application — one service satisfies port.OrderService ##
    orders := service.NewOrderService(orderRepo, payments)

    // ## driving adapters — both depend on the SAME driving port ##
    go amqp.NewOrderSubscriber(orders).Start() // async: consume "order.requested"
    h := httpadapter.NewOrderHandler(orders)    // sync:  POST /orders
    http.HandleFunc("/orders", h.Create)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

## Transactions and atomicity

When a use case mutates multiple aggregates that must succeed or fail together, `repo1.save()` then `repo2.save()` leaves data inconsistent on a crash between them — but passing a raw `db.Tx` or `mongoose.ClientSession` into the use case re-couples application to infrastructure.

**Unit of Work pattern** — expose a transaction port; the use case hands it a function; the adapter runs that function in a transaction. Repositories called inside pick up the same transaction (via context, request-scoped DI, or an explicit handle).

```ts
// application/ports/unit-of-work.ts
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>
}

// application/use-cases/transfer-funds.ts
export class TransferFunds {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(cmd: TransferCommand): Promise<void> {
    await this.uow.run(async () => {
      const from = await this.accounts.findById(cmd.fromId)
      const to   = await this.accounts.findById(cmd.toId)
      from.debit(cmd.amount)        // domain logic
      to.credit(cmd.amount)
      await this.accounts.save(from)
      await this.accounts.save(to)
    })
  }
}
```

The use case knows transactions exist; it doesn't know Postgres, Mongo sessions, or savepoints. The adapter handles that.

**Crossing systems (DB + message broker)** — don't dual-write. Use a transactional outbox: persist the outgoing message in the same DB transaction as the state change, and let a separate relay process publish it. The outbox table is an adapter concern; the use case sees only `orders.save(order)` (the adapter writes both rows).

## Errors: domain → application → adapter

Errors flow outward in three flavors; each layer translates the one beneath it.

- **Domain errors** — broken business invariants, in business language: `InsufficientFundsError`, `OrderAlreadyShipped`, `EmailAlreadyTaken`. Live next to the entities that raise them. No HTTP status, no SQL code.
- **Application errors** — broken use-case preconditions that aren't domain rules: `OrderNotFound`, `Unauthorized`, `IdempotencyConflict`. Live in the application layer.
- **Infrastructure errors** — leakage from external systems: `pg.UniqueViolation`, `stripe.CardDeclined`, `dial tcp: i/o timeout`. Adapters catch the ones with domain meaning and re-raise as domain/application errors (unique constraint on `email` → `EmailAlreadyTaken`). Anything else propagates as a generic infra failure — don't pretend you can map every Postgres error code.

Driving adapters translate at the edge — domain/application errors become HTTP status codes, gRPC codes, or CLI exit codes.

```ts
// adapters/driving/http/error-handler.ts
export function toHttp(e: unknown): { status: number; body: object } {
  if (e instanceof InsufficientFundsError) return { status: 422, body: { code: 'INSUFFICIENT_FUNDS' } }
  if (e instanceof OrderNotFound)          return { status: 404, body: { code: 'NOT_FOUND' } }
  if (e instanceof Unauthorized)           return { status: 401, body: { code: 'UNAUTHORIZED' } }
  return { status: 500, body: { code: 'INTERNAL' } }
}
```

Keep this map in the driving adapter, not in the use case. The use case throws; HTTP decides the status.

## Queries that don't fit save/findById

The repository is shaped for the *write* path — `save`, `findById`, `findByCustomer`. When the read path needs pagination, projections, joins, search, or aggregate stats, forcing it through a repository turns it into a god object and loads more domain state than the screen needs. Introduce a separate **query port** that returns plain DTOs, not domain entities:

```ts
// application/ports/order-queries.ts
export interface OrderQueries {
  listByCustomer(customerId: CustomerId, page: Page): Promise<OrderSummaryDTO[]>
  searchAdminGrid(filter: AdminFilter): Promise<AdminOrderRow[]>
}
```

The adapter issues whatever SQL, view, or denormalized read it needs without dragging the domain in. The DTO lives in the application layer (part of the outward contract) but carries no behavior. This is the CQRS seam: writes go through repositories and the domain; reads go through query ports. Don't reach for it on day one — start with the repository; add a query port the moment it grows read-only methods the domain never uses.

## Testing strategy

| Layer | What to test | How |
|---|---|---|
| Domain | Business rules, invariants | Pure unit tests. No mocks. |
| Use case | Orchestration logic | Replace ports with **in-memory fakes** (preferred) or mocks |
| Adapter | Real integration | Integration tests against real DB / real HTTP / testcontainers |

**Rules:**
- Never mock the domain.
- Mock at port boundaries only — never inside the use case body.
- Prefer in-memory fake implementations over mock libraries — they're reusable across tests and force you to keep ports honest.
- Adapter tests don't mock anything inside the adapter — they test the real translation against a real dependency.

### Example: in-memory fake
```ts
// test/fakes/in-memory-order-repository.ts
export class InMemoryOrderRepository implements OrderRepository {
  private store = new Map<string, Order>()
  async save(o: Order) { this.store.set(o.id.value, o) }
  async findById(id: OrderId) { return this.store.get(id.value) ?? null }
}
```

In Go, the same fake is a struct backed by a `map` that satisfies the port — no codegen. Generated mocks (`go.uber.org/mock`/gomock under `core/port/mock/`) with table-driven tests give the same isolation, but treat them as a **secondary** style for teams that already use them — a hand-written fake stays reusable and keeps the port honest without a generator step.

## Common pitfalls (read this before writing code)

- ❌ **ORM model in domain** — importing `@prisma/client` or `gorm.Model` into a domain file. Leaks infrastructure into core. Use plain types in domain; map at the adapter.
- ❌ **Domain entity doubling as the DB/JSON model** — putting `json:`/`bson:`/`gorm:` tags on a domain type, or reusing the entity as the table row / wire shape. Couples the core to storage and transport formats and usually drags in an anemic, all-public struct. Keep a separate persistence model in the adapter (`storage/postgres` `orderModel`, or a `model/` sub-package) and map it ↔ domain.
- ❌ **Use case returning DB rows or framework types** — should return domain types or primitives. The driving adapter translates to HTTP/JSON.
- ❌ **Domain calling out** — `fetch()`, `db.query()`, `redis.get()` inside domain. Always invert via a port.
- ❌ **Adapter doing business logic** — adapters only translate (DB row ↔ entity, HTTP body ↔ command). Logic stays in use case or domain.
- ❌ **One mega-port** — `interface DataStore { saveOrder, saveUser, savePayment, ... }`. Keep ports narrow and use-case-focused (Interface Segregation Principle).
- ❌ **Hidden time/randomness in domain** — `new Date()` or `Math.random()` in domain. Inject a `Clock` port and a `Random` port. Makes tests deterministic.
- ❌ **Use case depending on framework** — no `express.Request` in use case signatures. Use case takes plain command objects.
- ❌ **Anemic domain** — entities with only getters/setters. Push behavior into the entity (`order.cancel()`, `subscription.renew()`).
- ❌ **Skipping the composition root** — instantiating adapters inside use cases (`new PostgresRepo()`). Always inject via constructor.

## Workflow when starting a new backend feature

1. **Name the use case.** One verb + noun. `PlaceOrder`, `RefundPayment`, `ResetPassword`.
2. **Sketch the domain.** What entities/value objects exist? What invariants must hold?
3. **List the ports.** Each external dependency = one narrow *driven* port. If more than one entry point (HTTP, queue, cron) will invoke the use case, give it a *driving* port too.
4. **Write the use case** against ports. No real adapters yet.
5. **Write domain + use case tests** with in-memory fakes for ports.
6. **Implement adapters.** Real DB, HTTP client, broker.
7. **Wire the composition root.**
8. **Write adapter integration tests** against real dependencies.

## When NOT to apply strictly

- Throwaway scripts, one-shot migrations, prototypes meant to be deleted
- Trivial CRUD with no real business rules (a glorified spreadsheet)
- Very thin BFFs (backend-for-frontend) that only forward and reshape responses

For everything else — business rules, multiple data sources, or any chance of changing requirements — apply by default.

**Ports are not the speculative abstraction [[coding-discipline]]'s *simplicity-first* warns against.** That rule says "no abstraction for a single call site"; a port is the *deliberate* seam that buys requirement-change resilience, so it earns its keep wherever this skill applies. The skip-list above is where simplicity-first wins instead — trivial CRUD and thin BFFs don't need the port.

## Relation to Vertical Slice Architecture

A common critique of Clean / Hexagonal / Onion: strict layering fragments one feature across `domain/`, `application/`, and `infrastructure/`, so a one-line change touches three places. **Vertical Slice Architecture (VSA)** organizes by feature instead: one folder per use case (`features/place-order/`) *containing* the handler, request/response types, validation, and persistence call, with hexagonal seams only where they earn their cost.

Treat VSA as **complementary, not competing**:

- Same goals: low coupling, testable units, clear seams.
- VSA's per-feature folder is a *physical layout choice*; hexagonal's dependency direction is a *logical invariant*. They compose: organize by feature, but keep domain types pure and inject dependencies through ports inside the slice.
- CRUD-heavy / read-mostly services → lean VSA; ports/adapters across many layers is overkill for one query and one mapping.
- Real invariants, multi-aggregate transactions, or many adapters per use case → hexagonal-internal layering pays off, and the VSA folder structure still works on top of it.

In short: the **logical layering rule** (domain has zero external dependencies; ports define the interface; adapters depend inward) is load-bearing. Expressing it as `domain/`/`application/`/`infrastructure/` folders or feature-scoped slices is a style choice.

## How to use this skill in a conversation

Always-on for backend work with real domain logic (per `.claude/rules/hexagonal-backend.md`) — don't ask the user to opt in. If the task matches "When NOT to apply strictly", say so in one sentence and proceed without hexagonal.

When the skill applies:
- **Starting fresh** — propose the folder structure first, then sketch domain entities and ports before code.
- **Refactoring** — classify existing code into domain / application / infrastructure; migrate one use case at a time. Name domain logic tangled in a controller or repository before extracting it.
- **Writing code** — follow the patterns above. On a non-obvious call (a `Clock` port, splitting a repository, a unit-of-work, a query port), say *why* in one sentence. Cite relevant pitfalls — don't emit code silently.
