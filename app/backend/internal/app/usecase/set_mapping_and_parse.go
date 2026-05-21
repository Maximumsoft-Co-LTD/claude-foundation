package usecase

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

// TransactionalMappingWriter atomically writes a file's column mapping + parsed
// graph so a graph-write failure rolls back the prior mapping update.
type TransactionalMappingWriter interface {
	SaveMappingAndGraph(ctx context.Context, fileID uuid.UUID, m graph.ColumnMapping, g graph.Graph) error
}

type SetMappingAndParseResult struct {
	Graph graph.Graph
	Stats ports.ParseStats
}

type SetMappingAndParse struct {
	files  ports.FileRepository
	graphs ports.GraphRepository
	parser ports.XlsxParser
	txn    TransactionalMappingWriter
}

func NewSetMappingAndParse(files ports.FileRepository, graphs ports.GraphRepository, parser ports.XlsxParser, txn TransactionalMappingWriter) *SetMappingAndParse {
	return &SetMappingAndParse{files: files, graphs: graphs, parser: parser, txn: txn}
}

func (uc *SetMappingAndParse) Run(ctx context.Context, fileID uuid.UUID, m graph.ColumnMapping) (SetMappingAndParseResult, error) {
	logger := LoggerFrom(ctx)
	f, err := uc.files.Get(ctx, fileID)
	if err != nil {
		return SetMappingAndParseResult{}, err
	}
	if err := m.Validate(f.Headers); err != nil {
		logger.Warn("upload.rejected",
			slog.String("case_id", f.CaseID.String()),
			slog.String("file_id", fileID.String()),
			slog.String("reason", "invalid_mapping"))
		return SetMappingAndParseResult{}, domain.ErrInvalidMapping
	}
	t0 := time.Now()
	parsed, err := uc.parser.Parse(f.Blob, m)
	if err != nil {
		return SetMappingAndParseResult{}, err
	}
	for i := range parsed.Graph.Edges {
		parsed.Graph.Edges[i].FileID = fileID
	}
	if uc.txn != nil {
		if err := uc.txn.SaveMappingAndGraph(ctx, fileID, m, parsed.Graph); err != nil {
			return SetMappingAndParseResult{}, err
		}
	} else {
		if err := uc.files.SetMapping(ctx, fileID, m); err != nil {
			return SetMappingAndParseResult{}, err
		}
		if err := uc.graphs.SaveFileGraph(ctx, fileID, parsed.Graph); err != nil {
			return SetMappingAndParseResult{}, err
		}
	}
	logger.Info("mapping.set",
		slog.String("file_id", fileID.String()),
		slog.String("source_col", m.SourceCol),
		slog.String("target_col", m.TargetCol),
		slog.String("weight_col", m.WeightCol),
	)
	logger.Info("file.parsed",
		slog.String("file_id", fileID.String()),
		slog.Int("node_count", len(parsed.Graph.Nodes)),
		slog.Int("edge_count", len(parsed.Graph.Edges)),
		slog.Int("rows_seen", parsed.Stats.RowsSeen),
		slog.Int("rows_emitted", parsed.Stats.RowsEmitted),
		slog.Int("rows_skipped_short", parsed.Stats.RowsSkippedShort),
		slog.Int("rows_skipped_blank", parsed.Stats.RowsSkippedBlank),
		slog.Int("weights_unparsed", parsed.Stats.WeightsUnparsed),
		slog.Int64("parse_dur_ms", time.Since(t0).Milliseconds()),
	)
	return SetMappingAndParseResult{Graph: parsed.Graph, Stats: parsed.Stats}, nil
}
