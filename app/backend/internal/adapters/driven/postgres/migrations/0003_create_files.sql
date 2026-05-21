-- +goose Up
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  filename text NOT NULL,
  original_blob bytea NOT NULL,
  byte_size int NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 text NOT NULL,
  uploaded_by text NOT NULL DEFAULT 'analyst',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  included boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_files_case_id ON files(case_id);

-- +goose Down
DROP TABLE IF EXISTS files;
