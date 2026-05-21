package graph

import "testing"

func TestFilterEdgesByWeight(t *testing.T) {
	g := Graph{
		Nodes: []Node{{ID: "A"}, {ID: "B"}, {ID: "C"}, {ID: "D"}},
		Edges: []Edge{
			{Source: "A", Target: "B", Weight: 1.0},
			{Source: "B", Target: "C", Weight: 5.0},
			{Source: "C", Target: "D", Weight: 10.0},
		},
	}
	filtered := FilterEdgesByWeight(g, 5.0)
	if len(filtered.Edges) != 2 {
		t.Fatalf("want 2 edges, got %d", len(filtered.Edges))
	}
	if len(filtered.Nodes) != 3 {
		t.Fatalf("want 3 nodes (B,C,D), got %d", len(filtered.Nodes))
	}
}
