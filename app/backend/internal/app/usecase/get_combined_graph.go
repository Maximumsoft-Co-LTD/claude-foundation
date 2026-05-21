package usecase

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	casedom "github.com/cib/app/backend/internal/domain/case"
	"github.com/cib/app/backend/internal/domain/graph"
)

// CaseGetter is the minimum slice of CaseRepository this use case needs so
// the missing-case precheck doesn't pull the full repo interface into tests.
type CaseGetter interface {
	Get(ctx context.Context, id uuid.UUID) (casedom.Case, error)
}

type CombinedGraphResult struct {
	Graph     graph.Graph
	Conflicts []graph.MergeConflict
}

type GetCombinedGraph struct {
	graphs ports.GraphRepository
	cases  CaseGetter
}

func NewGetCombinedGraph(graphs ports.GraphRepository, cases CaseGetter) *GetCombinedGraph {
	return &GetCombinedGraph{graphs: graphs, cases: cases}
}

func (uc *GetCombinedGraph) Run(ctx context.Context, caseID uuid.UUID) (CombinedGraphResult, error) {
	if _, err := uc.cases.Get(ctx, caseID); err != nil {
		return CombinedGraphResult{}, err
	}
	fgs, err := uc.graphs.GetByCase(ctx, caseID)
	if err != nil {
		return CombinedGraphResult{}, err
	}
	g, conflicts := graph.MergeGraphs(fgs)
	if len(conflicts) > 0 {
		LoggerFrom(ctx).Info("graph.merge_conflicts",
			slog.String("case_id", caseID.String()),
			slog.Int("conflict_count", len(conflicts)),
		)
	}
	return CombinedGraphResult{Graph: g, Conflicts: conflicts}, nil
}
