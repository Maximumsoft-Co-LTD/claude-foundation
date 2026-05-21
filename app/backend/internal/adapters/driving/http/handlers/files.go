package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/adapters/driving/http/metrics"
	"github.com/cib/app/backend/internal/adapters/driving/http/middleware"
	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/app/usecase"
	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

type FilesHandler struct {
	upload *usecase.UploadFile
	setMap *usecase.SetMappingAndParse
	toggle *usecase.ToggleFileIncluded
	files  ports.FileRepository
}

func NewFilesHandler(upload *usecase.UploadFile, setMap *usecase.SetMappingAndParse, toggle *usecase.ToggleFileIncluded, files ports.FileRepository) *FilesHandler {
	return &FilesHandler{upload: upload, setMap: setMap, toggle: toggle, files: files}
}

// MaxMultipartBytes is the hard upper bound on the entire multipart-form request
// body via http.MaxBytesReader. Sized at MaxFileBytes + 1 MiB slack to comfortably
// fit the boundary headers and any per-part metadata; ParseMultipartForm uses this
// same value as the in-memory threshold (per-part overflow spills to a temp file,
// which we then read via io.ReadAll).
const MaxMultipartBytes = 6 * 1024 * 1024

type uploadFileResponse struct {
	FileID  string   `json:"file_id"`
	Headers []string `json:"headers"`
}

func (h *FilesHandler) Upload(w http.ResponseWriter, r *http.Request) {
	caseID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxMultipartBytes)
	if err := r.ParseMultipartForm(MaxMultipartBytes); err != nil {
		var maxErr *http.MaxBytesError
		switch {
		case asMaxBytes(err, &maxErr):
			middleware.WriteError(w, domain.ErrTooLarge)
		default:
			middleware.WriteError(w, domain.ErrInvalidMultipart)
		}
		metrics.FilesUploaded.WithLabelValues("rejected_multipart").Inc()
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		middleware.WriteError(w, domain.ErrInvalidMultipart)
		metrics.FilesUploaded.WithLabelValues("rejected_multipart").Inc()
		return
	}
	defer func() { _ = file.Close() }()
	blob, err := io.ReadAll(file)
	if err != nil {
		middleware.WriteError(w, err)
		metrics.FilesUploaded.WithLabelValues("rejected_io").Inc()
		return
	}
	res, err := h.upload.Run(r.Context(), caseID, header.Filename, blob)
	if err != nil {
		middleware.WriteError(w, err)
		metrics.FilesUploaded.WithLabelValues("rejected").Inc()
		return
	}
	metrics.FilesUploaded.WithLabelValues("ok").Inc()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(uploadFileResponse{FileID: res.FileID.String(), Headers: res.Headers})
}

// asMaxBytes is a tiny errors.As wrapper kept inline so the handler stays grep-able.
func asMaxBytes(err error, target **http.MaxBytesError) bool {
	for e := err; e != nil; {
		if m, ok := e.(*http.MaxBytesError); ok {
			*target = m
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := e.(unwrapper)
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

type fileDTO struct {
	ID       string               `json:"id"`
	Filename string               `json:"filename"`
	Included bool                 `json:"included"`
	Headers  []string             `json:"headers"`
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

type setMappingResponse struct {
	NodeCount        int `json:"node_count"`
	EdgeCount        int `json:"edge_count"`
	RowsSeen         int `json:"rows_seen"`
	RowsEmitted      int `json:"rows_emitted"`
	RowsSkippedShort int `json:"rows_skipped_short"`
	RowsSkippedBlank int `json:"rows_skipped_blank"`
	WeightsUnparsed  int `json:"weights_unparsed"`
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
	t0 := time.Now()
	res, err := h.setMap.Run(r.Context(), fileID, graph.ColumnMapping{SourceCol: req.SourceCol, TargetCol: req.TargetCol, WeightCol: req.WeightCol})
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	metrics.ParseDuration.Observe(time.Since(t0).Seconds())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(setMappingResponse{
		NodeCount:        len(res.Graph.Nodes),
		EdgeCount:        len(res.Graph.Edges),
		RowsSeen:         res.Stats.RowsSeen,
		RowsEmitted:      res.Stats.RowsEmitted,
		RowsSkippedShort: res.Stats.RowsSkippedShort,
		RowsSkippedBlank: res.Stats.RowsSkippedBlank,
		WeightsUnparsed:  res.Stats.WeightsUnparsed,
	})
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
