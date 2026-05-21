package puppygraph

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/domain/graph"
)

func TestStubStore_LogsOnceAndReturnsNil(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	s := NewStubStore(logger)

	if err := s.Publish(context.Background(), uuid.New(), graph.Graph{}); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if err := s.Publish(context.Background(), uuid.New(), graph.Graph{}); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	count := strings.Count(buf.String(), "graph_repo.persistence_deferred")
	if count != 1 {
		t.Fatalf("want exactly 1 log line, got %d", count)
	}
}
