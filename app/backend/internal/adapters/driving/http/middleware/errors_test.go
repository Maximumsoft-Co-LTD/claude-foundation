package middleware

import (
	"net/http"
	"testing"

	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

func TestErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"case-not-found", domain.ErrCaseNotFound, http.StatusNotFound},
		{"file-not-found", domain.ErrFileNotFound, http.StatusNotFound},
		{"node-not-found", domain.ErrNodeNotFound, http.StatusNotFound},
		{"invalid-mapping", domain.ErrInvalidMapping, http.StatusBadRequest},
		{"empty-xlsx", domain.ErrEmptyXlsx, http.StatusBadRequest},
		{"not-xlsx", domain.ErrNotXlsx, http.StatusBadRequest},
		{"invalid-multipart", domain.ErrInvalidMultipart, http.StatusBadRequest},
		{"title-required", casedom.ErrTitleRequired, http.StatusBadRequest},
		{"too-large", domain.ErrTooLarge, http.StatusRequestEntityTooLarge},
		{"max-bytes-error", &http.MaxBytesError{Limit: 1}, http.StatusRequestEntityTooLarge},
		{"bad-status", casedom.ErrBadStatus, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := MapError(tc.err)
			if got != tc.want {
				t.Errorf("%v: want %d, got %d", tc.err, tc.want, got)
			}
		})
	}
}
