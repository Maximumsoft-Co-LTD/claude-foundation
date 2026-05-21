package middleware

import (
	"net/http"
	"testing"

	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
)

func TestErrorMapping(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{domain.ErrCaseNotFound, http.StatusNotFound},
		{domain.ErrFileNotFound, http.StatusNotFound},
		{domain.ErrInvalidMapping, http.StatusBadRequest},
		{domain.ErrEmptyXlsx, http.StatusBadRequest},
		{domain.ErrNotXlsx, http.StatusBadRequest},
		{casedom.ErrTitleRequired, http.StatusBadRequest},
		{domain.ErrTooLarge, http.StatusRequestEntityTooLarge},
		{domain.ErrInvalidStatus, http.StatusUnprocessableEntity},
		{casedom.ErrBadStatus, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		got, _ := MapError(tc.err)
		if got != tc.want {
			t.Errorf("%v: want %d, got %d", tc.err, tc.want, got)
		}
	}
}
