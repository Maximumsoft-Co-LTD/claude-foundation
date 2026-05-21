-- +goose Up
CREATE TABLE file_graphs (
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  node_count int NOT NULL DEFAULT 0,
  edge_count int NOT NULL DEFAULT 0,
  parsed_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS file_graphs;
