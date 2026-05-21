package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cib/app/backend/internal/domain/graph"
)

// MappingTxWriter writes (file_mappings, file_graphs) atomically inside a single
// pgx.Tx so a graph-write failure rolls back the mapping update.
type MappingTxWriter struct {
	pool *pgxpool.Pool
}

func NewMappingTxWriter(pool *pgxpool.Pool) *MappingTxWriter { return &MappingTxWriter{pool: pool} }

func (w *MappingTxWriter) SaveMappingAndGraph(ctx context.Context, fileID uuid.UUID, m graph.ColumnMapping, g graph.Graph) error {
	return WithTx(ctx, w.pool, func(tx pgx.Tx) error {
		if err := SetMappingWith(ctx, tx, fileID, m); err != nil {
			return err
		}
		return SaveFileGraphWith(ctx, tx, fileID, g)
	})
}
