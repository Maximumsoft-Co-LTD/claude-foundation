package usecase

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	casedom "github.com/cib/app/backend/internal/domain/case"
	"github.com/cib/app/backend/internal/app/ports"
)

type UpdateCasePatch struct {
	Title  *string
	Notes  *string
	Tags   *[]string
	Status *casedom.CaseStatus
}

type UpdateCase struct {
	repo ports.CaseRepository
}

func NewUpdateCase(repo ports.CaseRepository) *UpdateCase { return &UpdateCase{repo: repo} }

func (uc *UpdateCase) Run(ctx context.Context, id uuid.UUID, patch UpdateCasePatch) (casedom.Case, error) {
	c, err := uc.repo.Get(ctx, id)
	if err != nil {
		return casedom.Case{}, err
	}
	var changed []string
	if patch.Title != nil {
		if err := c.SetTitle(*patch.Title); err != nil {
			return casedom.Case{}, err
		}
		changed = append(changed, "title")
	}
	if patch.Notes != nil {
		c.SetNotes(*patch.Notes)
		changed = append(changed, "notes")
	}
	if patch.Tags != nil {
		c.SetTags(*patch.Tags)
		changed = append(changed, "tags")
	}
	if patch.Status != nil {
		if err := c.SetStatus(*patch.Status); err != nil {
			return casedom.Case{}, err
		}
		changed = append(changed, "status")
	}
	if err := uc.repo.Update(ctx, c); err != nil {
		return casedom.Case{}, err
	}
	LoggerFrom(ctx).Info("case.updated",
		slog.String("case_id", c.ID.String()),
		slog.Any("fields_changed", changed),
	)
	return c, nil
}
