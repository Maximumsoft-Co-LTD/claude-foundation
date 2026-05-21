package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/adapters/driving/http/metrics"
	"github.com/cib/app/backend/internal/adapters/driving/http/middleware"
	"github.com/cib/app/backend/internal/app/usecase"
	"github.com/cib/app/backend/internal/domain/graph"
)

type GraphHandler struct {
	combined *usecase.GetCombinedGraph
	node     *usecase.GetNodeDetail
	export   *usecase.ExportGraphJSON
}

func NewGraphHandler(combined *usecase.GetCombinedGraph, node *usecase.GetNodeDetail, export *usecase.ExportGraphJSON) *GraphHandler {
	return &GraphHandler{combined: combined, node: node, export: export}
}

func (h *GraphHandler) Combined(w http.ResponseWriter, r *http.Request) {
	caseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	g, err := h.combined.Run(r.Context(), caseID)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	metrics.CombinedGraphNodes.Set(float64(len(g.Nodes)))
	metrics.CombinedGraphEdges.Set(float64(len(g.Edges)))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(g)
}

func (h *GraphHandler) Node(w http.ResponseWriter, r *http.Request) {
	caseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	nodeID := graph.NodeID(chi.URLParam(r, "nodeID"))
	d, err := h.node.Run(r.Context(), caseID, nodeID)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(d)
}

func (h *GraphHandler) ExportJSON(w http.ResponseWriter, r *http.Request) {
	caseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	out, err := h.export.Run(r.Context(), caseID)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="case-`+caseID.String()+`-graph.json"`)
	_ = json.NewEncoder(w).Encode(out)
}
