package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain/graph"
)

type GetCombinedGraph struct {
	graphs ports.GraphRepository
}

func NewGetCombinedGraph(graphs ports.GraphRepository) *GetCombinedGraph {
	return &GetCombinedGraph{graphs: graphs}
}

func (uc *GetCombinedGraph) Run(ctx context.Context, caseID uuid.UUID) (graph.Graph, error) {
	fgs, err := uc.graphs.GetByCase(ctx, caseID)
	if err != nil {
		return graph.Graph{}, err
	}
	return graph.MergeGraphs(fgs), nil
}
