// Package puppygraph holds the v1 stub adapter for the v2 graph-query layer.
// v1 does not read from or write to PuppyGraph; this adapter logs once at
// startup and returns nil from Publish so the use-case layer can call it
// uniformly today and switch to a real implementation later without
// touching the port.
package puppygraph

import (
	"context"
	"log/slog"
	"sync"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/domain/graph"
)

type StubStore struct {
	once   sync.Once
	logger *slog.Logger
}

func NewStubStore(logger *slog.Logger) *StubStore {
	if logger == nil {
		logger = slog.Default()
	}
	return &StubStore{logger: logger}
}

func (s *StubStore) Publish(_ context.Context, _ uuid.UUID, _ graph.Graph) error {
	s.once.Do(func() {
		s.logger.Info("graph_repo.persistence_deferred",
			slog.String("reason", "puppygraph stub is dormant in v1"))
	})
	return nil
}
