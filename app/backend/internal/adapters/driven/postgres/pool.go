package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	cfg.ConnConfig.ConnectTimeout = 30 * time.Second

	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return pgxpool.NewWithConfig(cctx, cfg)
}
