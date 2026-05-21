package usecase

import (
	"io"
	"log/slog"
)

func newCapture(w io.Writer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, nil))
}
