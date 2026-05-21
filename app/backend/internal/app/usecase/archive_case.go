package usecase

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
)

type ArchiveCase struct {
	repo ports.CaseRepository
}

func NewArchiveCase(repo ports.CaseRepository) *ArchiveCase { return &ArchiveCase{repo: repo} }

func (uc *ArchiveCase) Run(ctx context.Context, id uuid.UUID) error {
	c, err := uc.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	c.Archive()
	if err := uc.repo.Update(ctx, c); err != nil {
		return err
	}
	LoggerFrom(ctx).Info("case.archived", slog.String("case_id", c.ID.String()))
	return nil
}
