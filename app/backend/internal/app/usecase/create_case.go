package usecase

import (
	"context"
	"log/slog"

	"github.com/cib/app/backend/internal/app/ports"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

type CreateCase struct {
	repo ports.CaseRepository
}

func NewCreateCase(repo ports.CaseRepository) *CreateCase {
	return &CreateCase{repo: repo}
}

func (uc *CreateCase) Run(ctx context.Context, title, notes string, tags []string) (casedom.Case, error) {
	c, err := casedom.NewCase(title, notes, tags)
	if err != nil {
		return casedom.Case{}, err
	}
	if err := uc.repo.Create(ctx, c); err != nil {
		return casedom.Case{}, err
	}
	LoggerFrom(ctx).Info("case.created",
		slog.String("case_id", c.ID.String()),
		slog.Int("title_len", len(c.Title)),
		slog.Int("tags_count", len(c.Tags)),
	)
	return c, nil
}
