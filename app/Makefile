.PHONY: up down migrate smoke fmt test test-integration build

up:
	docker compose up -d postgres api web

down:
	docker compose down

migrate:
	bash scripts/migrate.sh

smoke: up migrate
	bash scripts/smoke.sh

fmt:
	cd backend && go fmt ./...
	cd frontend && npm run lint --silent || true

test:
	cd backend && go test ./...

test-integration:
	cd backend && DATABASE_URL=$${DATABASE_URL:-postgres://cib:cib@localhost:5432/cib?sslmode=disable} go test -tags=integration ./internal/adapters/driven/postgres/...

build:
	cd backend && go build ./...
	cd frontend && npm run build
