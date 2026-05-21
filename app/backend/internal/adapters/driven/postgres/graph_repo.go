package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

type GraphRepo struct {
	pool *pgxpool.Pool
}

func NewGraphRepo(pool *pgxpool.Pool) *GraphRepo { return &GraphRepo{pool: pool} }

func (r *GraphRepo) SaveFileGraph(ctx context.Context, fileID uuid.UUID, g graph.Graph) error {
	nodesJSON, err := json.Marshal(g.Nodes)
	if err != nil {
		return err
	}
	edgesJSON, err := json.Marshal(g.Edges)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO file_graphs (file_id, nodes, edges, node_count, edge_count, parsed_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (file_id) DO UPDATE SET nodes=EXCLUDED.nodes, edges=EXCLUDED.edges,
		   node_count=EXCLUDED.node_count, edge_count=EXCLUDED.edge_count, parsed_at=now()`,
		fileID, nodesJSON, edgesJSON, len(g.Nodes), len(g.Edges),
	)
	return err
}

func (r *GraphRepo) GetByFile(ctx context.Context, fileID uuid.UUID) (graph.Graph, error) {
	var nodesJSON, edgesJSON []byte
	err := r.pool.QueryRow(ctx,
		`SELECT nodes, edges FROM file_graphs WHERE file_id = $1`, fileID,
	).Scan(&nodesJSON, &edgesJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return graph.Graph{}, domain.ErrFileNotFound
	}
	if err != nil {
		return graph.Graph{}, err
	}
	var g graph.Graph
	if err := json.Unmarshal(nodesJSON, &g.Nodes); err != nil {
		return graph.Graph{}, err
	}
	if err := json.Unmarshal(edgesJSON, &g.Edges); err != nil {
		return graph.Graph{}, err
	}
	return g, nil
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

	var out []graph.FileGraph
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
