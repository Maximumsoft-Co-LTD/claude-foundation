# CIB data analytics webapp

Case-based investigative data-exploration tool. Analysts create a case, upload one or more xlsx files (bank statement / crypto / phone-call records / travel records), map each file's columns to `source` / `target` / `weight`, and explore the resulting network chart.

## Quickstart

Preconditions: `docker`, `docker compose`, `make`, `go 1.22+`, `node 20+`.

```
cp .env.example .env
make up
make migrate
open http://localhost:3000
```

The data-explorer is at `/cases`. Create a case, open it, click "Upload xlsx".

## Fixture walkthrough

Four synthetic fixtures live under `backend/internal/adapters/driven/xlsx/testdata/`:

| fixture | source → target | weight | notes |
|---------|-----------------|--------|-------|
| `bank.xlsx` | `sender` → `receiver` | `amount` | synthetic bank statement |
| `crypto.xlsx` | `from_wallet` → `to_wallet` | `amount_btc` | synthetic crypto statement |
| `phone.xlsx` | `ผู้โทร` → `ผู้รับ` | `ระยะเวลา_วินาที` | ประวัติการโทร |
| `travel.xlsx` | `ต้นทาง` → `ปลายทาง` | (none — defaults to 1.0) | ประวัติการเดินทาง |

`bash scripts/smoke.sh` walks all four through case-create → upload → mapping → chart-render and exercises the 12 acceptance criteria.

## Architecture

Hexagonal Go backend + Next.js App Router frontend + Postgres. ClickHouse and PuppyGraph are provisioned in `docker-compose.yml` under `profiles: ["v2"]` and are dormant in v1.

- `backend/internal/domain/` — Case, Graph, Node, Edge, ColumnMapping, sentinel errors.
- `backend/internal/app/ports/` — repository + parser ports (`CaseRepository`, `FileRepository`, `GraphRepository`, `XlsxParser`, `GraphStore`).
- `backend/internal/app/usecase/` — 11 use cases (create/update/archive/list cases, upload + map + parse files, toggle, combined graph, node detail, export json).
- `backend/internal/adapters/driven/postgres/` — pgx-backed repositories + migrations (goose).
- `backend/internal/adapters/driven/xlsx/` — excelize-backed parser + four synthetic fixtures.
- `backend/internal/adapters/driven/puppygraph/` — v1 stub that logs once.
- `backend/internal/adapters/driving/http/` — chi router, middleware (request-id, logging, error mapping), handlers, prometheus metrics.
- `backend/cmd/api/` — composition root.
- `frontend/app/` — 5 pages (`/cases`, `/cases/new`, `/cases/[id]`, `/cases/[id]/edit`, `/cases/[id]/upload`).
- `frontend/components/` — 11 components (CaseCard, CaseFilters, NetworkChart, NodeDetailPanel, WeightSlider, FileToggleList, ExportButtons, ColumnMappingForm, MarkdownView, ErrorBanner+EmptyState, LoadingSkeleton).
- `frontend/lib/api.ts` — typed fetch client.

Detailed plan + acceptance criteria live in `../.workflow/0003-feat-cib-data-analytics/`.

## Environment variables

| var | default | purpose |
|-----|---------|---------|
| `POSTGRES_USER` | `cib` | postgres role |
| `POSTGRES_PASSWORD` | `cib` | postgres password |
| `POSTGRES_DB` | `cib` | database name |
| `POSTGRES_HOST` | `localhost` | host for local dev |
| `POSTGRES_PORT` | `5432` | postgres port |
| `DATABASE_URL` | derived | full pg DSN (used by `goose` and the api container) |
| `API_PORT` | `8080` | Go API listen port |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8080` | base for browser-side fetches |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | `default` / `` | dormant in v1 |
| `PUPPYGRAPH_USER` / `PUPPYGRAPH_PASSWORD` | `puppygraph` / `puppygraph123` | dormant in v1 |

## Troubleshooting

- **Port conflicts**: `5432`, `8080`, `3000` must be free. Change `API_PORT` in `.env` and restart `make up`.
- **Fresh DB reset**: `docker compose down -v` removes the postgres volume. Re-run `make up && make migrate`.
- **`goose` missing on PATH**: `go install github.com/pressly/goose/v3/cmd/goose@latest` and ensure `$GOPATH/bin` is on PATH.
- **PuppyGraph / ClickHouse log spam**: they are under `profiles: ["v2"]` and only start when you opt in (`docker compose --profile v2 up`). v1 doesn't need them.

## Tests

```
cd backend && go test ./...          # unit tests
cd frontend && npm run build          # type-check + production build
bash scripts/smoke.sh                 # end-to-end (requires stack up)
```
