#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (see app/.env.example)}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/.." && pwd)/backend/internal/adapters/driven/postgres/migrations"

if ! command -v goose >/dev/null 2>&1; then
  echo "goose not found on PATH; install with: go install github.com/pressly/goose/v3/cmd/goose@latest" >&2
  exit 1
fi

goose -dir "$MIGRATIONS_DIR" postgres "$DATABASE_URL" up
