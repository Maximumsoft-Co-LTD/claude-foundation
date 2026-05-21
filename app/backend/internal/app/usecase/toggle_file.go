package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
)

type ToggleFileIncluded struct {
	files ports.FileRepository
}

func NewToggleFileIncluded(files ports.FileRepository) *ToggleFileIncluded {
	return &ToggleFileIncluded{files: files}
}

func (uc *ToggleFileIncluded) Run(ctx context.Context, fileID uuid.UUID, included bool) error {
	return uc.files.SetIncluded(ctx, fileID, included)
}
