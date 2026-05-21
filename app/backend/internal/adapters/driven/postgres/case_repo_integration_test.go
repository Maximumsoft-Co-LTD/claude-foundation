//go:build integration
// +build integration

package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	casedom "github.com/cib/app/backend/internal/domain/case"
)

// TestCaseRepo_Integration exercises the real WHERE-clause composition path
// against a live Postgres. Run with: `make test-integration` (which sets
// DATABASE_URL and the `integration` build tag).
func TestCaseRepo_Integration(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	r := NewCaseRepo(pool)

	c, _ := casedom.NewCase("integration-"+uuid.NewString(), "", []string{"fraud"})
	c.CreatedAt = time.Now().UTC()
	c.UpdatedAt = c.CreatedAt
	if err := r.Create(ctx, c); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := r.Get(ctx, c.ID)
	if err != nil || got.ID != c.ID {
		t.Fatalf("get: %v / %v", err, got)
	}

	cs, err := r.List(ctx, casedom.CaseFilters{TitleSubstring: "integration-"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(cs) == 0 {
		t.Fatal("list with title substring returned nothing")
	}
}
