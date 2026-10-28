# Hexagonal backend — Go (`core` / `port` / `adapter` idiom)

Runnable companion to the [skill steps](../SKILL.md#steps). Ports live in one
`core/port` package and the handler depends on a **driving port**; the
[TypeScript examples](typescript.md) call the concrete use case. Both follow
the dependency direction in [the skill's boundary diagram](../SKILL.md); the folder
layout is a style choice ([vertical slices](patterns-and-pitfalls.md#relation-to-vertical-slice-architecture)).

## Folder structure

```
cmd/main.go                  # composition root
internal/
  core/                      # the hexagon — never imports adapter/
    domain/order.go          # rich entity, value objects, domain errors (no tags, no infra)
    port/order.go            # driving port (OrderService) + driven ports (OrderRepository, PaymentGateway)
    service/order.go         # use case — implements the driving port
  adapter/
    handler/http/order.go    # driving adapter — depends on port.OrderService
    storage/postgres/order_repository.go   # driven adapter — implements port.OrderRepository
    payment/stripe.go        # implements port.PaymentGateway
```

## Domain entity

Unexported fields, state changes only through invariant-enforcing methods, no
`json`/`bson` tags. `NewOrder` is the only way to build a valid new instance;
`RehydrateOrder` rebuilds already-valid storage state for adapters.

```go
package domain

var ErrEmptyOrder = errors.New("order has no line items")

type Order struct {
    id         OrderID
    customerID CustomerID
    status     OrderStatus
    total      Money
}

func NewOrder(customerID string, items []LineItem) (*Order, error) {
    if len(items) == 0 {
        return nil, ErrEmptyOrder
    }
    return &Order{OrderID(newID()), CustomerID(customerID), StatusPending, sum(items)}, nil
}

func (o *Order) MarkPaid() { o.status = StatusPaid } // behavior, not a setter

func RehydrateOrder(id OrderID, c CustomerID, s OrderStatus, total Money) *Order {
    return &Order{id, c, s, total}
}
```

## Ports

```go
package port

type PlaceOrderCommand struct {
    CustomerID, PaymentMethodID string
    Items                       []domain.LineItem
}

// Driving port: the use-case surface driving adapters depend on.
type OrderService interface {
    PlaceOrder(ctx context.Context, cmd PlaceOrderCommand) (domain.OrderID, error)
}

// Driven ports: what the application needs, kept narrow.
type OrderRepository interface {
    Save(ctx context.Context, o *domain.Order) error
    FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error)
}

type PaymentGateway interface {
    Charge(ctx context.Context, amount domain.Money, methodID string) error
}
```

## Driven adapter (repository)

Owns the persistence model and the mapping; `var _ port.OrderRepository =
(*OrderRepository)(nil)` catches drift at compile time.

```go
func (r *OrderRepository) FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error) {
    var m orderModel // persistence model: shape follows the table, stays in the adapter
    err := r.db.QueryRowContext(ctx,
        `SELECT id, customer_id, status, total_amount, total_currency FROM orders WHERE id = $1`,
        id.String()).Scan(&m.id, &m.customerID, &m.status, &m.amount, &m.currency)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    return domain.RehydrateOrder(domain.OrderID(m.id), domain.CustomerID(m.customerID),
        domain.OrderStatus(m.status), domain.NewMoney(m.amount, m.currency)), nil
}
```

## Use case

Implements the driving port, depends only on driven ports.

```go
type OrderService struct {
    orders   port.OrderRepository
    payments port.PaymentGateway
}

func (s *OrderService) PlaceOrder(ctx context.Context, cmd port.PlaceOrderCommand) (domain.OrderID, error) {
    o, err := domain.NewOrder(cmd.CustomerID, cmd.Items)
    if err != nil {
        return "", err
    }
    if err := s.payments.Charge(ctx, o.Total(), cmd.PaymentMethodID); err != nil {
        return "", err
    }
    o.MarkPaid()
    if err := s.orders.Save(ctx, o); err != nil {
        return "", err
    }
    return o.ID(), nil
}
```

## Driving adapter (HTTP)

Decodes into a wire-shape struct, maps to a command, translates errors here.

```go
func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
    var body struct {
        CustomerID      string `json:"customerId"`
        Items           []struct{ SKU string `json:"sku"`; Qty int `json:"qty"` } `json:"items"`
        PaymentMethodID string `json:"paymentMethodId"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }
    items := make([]domain.LineItem, len(body.Items))
    for i, it := range body.Items {
        items[i] = domain.NewLineItem(it.SKU, it.Qty)
    }
    id, err := h.orders.PlaceOrder(r.Context(), port.PlaceOrderCommand{
        CustomerID: body.CustomerID, Items: items, PaymentMethodID: body.PaymentMethodID})
    if err != nil {
        writeError(w, err) // errors.Is(err, domain.ErrInsufficientFunds) → 422, default → 500
        return
    }
    w.WriteHeader(http.StatusCreated)
    _ = json.NewEncoder(w).Encode(map[string]string{"orderId": id.String()})
}
```

## Composition root and testing

```go
func main() {
    db, _ := sql.Open("postgres", "...")
    orders := service.NewOrderService(postgres.NewOrderRepository(db), stripe.NewPaymentGateway())
    go amqp.NewOrderSubscriber(orders).Start()      // both driving adapters share one port
    http.HandleFunc("/orders", httpadapter.NewOrderHandler(orders).Create)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

A hand-written in-memory fake (a struct backed by a `map`) stays reusable
without a generator step; generated mocks (`go.uber.org/mock`) with
table-driven tests are a secondary style.
