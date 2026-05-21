package graph

import (
	"errors"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
)

type NodeID string

type Node struct {
	ID    NodeID            `json:"id"`
	Attrs map[string]string `json:"attrs,omitempty"`
}

type Edge struct {
	Source   NodeID            `json:"source"`
	Target   NodeID            `json:"target"`
	Weight   float64           `json:"weight"`
	RowIndex int               `json:"row_index"`
	FileID   uuid.UUID         `json:"file_id"`
	Attrs    map[string]string `json:"attrs,omitempty"`
}

type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

type FileGraph struct {
	FileID     uuid.UUID `json:"file_id"`
	UploadedAt time.Time `json:"uploaded_at"`
	Graph      Graph     `json:"graph"`
}

type MergeConflict struct {
	NodeID    NodeID    `json:"node_id"`
	Key       string    `json:"key"`
	OldValue  string    `json:"old_value"`
	NewValue  string    `json:"new_value"`
	OldFileID uuid.UUID `json:"old_file_id"`
	NewFileID uuid.UUID `json:"new_file_id"`
}

var (
	ErrEmptyNodeID    = errors.New("edge: node id cannot be empty")
	ErrSelfLoop       = errors.New("edge: source and target must differ")
	ErrNegativeWeight = errors.New("edge: weight must be >= 0")
	ErrInvalidWeight  = errors.New("edge: weight must be a finite number")
)

func NewEdge(src, tgt NodeID, weight float64, rowIdx int, fileID uuid.UUID) (Edge, error) {
	if src == "" || tgt == "" {
		return Edge{}, ErrEmptyNodeID
	}
	if src == tgt {
		return Edge{}, ErrSelfLoop
	}
	if math.IsNaN(weight) || math.IsInf(weight, 0) {
		return Edge{}, ErrInvalidWeight
	}
	if weight < 0 {
		return Edge{}, ErrNegativeWeight
	}
	return Edge{Source: src, Target: tgt, Weight: weight, RowIndex: rowIdx, FileID: fileID}, nil
}

// MergeGraphs unions nodes by id and concatenates edges across files. Order is
// (uploaded_at asc, file_id asc). On node-attribute conflicts the later upload
// in that order wins; each overwrite is recorded in the returned []MergeConflict
// (with the prior owning file id) so callers can surface ambiguities.
func MergeGraphs(fgs []FileGraph) (Graph, []MergeConflict) {
	sorted := make([]FileGraph, len(fgs))
	copy(sorted, fgs)
	sort.Slice(sorted, func(i, j int) bool {
		if !sorted[i].UploadedAt.Equal(sorted[j].UploadedAt) {
			return sorted[i].UploadedAt.Before(sorted[j].UploadedAt)
		}
		return sorted[i].FileID.String() < sorted[j].FileID.String()
	})

	type nodeOwner struct {
		node   Node
		fileID uuid.UUID
	}
	owners := map[NodeID]nodeOwner{}
	var conflicts []MergeConflict
	var edges []Edge
	for _, fg := range sorted {
		for _, n := range fg.Graph.Nodes {
			existing, ok := owners[n.ID]
			if !ok {
				owners[n.ID] = nodeOwner{node: cloneNode(n), fileID: fg.FileID}
				continue
			}
			merged := cloneNode(existing.node)
			if merged.Attrs == nil && len(n.Attrs) > 0 {
				merged.Attrs = map[string]string{}
			}
			for k, v := range n.Attrs {
				if old, present := merged.Attrs[k]; present && old != v {
					conflicts = append(conflicts, MergeConflict{
						NodeID:    n.ID,
						Key:       k,
						OldValue:  old,
						NewValue:  v,
						OldFileID: existing.fileID,
						NewFileID: fg.FileID,
					})
				}
				merged.Attrs[k] = v
			}
			owners[n.ID] = nodeOwner{node: merged, fileID: fg.FileID}
		}
		edges = append(edges, fg.Graph.Edges...)
	}

	ids := make([]NodeID, 0, len(owners))
	for id := range owners {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	nodes := make([]Node, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, owners[id].node)
	}
	return Graph{Nodes: nodes, Edges: edges}, conflicts
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
