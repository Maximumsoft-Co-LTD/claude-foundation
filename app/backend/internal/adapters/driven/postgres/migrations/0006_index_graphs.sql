-- +goose Up
CREATE INDEX idx_file_graphs_nodes_gin ON file_graphs USING GIN(nodes jsonb_path_ops);
CREATE INDEX idx_file_graphs_edges_gin ON file_graphs USING GIN(edges jsonb_path_ops);

-- +goose Down
DROP INDEX IF EXISTS idx_file_graphs_edges_gin;
DROP INDEX IF EXISTS idx_file_graphs_nodes_gin;
