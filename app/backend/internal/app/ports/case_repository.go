package ports

import (
	"context"

	"github.com/google/uuid"

	casedom "github.com/cib/app/backend/internal/domain/case"
)

type CaseRepository interface {
	Create(ctx context.Context, c casedom.Case) error
	Get(ctx context.Context, id uuid.UUID) (casedom.Case, error)
	Update(ctx context.Context, c casedom.Case) error
	List(ctx context.Context, f casedom.CaseFilters) ([]casedom.Case, error)
}
