# Migrations

Tool: [`goose`](https://github.com/pressly/goose) (go-native binary).

Install:
```
go install github.com/pressly/goose/v3/cmd/goose@latest
```

Run up:
```
goose -dir . postgres "$DATABASE_URL" up
```

Run down:
```
goose -dir . postgres "$DATABASE_URL" down
```

Expand-only: every migration is additive. Down-migrations are provided for full rollback.
