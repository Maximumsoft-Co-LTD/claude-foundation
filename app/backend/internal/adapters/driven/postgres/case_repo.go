package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

type CaseRepo struct {
	pool *pgxpool.Pool
}

func NewCaseRepo(pool *pgxpool.Pool) *CaseRepo { return &CaseRepo{pool: pool} }

func (r *CaseRepo) Create(ctx context.Context, c casedom.Case) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO cases (id, title, notes, tags, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		c.ID, c.Title, c.Notes, c.Tags, string(c.Status), c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func (r *CaseRepo) Get(ctx context.Context, id uuid.UUID) (casedom.Case, error) {
	var c casedom.Case
	var status string
	err := r.pool.QueryRow(ctx,
		`SELECT id, title, notes, tags, status, created_at, updated_at FROM cases WHERE id = $1`, id,
	).Scan(&c.ID, &c.Title, &c.Notes, &c.Tags, &status, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return casedom.Case{}, domain.ErrCaseNotFound
	}
	if err != nil {
		return casedom.Case{}, err
	}
	c.Status = casedom.CaseStatus(status)
	return c, nil
}

func (r *CaseRepo) Update(ctx context.Context, c casedom.Case) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE cases SET title=$2, notes=$3, tags=$4, status=$5, updated_at=$6 WHERE id=$1`,
		c.ID, c.Title, c.Notes, c.Tags, string(c.Status), c.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrCaseNotFound
	}
	return nil
}

func (r *CaseRepo) List(ctx context.Context, f casedom.CaseFilters) ([]casedom.Case, error) {
	var where []string
	var args []any
	idx := 1
	if f.TitleSubstring != "" {
		where = append(where, "title ILIKE $"+itoa(idx))
		args = append(args, "%"+f.TitleSubstring+"%")
		idx++
	}
	if len(f.Tags) > 0 {
		where = append(where, "tags && $"+itoa(idx))
		args = append(args, f.Tags)
		idx++
	}
	if len(f.Statuses) > 0 {
		statusStrings := make([]string, len(f.Statuses))
		for i, s := range f.Statuses {
			statusStrings[i] = string(s)
		}
		where = append(where, "status = ANY($"+itoa(idx)+")")
		args = append(args, statusStrings)
		idx++
	} else {
		where = append(where, "status <> 'archived'")
	}
	if f.CreatedFrom != nil {
		where = append(where, "created_at >= $"+itoa(idx))
		args = append(args, *f.CreatedFrom)
		idx++
	}
	if f.CreatedTo != nil {
		where = append(where, "created_at <= $"+itoa(idx))
		args = append(args, *f.CreatedTo)
		idx++
	}

	q := `SELECT id, title, notes, tags, status, created_at, updated_at FROM cases`
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY created_at DESC"

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []casedom.Case
	for rows.Next() {
		var c casedom.Case
		var status string
		if err := rows.Scan(&c.ID, &c.Title, &c.Notes, &c.Tags, &status, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.Status = casedom.CaseStatus(status)
		out = append(out, c)
	}
	return out, rows.Err()
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	// fallback (we never reach beyond ~6 placeholders here)
	out := ""
	for i > 0 {
		out = string(rune('0'+i%10)) + out
		i /= 10
	}
	return out
}
