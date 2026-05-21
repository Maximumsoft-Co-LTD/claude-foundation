package middleware

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

type ErrorBody struct {
	Error string `json:"error"`
}

func WriteError(w http.ResponseWriter, err error) {
	status, msg := MapError(err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorBody{Error: msg})
}

func MapError(err error) (int, string) {
	var mbErr *http.MaxBytesError
	switch {
	case errors.Is(err, domain.ErrCaseNotFound),
		errors.Is(err, domain.ErrFileNotFound),
		errors.Is(err, domain.ErrNodeNotFound):
		return http.StatusNotFound, err.Error()
	case errors.As(err, &mbErr), errors.Is(err, domain.ErrTooLarge):
		return http.StatusRequestEntityTooLarge, "file exceeds 5 MiB limit"
	case errors.Is(err, domain.ErrInvalidMultipart):
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, domain.ErrInvalidMapping),
		errors.Is(err, domain.ErrEmptyXlsx),
		errors.Is(err, domain.ErrNotXlsx),
		errors.Is(err, casedom.ErrTitleRequired):
		return http.StatusBadRequest, err.Error()
	case errors.Is(err, casedom.ErrBadStatus):
		return http.StatusUnprocessableEntity, err.Error()
	default:
		return http.StatusInternalServerError, "internal error"
	}
}
