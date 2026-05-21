package usecase

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain/graph"
)

type ExportedGraph struct {
	Nodes     []graph.Node          `json:"nodes"`
	Edges     []graph.Edge          `json:"edges"`
	Conflicts []graph.MergeConflict `json:"conflicts,omitempty"`
}

type ExportGraphJSON struct {
	graphs ports.GraphRepository
	cases  CaseGetter
}

func NewExportGraphJSON(graphs ports.GraphRepository, cases CaseGetter) *ExportGraphJSON {
	return &ExportGraphJSON{graphs: graphs, cases: cases}
}

func (uc *ExportGraphJSON) Run(ctx context.Context, caseID uuid.UUID) (ExportedGraph, error) {
	if _, err := uc.cases.Get(ctx, caseID); err != nil {
		return ExportedGraph{}, err
	}
	fgs, err := uc.graphs.GetByCase(ctx, caseID)
	if err != nil {
		return ExportedGraph{}, err
	}
	g, conflicts := graph.MergeGraphs(fgs)
	LoggerFrom(ctx).Info("graph.exported",
		slog.String("case_id", caseID.String()),
		slog.String("format", "json"),
		slog.Int("node_count", len(g.Nodes)),
		slog.Int("edge_count", len(g.Edges)),
		slog.Int("conflict_count", len(conflicts)),
	)
	return ExportedGraph{Nodes: g.Nodes, Edges: g.Edges, Conflicts: conflicts}, nil
}
