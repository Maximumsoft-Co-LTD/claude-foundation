package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cib/app/backend/internal/adapters/driving/http/handlers"
)

func TestRouter_HealthAndMetricsRegistered(t *testing.T) {
	h := NewRouter(Deps{
		Health: handlers.NewHealthHandler(nil),
	})
	ts := httptest.NewServer(h)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		t.Fatalf("healthz not registered")
	}

	resp2, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("metrics endpoint missing or 500; got %d", resp2.StatusCode)
	}
}

func TestRouter_AllRoutesRegistered(t *testing.T) {
	// Drive the real router; expect each route's handler to NOT be NotFound /
	// NotAllowed. Concrete handlers may 5xx because their use cases are nil —
	// but a 500 (or even a panic-recover) is sufficient evidence the route exists.
	// The point of the test is registration, not behaviour (covered in handlers_test.go).
	type rt struct {
		method, path string
	}
	routes := []rt{
		{"GET", "/healthz"},
		{"GET", "/metrics"},
		{"POST", "/api/v1/cases/"},
		{"GET", "/api/v1/cases/"},
		{"GET", "/api/v1/cases/00000000-0000-0000-0000-000000000001"},
		{"PATCH", "/api/v1/cases/00000000-0000-0000-0000-000000000001"},
		{"POST", "/api/v1/cases/00000000-0000-0000-0000-000000000001/archive"},
		{"GET", "/api/v1/cases/00000000-0000-0000-0000-000000000001/files"},
		{"POST", "/api/v1/cases/00000000-0000-0000-0000-000000000001/files"},
		{"PATCH", "/api/v1/cases/00000000-0000-0000-0000-000000000001/files/00000000-0000-0000-0000-000000000002/mapping"},
		{"PATCH", "/api/v1/cases/00000000-0000-0000-0000-000000000001/files/00000000-0000-0000-0000-000000000002/included"},
		{"GET", "/api/v1/cases/00000000-0000-0000-0000-000000000001/graph"},
		{"GET", "/api/v1/cases/00000000-0000-0000-0000-000000000001/graph/export.json"},
		{"GET", "/api/v1/cases/00000000-0000-0000-0000-000000000001/nodes/A"},
	}

	h := NewRouter(Deps{
		Cases:  &handlers.CasesHandler{},
		Files:  &handlers.FilesHandler{},
		Graph:  &handlers.GraphHandler{},
		Health: handlers.NewHealthHandler(nil),
	})

	for _, r := range routes {
		req := httptest.NewRequest(r.method, r.path, nil)
		rr := httptest.NewRecorder()
		func() {
			defer func() { _ = recover() }()
			h.ServeHTTP(rr, req)
		}()
		if rr.Code == http.StatusNotFound || rr.Code == http.StatusMethodNotAllowed {
			t.Errorf("route %s %s not registered (status=%d)", r.method, r.path, rr.Code)
		}
	}
}
