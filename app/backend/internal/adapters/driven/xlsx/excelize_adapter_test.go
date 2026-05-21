package xlsx

import (
	"errors"
	"os"
	"testing"

	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

func TestExcelizeParser_Headers(t *testing.T) {
	p := NewExcelizeParser()
	headers, err := p.ReadHeaders(loadFixture(t, "bank.xlsx"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(headers) != 5 || headers[0] != "tx_id" {
		t.Fatalf("unexpected headers: %v", headers)
	}
}

func TestExcelizeParser_Parse_Bank(t *testing.T) {
	p := NewExcelizeParser()
	m := graph.ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "amount"}
	g, err := p.Parse(loadFixture(t, "bank.xlsx"), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(g.Edges) != 5 {
		t.Fatalf("want 5 edges, got %d", len(g.Edges))
	}
	if g.Edges[0].Weight != 5000.0 {
		t.Fatalf("want weight=5000, got %f", g.Edges[0].Weight)
	}
}

func TestExcelizeParser_Parse_Crypto(t *testing.T) {
	p := NewExcelizeParser()
	m := graph.ColumnMapping{SourceCol: "from_wallet", TargetCol: "to_wallet", WeightCol: "amount_btc"}
	g, err := p.Parse(loadFixture(t, "crypto.xlsx"), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(g.Edges) != 4 {
		t.Fatalf("want 4 edges, got %d", len(g.Edges))
	}
}

func TestExcelizeParser_Parse_Phone_ThaiHeaders(t *testing.T) {
	p := NewExcelizeParser()
	m := graph.ColumnMapping{SourceCol: "ผู้โทร", TargetCol: "ผู้รับ", WeightCol: "ระยะเวลา_วินาที"}
	g, err := p.Parse(loadFixture(t, "phone.xlsx"), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(g.Edges) != 4 {
		t.Fatalf("want 4 edges, got %d", len(g.Edges))
	}
}

func TestExcelizeParser_Parse_Travel_NoWeight(t *testing.T) {
	p := NewExcelizeParser()
	m := graph.ColumnMapping{SourceCol: "ต้นทาง", TargetCol: "ปลายทาง"}
	g, err := p.Parse(loadFixture(t, "travel.xlsx"), m)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(g.Edges) != 4 {
		t.Fatalf("want 4 edges, got %d", len(g.Edges))
	}
	if g.Edges[0].Weight != 1.0 {
		t.Fatalf("want default weight=1.0, got %f", g.Edges[0].Weight)
	}
}

func TestExcelizeParser_RejectsNotXlsx(t *testing.T) {
	p := NewExcelizeParser()
	_, err := p.ReadHeaders([]byte("definitely not an xlsx"))
	if !errors.Is(err, domain.ErrNotXlsx) {
		t.Fatalf("want ErrNotXlsx, got %v", err)
	}
}

func TestExcelizeParser_RejectsEmpty(t *testing.T) {
	p := NewExcelizeParser()
	_, err := p.ReadHeaders([]byte{})
	if !errors.Is(err, domain.ErrEmptyXlsx) {
		t.Fatalf("want ErrEmptyXlsx, got %v", err)
	}
}

func TestExcelizeParser_RejectsInvalidMapping(t *testing.T) {
	p := NewExcelizeParser()
	m := graph.ColumnMapping{SourceCol: "no_such", TargetCol: "receiver"}
	_, err := p.Parse(loadFixture(t, "bank.xlsx"), m)
	if !errors.Is(err, domain.ErrInvalidMapping) {
		t.Fatalf("want ErrInvalidMapping, got %v", err)
	}
}
