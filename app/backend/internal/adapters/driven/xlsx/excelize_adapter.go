package xlsx

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"github.com/cib/app/backend/internal/domain"
	"github.com/cib/app/backend/internal/domain/graph"
)

type ExcelizeParser struct{}

func NewExcelizeParser() *ExcelizeParser { return &ExcelizeParser{} }

func (p *ExcelizeParser) ReadHeaders(blob []byte) ([]string, error) {
	if len(blob) == 0 {
		return nil, domain.ErrEmptyXlsx
	}
	f, err := excelize.OpenReader(bytes.NewReader(blob))
	if err != nil {
		return nil, domain.ErrNotXlsx
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, domain.ErrEmptyXlsx
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, domain.ErrNotXlsx
	}
	if len(rows) == 0 {
		return nil, domain.ErrEmptyXlsx
	}
	headers := make([]string, 0, len(rows[0]))
	for _, h := range rows[0] {
		headers = append(headers, strings.TrimSpace(h))
	}
	if len(headers) == 0 {
		return nil, domain.ErrEmptyXlsx
	}
	return headers, nil
}

func (p *ExcelizeParser) Parse(blob []byte, m graph.ColumnMapping) (graph.Graph, error) {
	if len(blob) == 0 {
		return graph.Graph{}, domain.ErrEmptyXlsx
	}
	f, err := excelize.OpenReader(bytes.NewReader(blob))
	if err != nil {
		return graph.Graph{}, domain.ErrNotXlsx
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return graph.Graph{}, domain.ErrEmptyXlsx
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return graph.Graph{}, domain.ErrNotXlsx
	}
	if len(rows) < 2 {
		return graph.Graph{}, domain.ErrEmptyXlsx
	}

	headers := make([]string, len(rows[0]))
	for i, h := range rows[0] {
		headers[i] = strings.TrimSpace(h)
	}
	if err := m.Validate(headers); err != nil {
		return graph.Graph{}, fmt.Errorf("%w: %v", domain.ErrInvalidMapping, err)
	}

	colIdx := func(name string) int {
		for i, h := range headers {
			if h == name {
				return i
			}
		}
		return -1
	}
	srcIdx := colIdx(m.SourceCol)
	tgtIdx := colIdx(m.TargetCol)
	wIdx := -1
	if m.WeightCol != "" {
		wIdx = colIdx(m.WeightCol)
	}

	nodeSet := map[graph.NodeID]struct{}{}
	var nodes []graph.Node
	var edges []graph.Edge

	for rowI, row := range rows[1:] {
		if srcIdx >= len(row) || tgtIdx >= len(row) {
			continue
		}
		s := strings.TrimSpace(row[srcIdx])
		tt := strings.TrimSpace(row[tgtIdx])
		if s == "" || tt == "" {
			continue
		}
		weight := 1.0
		if wIdx >= 0 && wIdx < len(row) {
			ws := strings.TrimSpace(row[wIdx])
			if ws != "" {
				if v, err := strconv.ParseFloat(ws, 64); err == nil {
					weight = v
				}
			}
		}
		sID := graph.NodeID(s)
		tID := graph.NodeID(tt)
		if _, ok := nodeSet[sID]; !ok {
			nodes = append(nodes, graph.Node{ID: sID})
			nodeSet[sID] = struct{}{}
		}
		if _, ok := nodeSet[tID]; !ok {
			nodes = append(nodes, graph.Node{ID: tID})
			nodeSet[tID] = struct{}{}
		}
		edges = append(edges, graph.Edge{
			Source:   sID,
			Target:   tID,
			Weight:   weight,
			RowIndex: rowI + 2,
		})
	}

	if len(edges) == 0 {
		return graph.Graph{}, domain.ErrEmptyXlsx
	}

	return graph.Graph{Nodes: nodes, Edges: edges}, nil
}
