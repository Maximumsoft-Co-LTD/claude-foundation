package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/cib/app/backend/internal/adapters/driving/http/handlers"
	"github.com/cib/app/backend/internal/adapters/driving/http/middleware"
)

type Deps struct {
	Cases  *handlers.CasesHandler
	Files  *handlers.FilesHandler
	Graph  *handlers.GraphHandler
	Health *handlers.HealthHandler
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logging(nil))
	r.Use(corsMiddleware)

	r.Get("/healthz", d.Health.Healthz)
	r.Handle("/metrics", promhttp.Handler())

	r.Route("/api/v1", func(r chi.Router) {
		r.Route("/cases", func(r chi.Router) {
			r.Post("/", d.Cases.Create)
			r.Get("/", d.Cases.List)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", d.Cases.Get)
				r.Patch("/", d.Cases.Patch)
				r.Post("/archive", d.Cases.Archive)
				r.Get("/files", d.Files.List)
				r.Post("/files", d.Files.Upload)
				r.Patch("/files/{fid}/mapping", d.Files.SetMapping)
				r.Patch("/files/{fid}/included", d.Files.SetIncluded)
				r.Get("/graph", d.Graph.Combined)
				r.Get("/graph/export.json", d.Graph.ExportJSON)
				r.Get("/nodes/{nodeID}", d.Graph.Node)
			})
		})
	})
	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-Request-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
