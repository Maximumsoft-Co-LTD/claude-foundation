package usecase

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain/graph"
)

type ExportedGraph struct {
	Nodes []graph.Node `json:"nodes"`
	Edges []graph.Edge `json:"edges"`
}

type ExportGraphJSON struct {
	graphs ports.GraphRepository
}

func NewExportGraphJSON(graphs ports.GraphRepository) *ExportGraphJSON {
	return &ExportGraphJSON{graphs: graphs}
}

func (uc *ExportGraphJSON) Run(ctx context.Context, caseID uuid.UUID) (ExportedGraph, error) {
	fgs, err := uc.graphs.GetByCase(ctx, caseID)
	if err != nil {
		return ExportedGraph{}, err
	}
	g := graph.MergeGraphs(fgs)
	LoggerFrom(ctx).Info("graph.exported",
		slog.String("case_id", caseID.String()),
		slog.String("format", "json"),
		slog.Int("node_count", len(g.Nodes)),
		slog.Int("edge_count", len(g.Edges)),
	)
	return ExportedGraph{Nodes: g.Nodes, Edges: g.Edges}, nil
}
