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

type SetMappingAndParse struct {
	files  ports.FileRepository
	graphs ports.GraphRepository
	parser ports.XlsxParser
}

func NewSetMappingAndParse(files ports.FileRepository, graphs ports.GraphRepository, parser ports.XlsxParser) *SetMappingAndParse {
	return &SetMappingAndParse{files: files, graphs: graphs, parser: parser}
}

func (uc *SetMappingAndParse) Run(ctx context.Context, fileID uuid.UUID, m graph.ColumnMapping) (graph.Graph, error) {
	logger := LoggerFrom(ctx)
	f, err := uc.files.Get(ctx, fileID)
	if err != nil {
		return graph.Graph{}, err
	}
	if err := m.Validate(f.Headers); err != nil {
		logger.Warn("upload.rejected",
			slog.String("case_id", f.CaseID.String()),
			slog.String("file_id", fileID.String()),
			slog.String("reason", "invalid_mapping"))
		return graph.Graph{}, domain.ErrInvalidMapping
	}
	t0 := time.Now()
	g, err := uc.parser.Parse(f.Blob, m)
	if err != nil {
		return graph.Graph{}, err
	}
	for i := range g.Edges {
		g.Edges[i].FileID = fileID
	}
	if err := uc.files.SetMapping(ctx, fileID, m); err != nil {
		return graph.Graph{}, err
	}
	if err := uc.graphs.SaveFileGraph(ctx, fileID, g); err != nil {
		return graph.Graph{}, err
	}
	logger.Info("mapping.set",
		slog.String("file_id", fileID.String()),
		slog.String("source_col", m.SourceCol),
		slog.String("target_col", m.TargetCol),
		slog.String("weight_col", m.WeightCol),
	)
	logger.Info("file.parsed",
		slog.String("file_id", fileID.String()),
		slog.Int("node_count", len(g.Nodes)),
		slog.Int("edge_count", len(g.Edges)),
		slog.Int64("parse_dur_ms", time.Since(t0).Milliseconds()),
	)
	return g, nil
}
