package usecase

import (
	"context"

	casedom "github.com/cib/app/backend/internal/domain/case"
	"github.com/cib/app/backend/internal/app/ports"
)

type ListCases struct {
	repo ports.CaseRepository
}

func NewListCases(repo ports.CaseRepository) *ListCases { return &ListCases{repo: repo} }

func (uc *ListCases) Run(ctx context.Context, f casedom.CaseFilters) ([]casedom.Case, error) {
	return uc.repo.List(ctx, f)
}
