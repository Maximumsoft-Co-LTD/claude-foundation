package ports

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/domain/graph"
)

type File struct {
	ID         uuid.UUID
	CaseID     uuid.UUID
	Filename   string
	Blob       []byte
	ByteSize   int
	SHA256     string
	UploadedBy string
	UploadedAt time.Time
	Included   bool
	Headers    []string
	Mapping    *graph.ColumnMapping
}

type FileRepository interface {
	Save(ctx context.Context, f File) error
	Get(ctx context.Context, id uuid.UUID) (File, error)
	ListByCase(ctx context.Context, caseID uuid.UUID) ([]File, error)
	SetIncluded(ctx context.Context, id uuid.UUID, included bool) error
	SetMapping(ctx context.Context, id uuid.UUID, m graph.ColumnMapping) error
}
