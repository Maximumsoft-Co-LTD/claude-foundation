package graph

import (
	"errors"
	"testing"
)

func TestMappingValidate(t *testing.T) {
	headers := []string{"sender", "receiver", "amount"}

	cases := []struct {
		name string
		m    ColumnMapping
		want error
	}{
		{"ok", ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "amount"}, nil},
		{"ok no weight", ColumnMapping{SourceCol: "sender", TargetCol: "receiver"}, nil},
		{"source missing", ColumnMapping{SourceCol: "foo", TargetCol: "receiver"}, ErrMappingSourceMissing},
		{"target missing", ColumnMapping{SourceCol: "sender", TargetCol: "foo"}, ErrMappingTargetMissing},
		{"weight missing", ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "foo"}, ErrMappingWeightMissing},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.m.Validate(headers)
			if !errors.Is(got, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
		})
	}
}
