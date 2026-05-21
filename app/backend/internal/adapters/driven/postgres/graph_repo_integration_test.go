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
	"github.com/cib/app/backend/internal/domain/graph"
)

func TestGraphRepo_Integration_SaveAndGetByCase(t *testing.T) {
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
	gr := NewGraphRepo(pool)

	c, _ := casedom.NewCase("graph-integration-"+uuid.NewString(), "", nil)
	c.CreatedAt = time.Now().UTC()
	c.UpdatedAt = c.CreatedAt
	if err := cr.Create(ctx, c); err != nil {
		t.Fatalf("seed case: %v", err)
	}
	f := ports.File{
		ID: uuid.New(), CaseID: c.ID, Filename: "f.xlsx", Blob: []byte{1},
		ByteSize: 1, SHA256: "x", UploadedBy: "analyst", UploadedAt: time.Now().UTC(),
		Included: true, Headers: []string{"a"},
	}
	if err := fr.Save(ctx, f); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	g := graph.Graph{Nodes: []graph.Node{{ID: "A"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1, FileID: f.ID, RowIndex: 2}}}
	if err := gr.SaveFileGraph(ctx, f.ID, g); err != nil {
		t.Fatalf("save graph: %v", err)
	}
	fgs, err := gr.GetByCase(ctx, c.ID)
	if err != nil {
		t.Fatalf("get by case: %v", err)
	}
	if len(fgs) != 1 || len(fgs[0].Graph.Nodes) != 1 {
		t.Fatalf("unexpected: %+v", fgs)
	}
}
