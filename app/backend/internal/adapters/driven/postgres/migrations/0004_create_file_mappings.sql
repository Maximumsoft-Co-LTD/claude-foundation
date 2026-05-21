-- +goose Up
CREATE TABLE file_mappings (
  file_id uuid PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  source_col text NOT NULL,
  target_col text NOT NULL,
  weight_col text,
  header_names jsonb NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS file_mappings;
