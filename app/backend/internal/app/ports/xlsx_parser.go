package ports

import (
	"github.com/cib/app/backend/internal/domain/graph"
)

type XlsxParser interface {
	ReadHeaders(blob []byte) ([]string, error)
	Parse(blob []byte, m graph.ColumnMapping) (graph.Graph, error)
}
