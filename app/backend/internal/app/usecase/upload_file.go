package usecase

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain"
)

const MaxFileBytes = 5 * 1024 * 1024

type UploadFile struct {
	files  ports.FileRepository
	parser ports.XlsxParser
}

func NewUploadFile(files ports.FileRepository, parser ports.XlsxParser) *UploadFile {
	return &UploadFile{files: files, parser: parser}
}

type UploadFileResult struct {
	FileID  uuid.UUID
	Headers []string
}

func (uc *UploadFile) Run(ctx context.Context, caseID uuid.UUID, filename string, blob []byte) (UploadFileResult, error) {
	logger := LoggerFrom(ctx)
	if len(blob) == 0 {
		logger.Warn("upload.rejected", slog.String("case_id", caseID.String()), slog.String("reason", "empty"))
		return UploadFileResult{}, domain.ErrEmptyXlsx
	}
	if len(blob) > MaxFileBytes {
		logger.Warn("upload.rejected", slog.String("case_id", caseID.String()), slog.String("reason", "too_large"))
		return UploadFileResult{}, domain.ErrTooLarge
	}
	if !strings.HasSuffix(strings.ToLower(filename), ".xlsx") {
		logger.Warn("upload.rejected", slog.String("case_id", caseID.String()), slog.String("reason", "not_xlsx"))
		return UploadFileResult{}, domain.ErrNotXlsx
	}
	headers, err := uc.parser.ReadHeaders(blob)
	if err != nil {
		logger.Warn("upload.rejected", slog.String("case_id", caseID.String()), slog.String("reason", "not_xlsx"))
		return UploadFileResult{}, err
	}
	sum := sha256.Sum256(blob)
	f := ports.File{
		ID:         uuid.New(),
		CaseID:     caseID,
		Filename:   filename,
		Blob:       blob,
		ByteSize:   len(blob),
		SHA256:     hex.EncodeToString(sum[:]),
		UploadedBy: "analyst",
		UploadedAt: time.Now().UTC(),
		Included:   true,
		Headers:    headers,
	}
	if err := uc.files.Save(ctx, f); err != nil {
		return UploadFileResult{}, err
	}
	logger.Info("file.uploaded",
		slog.String("case_id", caseID.String()),
		slog.String("file_id", f.ID.String()),
		slog.Int("byte_size", f.ByteSize),
		slog.String("sha256", f.SHA256),
	)
	return UploadFileResult{FileID: f.ID, Headers: headers}, nil
}
