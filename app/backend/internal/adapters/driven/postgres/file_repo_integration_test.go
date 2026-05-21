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

	"github.com/cib/app/backend/internal/app/ports"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

func TestFileRepo_Integration_SaveAndGet(t *testing.T) {
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

	cr := NewCaseRepo(pool)
	fr := NewFileRepo(pool)

	c, _ := casedom.NewCase("file-integration-"+uuid.NewString(), "", nil)
	c.CreatedAt = time.Now().UTC()
	c.UpdatedAt = c.CreatedAt
	if err := cr.Create(ctx, c); err != nil {
		t.Fatalf("seed case: %v", err)
	}

	f := ports.File{
		ID:         uuid.New(),
		CaseID:     c.ID,
		Filename:   "f.xlsx",
		Blob:       []byte{1, 2, 3},
		ByteSize:   3,
		SHA256:     "deadbeef",
		UploadedBy: "analyst",
		UploadedAt: time.Now().UTC(),
		Included:   true,
		Headers:    []string{"a", "b"},
	}
	if err := fr.Save(ctx, f); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := fr.Get(ctx, f.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Filename != f.Filename || len(got.Headers) != 2 {
		t.Fatalf("unexpected: %+v", got)
	}
}
