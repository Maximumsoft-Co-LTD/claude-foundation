package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

type GetCase struct {
	repo ports.CaseRepository
}

func NewGetCase(repo ports.CaseRepository) *GetCase { return &GetCase{repo: repo} }

func (uc *GetCase) Run(ctx context.Context, id uuid.UUID) (casedom.Case, error) {
	return uc.repo.Get(ctx, id)
}
