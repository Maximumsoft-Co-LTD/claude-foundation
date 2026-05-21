package graph

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMergeGraphs_UnionsNodesByID(t *testing.T) {
	f1 := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	f2 := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)

	fgs := []FileGraph{
		{FileID: f1, UploadedAt: t1, Graph: Graph{
			Nodes: []Node{{ID: "A", Attrs: map[string]string{"role": "source"}}, {ID: "B"}},
			Edges: []Edge{{Source: "A", Target: "B", Weight: 1.0, FileID: f1, RowIndex: 1}},
		}},
		{FileID: f2, UploadedAt: t2, Graph: Graph{
			Nodes: []Node{{ID: "B", Attrs: map[string]string{"role": "intermediary"}}, {ID: "C"}},
			Edges: []Edge{{Source: "B", Target: "C", Weight: 2.0, FileID: f2, RowIndex: 1}},
		}},
	}

	g := MergeGraphs(fgs)
	if len(g.Nodes) != 3 {
		t.Fatalf("want 3 unique nodes, got %d", len(g.Nodes))
	}
	if len(g.Edges) != 2 {
		t.Fatalf("want 2 edges, got %d", len(g.Edges))
	}

	for _, n := range g.Nodes {
		if n.ID == "B" {
			if n.Attrs["role"] != "intermediary" {
				t.Fatalf("later upload attrs should win, got %s", n.Attrs["role"])
			}
		}
	}
}

func TestMergeGraphs_TieBreakerLexicographic(t *testing.T) {
	f1 := uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	f2 := uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	tx := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	fgs := []FileGraph{
		{FileID: f2, UploadedAt: tx, Graph: Graph{Nodes: []Node{{ID: "X", Attrs: map[string]string{"k": "f2"}}}}},
		{FileID: f1, UploadedAt: tx, Graph: Graph{Nodes: []Node{{ID: "X", Attrs: map[string]string{"k": "f1"}}}}},
	}
	g := MergeGraphs(fgs)
	if len(g.Nodes) != 1 || g.Nodes[0].Attrs["k"] != "f2" {
		t.Fatalf("lex-later file id should win; got nodes=%v", g.Nodes)
	}
}
