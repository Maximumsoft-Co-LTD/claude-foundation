package postgres

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cib/app/backend/internal/domain/graph"
)

type GraphRepo struct {
	pool *pgxpool.Pool
}

func NewGraphRepo(pool *pgxpool.Pool) *GraphRepo { return &GraphRepo{pool: pool} }

// pgExecer is the minimal surface SetMappingWith/SaveFileGraphWith need, satisfied
// by both *pgxpool.Pool and pgx.Tx so the same code path serves both the direct
// adapter and the transactional writer (MappingTxWriter).
type pgExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (r *GraphRepo) SaveFileGraph(ctx context.Context, fileID uuid.UUID, g graph.Graph) error {
	return SaveFileGraphWith(ctx, r.pool, fileID, g)
}

// SaveFileGraphWith writes a per-file graph using the supplied executor (pool or tx).
// Exposed so callers can compose mapping + graph writes inside a single transaction.
func SaveFileGraphWith(ctx context.Context, q pgExecer, fileID uuid.UUID, g graph.Graph) error {
	nodesJSON, err := json.Marshal(g.Nodes)
	if err != nil {
		return err
	}
	edgesJSON, err := json.Marshal(g.Edges)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx,
		`INSERT INTO file_graphs (file_id, nodes, edges, node_count, edge_count, parsed_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (file_id) DO UPDATE SET nodes=EXCLUDED.nodes, edges=EXCLUDED.edges,
		   node_count=EXCLUDED.node_count, edge_count=EXCLUDED.edge_count, parsed_at=now()`,
		fileID, nodesJSON, edgesJSON, len(g.Nodes), len(g.Edges),
	)
	return err
}

// SetMappingWith updates file_mappings using the supplied executor (pool or tx).
func SetMappingWith(ctx context.Context, q pgExecer, fileID uuid.UUID, m graph.ColumnMapping) error {
	var weightCol *string
	if m.WeightCol != "" {
		w := m.WeightCol
		weightCol = &w
	}
	_, err := q.Exec(ctx,
		`UPDATE file_mappings SET source_col=$2, target_col=$3, weight_col=$4, set_at=now() WHERE file_id=$1`,
		fileID, m.SourceCol, m.TargetCol, weightCol,
	)
	return err
}

func (r *GraphRepo) GetByCase(ctx context.Context, caseID uuid.UUID) ([]graph.FileGraph, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT f.id, f.uploaded_at, fg.nodes, fg.edges
		 FROM files f JOIN file_graphs fg ON fg.file_id = f.id
		 WHERE f.case_id = $1 AND f.included = true
		 ORDER BY f.uploaded_at ASC`, caseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]graph.FileGraph, 0)
	for rows.Next() {
		var fg graph.FileGraph
		var nodesJSON, edgesJSON []byte
		if err := rows.Scan(&fg.FileID, &fg.UploadedAt, &nodesJSON, &edgesJSON); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(nodesJSON, &fg.Graph.Nodes); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(edgesJSON, &fg.Graph.Edges); err != nil {
			return nil, err
		}
		out = append(out, fg)
	}
	return out, rows.Err()
}
