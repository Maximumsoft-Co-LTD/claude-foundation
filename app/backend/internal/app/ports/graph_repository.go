package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/domain/graph"
)

type GraphRepository interface {
	SaveFileGraph(ctx context.Context, fileID uuid.UUID, g graph.Graph) error
	GetByFile(ctx context.Context, fileID uuid.UUID) (graph.Graph, error)
	GetByCase(ctx context.Context, caseID uuid.UUID) ([]graph.FileGraph, error)
}
