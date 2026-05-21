package domain

import "errors"

var (
	ErrCaseNotFound     = errors.New("case not found")
	ErrFileNotFound     = errors.New("file not found")
	ErrNodeNotFound     = errors.New("node not found")
	ErrInvalidMapping   = errors.New("invalid column mapping")
	ErrEmptyXlsx        = errors.New("xlsx is empty")
	ErrNotXlsx          = errors.New("file is not a valid xlsx")
	ErrTooLarge         = errors.New("file exceeds 5 MiB limit")
	ErrInvalidMultipart = errors.New("invalid multipart upload")
)
