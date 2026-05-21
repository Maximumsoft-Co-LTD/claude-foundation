package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

type FileRepo struct {
	pool *pgxpool.Pool
}

func NewFileRepo(pool *pgxpool.Pool) *FileRepo { return &FileRepo{pool: pool} }

func (r *FileRepo) Save(ctx context.Context, f ports.File) error {
	headersJSON, err := json.Marshal(f.Headers)
	if err != nil {
		return err
	}
	return WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO files (id, case_id, filename, original_blob, byte_size, sha256, uploaded_by, uploaded_at, included)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			f.ID, f.CaseID, f.Filename, f.Blob, f.ByteSize, f.SHA256, f.UploadedBy, f.UploadedAt, f.Included,
		)
		if err != nil {
			return err
		}
		// stash headers in file_mappings with empty cols so the mapping step later can validate against them
		_, err = tx.Exec(ctx,
			`INSERT INTO file_mappings (file_id, source_col, target_col, weight_col, header_names, set_at)
			 VALUES ($1, '', '', NULL, $2, now())
			 ON CONFLICT (file_id) DO NOTHING`,
			f.ID, headersJSON,
		)
		return err
	})
}

func (r *FileRepo) Get(ctx context.Context, id uuid.UUID) (ports.File, error) {
	var f ports.File
	var headersJSON []byte
	var sourceCol, targetCol string
	var weightCol *string
	err := r.pool.QueryRow(ctx,
		`SELECT f.id, f.case_id, f.filename, f.original_blob, f.byte_size, f.sha256,
		        f.uploaded_by, f.uploaded_at, f.included,
		        m.header_names, m.source_col, m.target_col, m.weight_col
		 FROM files f LEFT JOIN file_mappings m ON m.file_id = f.id
		 WHERE f.id = $1`, id,
	).Scan(&f.ID, &f.CaseID, &f.Filename, &f.Blob, &f.ByteSize, &f.SHA256,
		&f.UploadedBy, &f.UploadedAt, &f.Included,
		&headersJSON, &sourceCol, &targetCol, &weightCol,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ports.File{}, domain.ErrFileNotFound
	}
	if err != nil {
		return ports.File{}, err
	}
	if len(headersJSON) > 0 {
		_ = json.Unmarshal(headersJSON, &f.Headers)
	}
	if sourceCol != "" && targetCol != "" {
		w := ""
		if weightCol != nil {
			w = *weightCol
		}
		f.Mapping = &graph.ColumnMapping{SourceCol: sourceCol, TargetCol: targetCol, WeightCol: w}
	}
	return f, nil
}

func (r *FileRepo) ListByCase(ctx context.Context, caseID uuid.UUID) ([]ports.File, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT f.id, f.case_id, f.filename, f.byte_size, f.sha256, f.uploaded_by, f.uploaded_at, f.included,
		        m.header_names, m.source_col, m.target_col, m.weight_col
		 FROM files f LEFT JOIN file_mappings m ON m.file_id = f.id
		 WHERE f.case_id = $1
		 ORDER BY f.uploaded_at ASC`, caseID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ports.File
	for rows.Next() {
		var f ports.File
		var headersJSON []byte
		var sourceCol, targetCol string
		var weightCol *string
		if err := rows.Scan(&f.ID, &f.CaseID, &f.Filename, &f.ByteSize, &f.SHA256,
			&f.UploadedBy, &f.UploadedAt, &f.Included,
			&headersJSON, &sourceCol, &targetCol, &weightCol); err != nil {
			return nil, err
		}
		if len(headersJSON) > 0 {
			_ = json.Unmarshal(headersJSON, &f.Headers)
		}
		if sourceCol != "" && targetCol != "" {
			w := ""
			if weightCol != nil {
				w = *weightCol
			}
			f.Mapping = &graph.ColumnMapping{SourceCol: sourceCol, TargetCol: targetCol, WeightCol: w}
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *FileRepo) SetIncluded(ctx context.Context, id uuid.UUID, included bool) error {
	tag, err := r.pool.Exec(ctx, `UPDATE files SET included = $2 WHERE id = $1`, id, included)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrFileNotFound
	}
	return nil
}

func (r *FileRepo) SetMapping(ctx context.Context, id uuid.UUID, m graph.ColumnMapping) error {
	var weightCol *string
	if m.WeightCol != "" {
		w := m.WeightCol
		weightCol = &w
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE file_mappings SET source_col=$2, target_col=$3, weight_col=$4, set_at=now() WHERE file_id=$1`,
		id, m.SourceCol, m.TargetCol, weightCol,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrFileNotFound
	}
	return nil
}
