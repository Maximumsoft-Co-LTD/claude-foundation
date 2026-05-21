package ports

import (
	"context"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/domain/graph"
)

// GraphStore is dormant in v1; the PuppyGraph adapter is a stub that logs once
// at startup. Documents the v2 contract: publish a per-case graph for
// downstream graph-query workloads (openCypher / Gremlin).
type GraphStore interface {
	Publish(ctx context.Context, caseID uuid.UUID, g graph.Graph) error
}
