package graph

import (
	"errors"
)

var (
	ErrMappingSourceMissing = errors.New("mapping: source column not in headers")
	ErrMappingTargetMissing = errors.New("mapping: target column not in headers")
	ErrMappingWeightMissing = errors.New("mapping: weight column not in headers")
)

type ColumnMapping struct {
	SourceCol string
	TargetCol string
	WeightCol string
}

func (m ColumnMapping) Validate(headers []string) error {
	set := make(map[string]struct{}, len(headers))
	for _, h := range headers {
		set[h] = struct{}{}
	}
	if _, ok := set[m.SourceCol]; !ok {
		return ErrMappingSourceMissing
	}
	if _, ok := set[m.TargetCol]; !ok {
		return ErrMappingTargetMissing
	}
	if m.WeightCol != "" {
		if _, ok := set[m.WeightCol]; !ok {
			return ErrMappingWeightMissing
		}
	}
	return nil
}
