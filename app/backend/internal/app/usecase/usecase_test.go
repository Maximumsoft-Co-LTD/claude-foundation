package usecase

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
	"github.com/cib/app/backend/internal/domain/graph"
	"github.com/cib/app/backend/internal/adapters/driven/xlsx"
)

type fakeCaseRepo struct {
	store map[uuid.UUID]casedom.Case
	all   []casedom.Case
}

func newFakeCaseRepo() *fakeCaseRepo {
	return &fakeCaseRepo{store: map[uuid.UUID]casedom.Case{}}
}

func (r *fakeCaseRepo) Create(_ context.Context, c casedom.Case) error {
	r.store[c.ID] = c
	r.all = append(r.all, c)
	return nil
}
func (r *fakeCaseRepo) Get(_ context.Context, id uuid.UUID) (casedom.Case, error) {
	c, ok := r.store[id]
	if !ok {
		return casedom.Case{}, domain.ErrCaseNotFound
	}
	return c, nil
}
func (r *fakeCaseRepo) Update(_ context.Context, c casedom.Case) error {
	if _, ok := r.store[c.ID]; !ok {
		return domain.ErrCaseNotFound
	}
	r.store[c.ID] = c
	for i, x := range r.all {
		if x.ID == c.ID {
			r.all[i] = c
		}
	}
	return nil
}
func (r *fakeCaseRepo) List(_ context.Context, f casedom.CaseFilters) ([]casedom.Case, error) {
	var out []casedom.Case
	for _, c := range r.all {
		if len(f.Statuses) == 0 && c.Status == casedom.StatusArchived {
			continue
		}
		if len(f.Statuses) > 0 {
			found := false
			for _, s := range f.Statuses {
				if c.Status == s {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		if f.TitleSubstring != "" && !contains(c.Title, f.TitleSubstring) {
			continue
		}
		if len(f.Tags) > 0 {
			any := false
			for _, t := range f.Tags {
				for _, ct := range c.Tags {
					if ct == t {
						any = true
						break
					}
				}
			}
			if !any {
				continue
			}
		}
		out = append(out, c)
	}
	return out, nil
}

func contains(s, sub string) bool { return bytes.Contains([]byte(s), []byte(sub)) }

type fakeFileRepo struct {
	store map[uuid.UUID]ports.File
}

func newFakeFileRepo() *fakeFileRepo { return &fakeFileRepo{store: map[uuid.UUID]ports.File{}} }

func (r *fakeFileRepo) Save(_ context.Context, f ports.File) error {
	r.store[f.ID] = f
	return nil
}
func (r *fakeFileRepo) Get(_ context.Context, id uuid.UUID) (ports.File, error) {
	f, ok := r.store[id]
	if !ok {
		return ports.File{}, domain.ErrFileNotFound
	}
	return f, nil
}
func (r *fakeFileRepo) ListByCase(_ context.Context, caseID uuid.UUID) ([]ports.File, error) {
	var out []ports.File
	for _, f := range r.store {
		if f.CaseID == caseID {
			out = append(out, f)
		}
	}
	return out, nil
}
func (r *fakeFileRepo) SetIncluded(_ context.Context, id uuid.UUID, included bool) error {
	f, ok := r.store[id]
	if !ok {
		return domain.ErrFileNotFound
	}
	f.Included = included
	r.store[id] = f
	return nil
}
func (r *fakeFileRepo) SetMapping(_ context.Context, id uuid.UUID, m graph.ColumnMapping) error {
	f, ok := r.store[id]
	if !ok {
		return domain.ErrFileNotFound
	}
	mm := m
	f.Mapping = &mm
	r.store[id] = f
	return nil
}

type fakeGraphRepo struct {
	files map[uuid.UUID]graph.Graph
	fr    *fakeFileRepo
}

func newFakeGraphRepo(fr *fakeFileRepo) *fakeGraphRepo {
	return &fakeGraphRepo{files: map[uuid.UUID]graph.Graph{}, fr: fr}
}

func (r *fakeGraphRepo) SaveFileGraph(_ context.Context, fileID uuid.UUID, g graph.Graph) error {
	r.files[fileID] = g
	return nil
}
func (r *fakeGraphRepo) GetByFile(_ context.Context, fileID uuid.UUID) (graph.Graph, error) {
	g, ok := r.files[fileID]
	if !ok {
		return graph.Graph{}, domain.ErrFileNotFound
	}
	return g, nil
}
func (r *fakeGraphRepo) GetByCase(_ context.Context, caseID uuid.UUID) ([]graph.FileGraph, error) {
	var out []graph.FileGraph
	for id, g := range r.files {
		f, ok := r.fr.store[id]
		if !ok || f.CaseID != caseID || !f.Included {
			continue
		}
		out = append(out, graph.FileGraph{FileID: id, UploadedAt: f.UploadedAt, Graph: g})
	}
	return out, nil
}

func TestCreateCase_Happy(t *testing.T) {
	r := newFakeCaseRepo()
	uc := NewCreateCase(r)
	c, err := uc.Run(context.Background(), "case-1", "", []string{"fraud"})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if c.Status != casedom.StatusOpen {
		t.Fatalf("want open default")
	}
}

func TestCreateCase_TitleRequired(t *testing.T) {
	r := newFakeCaseRepo()
	uc := NewCreateCase(r)
	if _, err := uc.Run(context.Background(), "", "", nil); !errors.Is(err, casedom.ErrTitleRequired) {
		t.Fatalf("want ErrTitleRequired, got %v", err)
	}
}

func TestUpdateCase_Patch(t *testing.T) {
	r := newFakeCaseRepo()
	c, _ := casedom.NewCase("x", "", nil)
	_ = r.Create(context.Background(), c)
	uc := NewUpdateCase(r)
	newTitle := "renamed"
	updated, err := uc.Run(context.Background(), c.ID, UpdateCasePatch{Title: &newTitle})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if updated.Title != "renamed" {
		t.Fatalf("want renamed, got %s", updated.Title)
	}
}

func TestArchiveCase(t *testing.T) {
	r := newFakeCaseRepo()
	c, _ := casedom.NewCase("x", "", nil)
	_ = r.Create(context.Background(), c)
	uc := NewArchiveCase(r)
	if err := uc.Run(context.Background(), c.ID); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	got, _ := r.Get(context.Background(), c.ID)
	if got.Status != casedom.StatusArchived {
		t.Fatalf("want archived")
	}
}

func TestListCases_ExcludesArchivedByDefault(t *testing.T) {
	r := newFakeCaseRepo()
	open, _ := casedom.NewCase("a", "", nil)
	archived, _ := casedom.NewCase("b", "", nil)
	archived.Archive()
	_ = r.Create(context.Background(), open)
	_ = r.Create(context.Background(), archived)

	uc := NewListCases(r)
	got, err := uc.Run(context.Background(), casedom.CaseFilters{})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(got) != 1 || got[0].ID != open.ID {
		t.Fatalf("archived must be hidden by default, got %v", got)
	}

	got2, _ := uc.Run(context.Background(), casedom.CaseFilters{Statuses: []casedom.CaseStatus{casedom.StatusArchived}})
	if len(got2) != 1 || got2[0].ID != archived.ID {
		t.Fatalf("status=archived should include archived, got %v", got2)
	}
}

func TestUploadFile_Rejections(t *testing.T) {
	fr := newFakeFileRepo()
	parser := xlsx.NewExcelizeParser()
	uc := NewUploadFile(fr, parser)

	if _, err := uc.Run(context.Background(), uuid.New(), "x.xlsx", []byte{}); !errors.Is(err, domain.ErrEmptyXlsx) {
		t.Fatalf("want ErrEmptyXlsx, got %v", err)
	}
	big := make([]byte, MaxFileBytes+1)
	if _, err := uc.Run(context.Background(), uuid.New(), "x.xlsx", big); !errors.Is(err, domain.ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	if _, err := uc.Run(context.Background(), uuid.New(), "x.csv", []byte("a,b")); !errors.Is(err, domain.ErrNotXlsx) {
		t.Fatalf("want ErrNotXlsx (extension), got %v", err)
	}
	if _, err := uc.Run(context.Background(), uuid.New(), "x.xlsx", []byte("not actually xlsx")); !errors.Is(err, domain.ErrNotXlsx) {
		t.Fatalf("want ErrNotXlsx (content), got %v", err)
	}
}

func TestUploadFile_Happy(t *testing.T) {
	fr := newFakeFileRepo()
	parser := xlsx.NewExcelizeParser()
	uc := NewUploadFile(fr, parser)
	blob, err := os.ReadFile("../../adapters/driven/xlsx/testdata/bank.xlsx")
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	res, err := uc.Run(context.Background(), uuid.New(), "bank.xlsx", blob)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(res.Headers) != 5 {
		t.Fatalf("want 5 headers, got %d", len(res.Headers))
	}
}

func TestSetMappingAndParse_InvalidMapping_NoWrites(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	parser := xlsx.NewExcelizeParser()
	upload := NewUploadFile(fr, parser)
	smp := NewSetMappingAndParse(fr, gr, parser)

	blob, _ := os.ReadFile("../../adapters/driven/xlsx/testdata/bank.xlsx")
	res, err := upload.Run(context.Background(), uuid.New(), "bank.xlsx", blob)
	if err != nil {
		t.Fatalf("upload failed: %v", err)
	}

	_, err = smp.Run(context.Background(), res.FileID, graph.ColumnMapping{SourceCol: "nope", TargetCol: "still_nope"})
	if !errors.Is(err, domain.ErrInvalidMapping) {
		t.Fatalf("want ErrInvalidMapping, got %v", err)
	}
	if _, ok := gr.files[res.FileID]; ok {
		t.Fatal("no graph row should have been written on invalid mapping")
	}
	stored, _ := fr.Get(context.Background(), res.FileID)
	if stored.Mapping != nil {
		t.Fatal("no mapping should have been persisted on invalid mapping")
	}
}

func TestSetMappingAndParse_Happy(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	parser := xlsx.NewExcelizeParser()
	upload := NewUploadFile(fr, parser)
	smp := NewSetMappingAndParse(fr, gr, parser)

	blob, _ := os.ReadFile("../../adapters/driven/xlsx/testdata/bank.xlsx")
	res, _ := upload.Run(context.Background(), uuid.New(), "bank.xlsx", blob)

	g, err := smp.Run(context.Background(), res.FileID, graph.ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "amount"})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(g.Edges) != 5 {
		t.Fatalf("want 5 edges, got %d", len(g.Edges))
	}
}

func TestGetCombinedGraph_MergesIncluded(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	caseID := uuid.New()

	f1ID, f2ID := uuid.New(), uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Included: true, UploadedAt: timeFixture(1)})
	_ = fr.Save(context.Background(), ports.File{ID: f2ID, CaseID: caseID, Included: true, UploadedAt: timeFixture(2)})

	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{Nodes: []graph.Node{{ID: "A"}, {ID: "B"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1}}})
	_ = gr.SaveFileGraph(context.Background(), f2ID, graph.Graph{Nodes: []graph.Node{{ID: "B"}, {ID: "C"}}, Edges: []graph.Edge{{Source: "B", Target: "C", Weight: 2}}})

	uc := NewGetCombinedGraph(gr)
	g, err := uc.Run(context.Background(), caseID)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(g.Nodes) != 3 {
		t.Fatalf("want 3 merged nodes, got %d", len(g.Nodes))
	}
	if len(g.Edges) != 2 {
		t.Fatalf("want 2 edges, got %d", len(g.Edges))
	}

	_ = fr.SetIncluded(context.Background(), f2ID, false)
	g2, _ := uc.Run(context.Background(), caseID)
	if len(g2.Edges) != 1 {
		t.Fatalf("excluded file's edges must drop; got %d edges", len(g2.Edges))
	}
}

func TestExportGraphJSON_Shape(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	caseID := uuid.New()
	f1ID := uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Included: true, UploadedAt: timeFixture(1)})
	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{Nodes: []graph.Node{{ID: "A"}}, Edges: []graph.Edge{{Source: "A", Target: "A", Weight: 1}}})

	uc := NewExportGraphJSON(gr)
	out, err := uc.Run(context.Background(), caseID)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Nodes) == 0 || len(out.Edges) == 0 {
		t.Fatalf("want nodes+edges, got %+v", out)
	}
}

func TestGetNodeDetail_AttachesEdges(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	caseID := uuid.New()
	f1ID := uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Filename: "bank.xlsx", Included: true, UploadedAt: timeFixture(1)})
	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{
		Nodes: []graph.Node{{ID: "A"}, {ID: "B"}, {ID: "C"}},
		Edges: []graph.Edge{
			{Source: "A", Target: "B", Weight: 1, RowIndex: 2, FileID: f1ID},
			{Source: "B", Target: "C", Weight: 2, RowIndex: 3, FileID: f1ID},
		},
	})
	uc := NewGetNodeDetail(fr, gr)
	d, err := uc.Run(context.Background(), caseID, "B")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(d.Edges) != 2 {
		t.Fatalf("want 2 edges touching B, got %d", len(d.Edges))
	}
	for _, e := range d.Edges {
		if e.Filename != "bank.xlsx" {
			t.Fatalf("want filename attached, got %q", e.Filename)
		}
	}
}

func timeFixture(i int) time.Time {
	return time.Date(2026, 1, i, 0, 0, 0, 0, time.UTC)


}
