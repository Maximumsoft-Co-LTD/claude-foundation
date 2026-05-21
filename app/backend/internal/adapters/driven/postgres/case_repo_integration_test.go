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

// TestCaseRepo_Integration_FilterTags pins the `tags && $N` overlap branch of
// CaseRepo.List against real Postgres: a case tagged {"fraud","cyber"} must be
// returned by a filter requesting {"cyber"}, and a case tagged {"drug"} must
// not. The fake repo in usecase_test.go reimplements this semantically, so the
// real WHERE clause needs its own assertion.
func TestCaseRepo_Integration_FilterTags(t *testing.T) {
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

	marker := "tagfilter-" + uuid.NewString()
	cFraud, _ := casedom.NewCase(marker+"-fraud", "", []string{"fraud", "cyber"})
	cDrug, _ := casedom.NewCase(marker+"-drug", "", []string{"drug"})
	now := time.Now().UTC()
	for _, c := range []*casedom.Case{&cFraud, &cDrug} {
		c.CreatedAt = now
		c.UpdatedAt = now
		if err := r.Create(ctx, *c); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	got, err := r.List(ctx, casedom.CaseFilters{
		TitleSubstring: marker,
		Tags:           []string{"cyber"},
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != cFraud.ID {
		t.Fatalf("expected only the fraud-tagged case, got %d rows", len(got))
	}
}

// TestCaseRepo_Integration_FilterStatuses pins the `status = ANY($N)` branch.
// Without a Statuses filter the WHERE adds `status <> 'archived'`; with
// Statuses=[archived] the archived case must come back, and with no filter it
// must not.
func TestCaseRepo_Integration_FilterStatuses(t *testing.T) {
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

	marker := "statusfilter-" + uuid.NewString()
	cOpen, _ := casedom.NewCase(marker+"-open", "", nil)
	cArch, _ := casedom.NewCase(marker+"-arch", "", nil)
	cArch.Archive()
	now := time.Now().UTC()
	for _, c := range []*casedom.Case{&cOpen, &cArch} {
		c.CreatedAt = now
		c.UpdatedAt = now
		if err := r.Create(ctx, *c); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	defaultList, err := r.List(ctx, casedom.CaseFilters{TitleSubstring: marker})
	if err != nil {
		t.Fatalf("default list: %v", err)
	}
	if len(defaultList) != 1 || defaultList[0].ID != cOpen.ID {
		t.Fatalf("default list should exclude archived; got %d rows", len(defaultList))
	}

	archivedList, err := r.List(ctx, casedom.CaseFilters{
		TitleSubstring: marker,
		Statuses:       []casedom.CaseStatus{casedom.StatusArchived},
	})
	if err != nil {
		t.Fatalf("archived list: %v", err)
	}
	if len(archivedList) != 1 || archivedList[0].ID != cArch.ID {
		t.Fatalf("status=archived list should include the archived case; got %d rows", len(archivedList))
	}
}

// TestCaseRepo_Integration_FilterCreatedRange pins the `created_at >= $N` and
// `created_at <= $N` branches. Two cases dated 10 days apart, range bracketing
// only one of them must return only that one.
func TestCaseRepo_Integration_FilterCreatedRange(t *testing.T) {
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

	marker := "daterange-" + uuid.NewString()
	old := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	recent := time.Date(2026, 5, 21, 0, 0, 0, 0, time.UTC)
	cOld, _ := casedom.NewCase(marker+"-old", "", nil)
	cOld.CreatedAt = old
	cOld.UpdatedAt = old
	cRecent, _ := casedom.NewCase(marker+"-recent", "", nil)
	cRecent.CreatedAt = recent
	cRecent.UpdatedAt = recent
	for _, c := range []casedom.Case{cOld, cRecent} {
		if err := r.Create(ctx, c); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC)
	got, err := r.List(ctx, casedom.CaseFilters{
		TitleSubstring: marker,
		CreatedFrom:    &from,
		CreatedTo:      &to,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 || got[0].ID != cRecent.ID {
		t.Fatalf("date-range should return only the recent case; got %d rows", len(got))
	}
}
