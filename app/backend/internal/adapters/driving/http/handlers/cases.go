package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/adapters/driving/http/middleware"
	"github.com/cib/app/backend/internal/app/usecase"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

type CasesHandler struct {
	create  *usecase.CreateCase
	update  *usecase.UpdateCase
	archive *usecase.ArchiveCase
	list    *usecase.ListCases
	get     *usecase.GetCase
}

type caseDTO struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Notes     string   `json:"notes"`
	Tags      []string `json:"tags"`
	Status    string   `json:"status"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

func toDTO(c casedom.Case) caseDTO {
	return caseDTO{
		ID:        c.ID.String(),
		Title:     c.Title,
		Notes:     c.Notes,
		Tags:      c.Tags,
		Status:    string(c.Status),
		CreatedAt: c.CreatedAt.Format(time.RFC3339),
		UpdatedAt: c.UpdatedAt.Format(time.RFC3339),
	}
}

func NewCasesHandler(
	create *usecase.CreateCase,
	update *usecase.UpdateCase,
	archive *usecase.ArchiveCase,
	list *usecase.ListCases,
	get *usecase.GetCase,
) *CasesHandler {
	return &CasesHandler{create: create, update: update, archive: archive, list: list, get: get}
}

type createCaseReq struct {
	Title string   `json:"title"`
	Notes string   `json:"notes"`
	Tags  []string `json:"tags"`
}

func (h *CasesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createCaseReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, err)
		return
	}
	c, err := h.create.Run(r.Context(), req.Title, req.Notes, req.Tags)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(toDTO(c))
}

func (h *CasesHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := casedom.CaseFilters{}
	if title := q.Get("title"); title != "" {
		f.TitleSubstring = title
	}
	if tag := q.Get("tag"); tag != "" {
		f.Tags = strings.Split(tag, ",")
	}
	if status := q.Get("status"); status != "" {
		for _, s := range strings.Split(status, ",") {
			f.Statuses = append(f.Statuses, casedom.CaseStatus(s))
		}
	}
	if from := q.Get("from"); from != "" {
		if t, err := time.Parse(time.RFC3339, from); err == nil {
			f.CreatedFrom = &t
		}
	}
	if to := q.Get("to"); to != "" {
		if t, err := time.Parse(time.RFC3339, to); err == nil {
			f.CreatedTo = &t
		}
	}
	cs, err := h.list.Run(r.Context(), f)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	out := make([]caseDTO, 0, len(cs))
	for _, c := range cs {
		out = append(out, toDTO(c))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *CasesHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	c, err := h.get.Run(r.Context(), id)
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toDTO(c))
}

type patchCaseReq struct {
	Title  *string             `json:"title,omitempty"`
	Notes  *string             `json:"notes,omitempty"`
	Tags   *[]string           `json:"tags,omitempty"`
	Status *casedom.CaseStatus `json:"status,omitempty"`
}

func (h *CasesHandler) Patch(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	var req patchCaseReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteError(w, err)
		return
	}
	updated, err := h.update.Run(r.Context(), id, usecase.UpdateCasePatch(req))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toDTO(updated))
}

func (h *CasesHandler) Archive(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		middleware.WriteError(w, err)
		return
	}
	if err := h.archive.Run(r.Context(), id); err != nil {
		middleware.WriteError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
