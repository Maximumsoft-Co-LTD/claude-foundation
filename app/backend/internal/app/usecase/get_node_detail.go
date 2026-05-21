package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

type NodeDetailEdge struct {
	Source   graph.NodeID `json:"source"`
	Target   graph.NodeID `json:"target"`
	Weight   float64      `json:"weight"`
	FileID   uuid.UUID    `json:"file_id"`
	Filename string       `json:"filename"`
	RowIndex int          `json:"row_index"`
}

type NodeDetail struct {
	NodeID    graph.NodeID          `json:"node_id"`
	Edges     []NodeDetailEdge      `json:"edges"`
	Conflicts []graph.MergeConflict `json:"conflicts,omitempty"`
}

type GetNodeDetail struct {
	files  ports.FileRepository
	graphs ports.GraphRepository
	cases  CaseGetter
}

func NewGetNodeDetail(files ports.FileRepository, graphs ports.GraphRepository, cases CaseGetter) *GetNodeDetail {
	return &GetNodeDetail{files: files, graphs: graphs, cases: cases}
}

func (uc *GetNodeDetail) Run(ctx context.Context, caseID uuid.UUID, nodeID graph.NodeID) (NodeDetail, error) {
	if _, err := uc.cases.Get(ctx, caseID); err != nil {
		return NodeDetail{}, err
	}
	fgs, err := uc.graphs.GetByCase(ctx, caseID)
	if err != nil {
		return NodeDetail{}, err
	}
	g, conflicts := graph.MergeGraphs(fgs)
	found := false
	for _, n := range g.Nodes {
		if n.ID == nodeID {
			found = true
			break
		}
	}
	if !found {
		return NodeDetail{}, domain.ErrNodeNotFound
	}

	files, err := uc.files.ListByCase(ctx, caseID)
	if err != nil {
		return NodeDetail{}, err
	}
	filenames := map[uuid.UUID]string{}
	for _, f := range files {
		filenames[f.ID] = f.Filename
	}

	detail := NodeDetail{NodeID: nodeID, Edges: []NodeDetailEdge{}}
	for _, e := range g.Edges {
		if e.Source != nodeID && e.Target != nodeID {
			continue
		}
		detail.Edges = append(detail.Edges, NodeDetailEdge{
			Source:   e.Source,
			Target:   e.Target,
			Weight:   e.Weight,
			FileID:   e.FileID,
			Filename: filenames[e.FileID],
			RowIndex: e.RowIndex,
		})
	}
	for _, c := range conflicts {
		if c.NodeID == nodeID {
			detail.Conflicts = append(detail.Conflicts, c)
		}
	}
	return detail, nil
}
