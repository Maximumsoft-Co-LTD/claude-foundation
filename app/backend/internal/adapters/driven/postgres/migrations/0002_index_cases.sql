-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_created_at ON cases(created_at DESC);
CREATE INDEX idx_cases_tags ON cases USING GIN(tags);
CREATE INDEX idx_cases_title_trgm ON cases USING GIN(title gin_trgm_ops);

-- +goose Down
DROP INDEX IF EXISTS idx_cases_title_trgm;
DROP INDEX IF EXISTS idx_cases_tags;
DROP INDEX IF EXISTS idx_cases_created_at;
DROP INDEX IF EXISTS idx_cases_status;
