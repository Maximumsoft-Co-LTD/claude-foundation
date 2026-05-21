package ports

import (
	"github.com/cib/app/backend/internal/domain/graph"
)

// ParseStats records what happened during an xlsx parse — propagated to logs
// and the HTTP response so an analyst sees when rows were silently dropped or
// weights couldn't be parsed (e.g., Thai-comma currency cells).
type ParseStats struct {
	RowsSeen         int `json:"rows_seen"`
	RowsEmitted      int `json:"rows_emitted"`
	RowsSkippedShort int `json:"rows_skipped_short"`
	RowsSkippedBlank int `json:"rows_skipped_blank"`
	WeightsUnparsed  int `json:"weights_unparsed"`
}

type ParsedFile struct {
	Graph graph.Graph
	Stats ParseStats
}

type XlsxParser interface {
	ReadHeaders(blob []byte) ([]string, error)
	Parse(blob []byte, m graph.ColumnMapping) (ParsedFile, error)
}
