package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/adapters/driving/http/middleware"
	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/app/usecase"
	"github.com/cib/app/backend/internal/domain/graph"
)

type FilesHandler struct {
	upload  *usecase.UploadFile
	setMap  *usecase.SetMappingAndParse
	toggle  *usecase.ToggleFileIncluded
	files   ports.FileRepository
}

func NewFilesHandler(upload *usecase.UploadFile, setMap *usecase.SetMappingAndParse, toggle *usecase.ToggleFileIncluded, files ports.FileRepository) *FilesHandler {
	return &FilesHandler{upload: upload, setMap: setMap, toggle: toggle, files: files}
}

const maxUploadBytes = 6 * 1024 * 1024

func (h *FilesHandler) Upload(w http.ResponseWriter, r *http.Request) {
	caseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		middleware.WriteError(w, err)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	defer file.Close()
	blob, err := io.ReadAll(io.LimitReader(file, maxUploadBytes))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	res, err := h.upload.Run(r.Context(), caseID, header.Filename, blob)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"file_id": res.FileID.String(), "headers": res.Headers})
}

type fileDTO struct {
	ID       string   `json:"id"`
	Filename string   `json:"filename"`
	Included bool     `json:"included"`
	Headers  []string `json:"headers"`
	Mapping  *graph.ColumnMapping `json:"mapping,omitempty"`
}

func (h *FilesHandler) List(w http.ResponseWriter, r *http.Request) {
	caseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	files, err := h.files.ListByCase(r.Context(), caseID)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	out := make([]fileDTO, 0, len(files))
	for _, f := range files {
		out = append(out, fileDTO{
			ID: f.ID.String(), Filename: f.Filename, Included: f.Included,
			Headers: f.Headers, Mapping: f.Mapping,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

type setMappingReq struct {
	SourceCol string `json:"source_col"`
	TargetCol string `json:"target_col"`
	WeightCol string `json:"weight_col"`
}

func (h *FilesHandler) SetMapping(w http.ResponseWriter, r *http.Request) {
	fileID, err := uuid.Parse(chi.URLParam(r, "fid"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	var req setMappingReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, err)
		return
	}
	g, err := h.setMap.Run(r.Context(), fileID, graph.ColumnMapping(req))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"node_count": len(g.Nodes), "edge_count": len(g.Edges)})
}

type setIncludedReq struct {
	Included bool `json:"included"`
}

func (h *FilesHandler) SetIncluded(w http.ResponseWriter, r *http.Request) {
	fileID, err := uuid.Parse(chi.URLParam(r, "fid"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	var req setIncludedReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, err)
		return
	}
	if err := h.toggle.Run(r.Context(), fileID, req.Included); err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
