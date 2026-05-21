.PHONY: up down migrate smoke fmt test build

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

build:
	cd backend && go build ./...
	cd frontend && npm run build
