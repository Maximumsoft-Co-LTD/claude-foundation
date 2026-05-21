package graph

func FilterEdgesByWeight(g Graph, min float64) Graph {
	if min <= 0 {
		return g
	}
	kept := make([]Edge, 0, len(g.Edges))
	used := map[NodeID]struct{}{}
	for _, e := range g.Edges {
		if e.Weight >= min {
			kept = append(kept, e)
			used[e.Source] = struct{}{}
			used[e.Target] = struct{}{}
		}
	}
	nodes := make([]Node, 0, len(g.Nodes))
	for _, n := range g.Nodes {
		if _, ok := used[n.ID]; ok {
			nodes = append(nodes, n)
		}
	}
	return Graph{Nodes: nodes, Edges: kept}
}
