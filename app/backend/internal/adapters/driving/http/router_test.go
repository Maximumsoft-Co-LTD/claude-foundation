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
	resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		t.Fatalf("healthz not registered")
	}

	resp2, err := http.Get(ts.URL + "/metrics")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("metrics endpoint missing or 500; got %d", resp2.StatusCode)
	}
}
