package graph

import (
	"sort"
	"time"

	"github.com/google/uuid"
)

type NodeID string

type Node struct {
	ID    NodeID
	Attrs map[string]string
}

type Edge struct {
	Source   NodeID
	Target   NodeID
	Weight   float64
	RowIndex int
	FileID   uuid.UUID
	Attrs    map[string]string
}

type Graph struct {
	Nodes []Node
	Edges []Edge
}

type FileGraph struct {
	FileID     uuid.UUID
	UploadedAt time.Time
	Graph      Graph
}

// MergeGraphs unions nodes by id and concatenates edges across files. When
// the same node id appears in multiple files, later uploads' attributes win on
// conflict (tiebreaker: file id lexicographic when uploaded_at ties). This is
// the documented merge contract.
func MergeGraphs(fgs []FileGraph) Graph {
	sorted := make([]FileGraph, len(fgs))
	copy(sorted, fgs)
	sort.Slice(sorted, func(i, j int) bool {
		if !sorted[i].UploadedAt.Equal(sorted[j].UploadedAt) {
			return sorted[i].UploadedAt.Before(sorted[j].UploadedAt)
		}
		return sorted[i].FileID.String() < sorted[j].FileID.String()
	})

	nodesByID := map[NodeID]Node{}
	var edges []Edge
	for _, fg := range sorted {
		for _, n := range fg.Graph.Nodes {
			existing, ok := nodesByID[n.ID]
			if !ok {
				nodesByID[n.ID] = cloneNode(n)
				continue
			}
			merged := cloneNode(existing)
			if merged.Attrs == nil {
				merged.Attrs = map[string]string{}
			}
			for k, v := range n.Attrs {
				merged.Attrs[k] = v
			}
			nodesByID[n.ID] = merged
		}
		edges = append(edges, fg.Graph.Edges...)
	}

	ids := make([]NodeID, 0, len(nodesByID))
	for id := range nodesByID {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	nodes := make([]Node, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, nodesByID[id])
	}
	return Graph{Nodes: nodes, Edges: edges}
}

func cloneNode(n Node) Node {
	out := Node{ID: n.ID}
	if n.Attrs != nil {
		out.Attrs = make(map[string]string, len(n.Attrs))
		for k, v := range n.Attrs {
			out.Attrs[k] = v
		}
	}
	return out
}
