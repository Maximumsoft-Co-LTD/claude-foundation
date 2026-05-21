package usecase

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/adapters/driven/xlsx"
	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
	"github.com/cib/app/backend/internal/domain/graph"
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
			anyHit := false
			for _, t := range f.Tags {
				for _, ct := range c.Tags {
					if ct == t {
						anyHit = true
						break
					}
				}
			}
			if !anyHit {
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

// fakeTxnWriter atomically writes mapping + graph via the fake repos. If
// failGraph is true the graph write returns an error AFTER the mapping path
// would have been touched — used to assert the rollback contract.
type fakeTxnWriter struct {
	files     *fakeFileRepo
	graphs    *fakeGraphRepo
	failGraph bool
}

func (w *fakeTxnWriter) SaveMappingAndGraph(ctx context.Context, fileID uuid.UUID, m graph.ColumnMapping, g graph.Graph) error {
	if w.failGraph {
		// simulate "graph save failed, mapping NOT persisted" — never touch w.files
		return errors.New("simulated graph save failure")
	}
	if err := w.files.SetMapping(ctx, fileID, m); err != nil {
		return err
	}
	return w.graphs.SaveFileGraph(ctx, fileID, g)
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
	openC, _ := casedom.NewCase("a", "", nil)
	archived, _ := casedom.NewCase("b", "", nil)
	archived.Archive()
	_ = r.Create(context.Background(), openC)
	_ = r.Create(context.Background(), archived)

	uc := NewListCases(r)
	got, err := uc.Run(context.Background(), casedom.CaseFilters{})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(got) != 1 || got[0].ID != openC.ID {
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
	txn := &fakeTxnWriter{files: fr, graphs: gr}
	smp := NewSetMappingAndParse(fr, gr, parser, txn)

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

func TestSetMappingAndParse_GraphSaveFails_RollsBackMapping(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	parser := xlsx.NewExcelizeParser()
	upload := NewUploadFile(fr, parser)
	txn := &fakeTxnWriter{files: fr, graphs: gr, failGraph: true}
	smp := NewSetMappingAndParse(fr, gr, parser, txn)

	blob, _ := os.ReadFile("../../adapters/driven/xlsx/testdata/bank.xlsx")
	res, err := upload.Run(context.Background(), uuid.New(), "bank.xlsx", blob)
	if err != nil {
		t.Fatalf("upload failed: %v", err)
	}

	_, err = smp.Run(context.Background(), res.FileID, graph.ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "amount"})
	if err == nil {
		t.Fatal("want error from graph save failure")
	}
	if _, ok := gr.files[res.FileID]; ok {
		t.Fatal("graph row must not exist after a failed transactional write")
	}
	stored, _ := fr.Get(context.Background(), res.FileID)
	if stored.Mapping != nil {
		t.Fatal("mapping must not be persisted after a failed transactional write — rollback violated")
	}
}

func TestSetMappingAndParse_Happy(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	parser := xlsx.NewExcelizeParser()
	upload := NewUploadFile(fr, parser)
	txn := &fakeTxnWriter{files: fr, graphs: gr}
	smp := NewSetMappingAndParse(fr, gr, parser, txn)

	blob, _ := os.ReadFile("../../adapters/driven/xlsx/testdata/bank.xlsx")
	res, _ := upload.Run(context.Background(), uuid.New(), "bank.xlsx", blob)

	r, err := smp.Run(context.Background(), res.FileID, graph.ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "amount"})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(r.Graph.Edges) != 5 {
		t.Fatalf("want 5 edges, got %d", len(r.Graph.Edges))
	}
	if r.Stats.RowsSeen != 5 || r.Stats.RowsEmitted != 5 {
		t.Fatalf("want stats RowsSeen=5/RowsEmitted=5, got %+v", r.Stats)
	}
}

type fakeCaseGetter struct {
	cases map[uuid.UUID]casedom.Case
}

func (g *fakeCaseGetter) Get(_ context.Context, id uuid.UUID) (casedom.Case, error) {
	c, ok := g.cases[id]
	if !ok {
		return casedom.Case{}, domain.ErrCaseNotFound
	}
	return c, nil
}

func TestGetCombinedGraph_CaseNotFound_Returns_ErrCaseNotFound(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	cg := &fakeCaseGetter{cases: map[uuid.UUID]casedom.Case{}}
	uc := NewGetCombinedGraph(gr, cg)

	_, err := uc.Run(context.Background(), uuid.New())
	if !errors.Is(err, domain.ErrCaseNotFound) {
		t.Fatalf("want ErrCaseNotFound, got %v", err)
	}
}

func TestGetCombinedGraph_MergesIncluded(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	caseID := uuid.New()
	cg := &fakeCaseGetter{cases: map[uuid.UUID]casedom.Case{caseID: {ID: caseID, Status: casedom.StatusOpen}}}

	f1ID, f2ID := uuid.New(), uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Included: true, UploadedAt: timeFixture(1)})
	_ = fr.Save(context.Background(), ports.File{ID: f2ID, CaseID: caseID, Included: true, UploadedAt: timeFixture(2)})

	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{Nodes: []graph.Node{{ID: "A"}, {ID: "B"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1}}})
	_ = gr.SaveFileGraph(context.Background(), f2ID, graph.Graph{Nodes: []graph.Node{{ID: "B"}, {ID: "C"}}, Edges: []graph.Edge{{Source: "B", Target: "C", Weight: 2}}})

	uc := NewGetCombinedGraph(gr, cg)
	g, err := uc.Run(context.Background(), caseID)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(g.Graph.Nodes) != 3 {
		t.Fatalf("want 3 merged nodes, got %d", len(g.Graph.Nodes))
	}
	if len(g.Graph.Edges) != 2 {
		t.Fatalf("want 2 edges, got %d", len(g.Graph.Edges))
	}

	_ = fr.SetIncluded(context.Background(), f2ID, false)
	g2, _ := uc.Run(context.Background(), caseID)
	if len(g2.Graph.Edges) != 1 {
		t.Fatalf("excluded file's edges must drop; got %d edges", len(g2.Graph.Edges))
	}
}

func TestExportGraphJSON_Shape(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	caseID := uuid.New()
	cg := &fakeCaseGetter{cases: map[uuid.UUID]casedom.Case{caseID: {ID: caseID, Status: casedom.StatusOpen}}}
	f1ID := uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Included: true, UploadedAt: timeFixture(1)})
	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{Nodes: []graph.Node{{ID: "A"}, {ID: "B"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1, RowIndex: 2, FileID: f1ID}}})

	uc := NewExportGraphJSON(gr, cg)
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
	cg := &fakeCaseGetter{cases: map[uuid.UUID]casedom.Case{caseID: {ID: caseID, Status: casedom.StatusOpen}}}
	f1ID := uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Filename: "bank.xlsx", Included: true, UploadedAt: timeFixture(1)})
	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{
		Nodes: []graph.Node{{ID: "A"}, {ID: "B"}, {ID: "C"}},
		Edges: []graph.Edge{
			{Source: "A", Target: "B", Weight: 1, RowIndex: 2, FileID: f1ID},
			{Source: "B", Target: "C", Weight: 2, RowIndex: 3, FileID: f1ID},
		},
	})
	uc := NewGetNodeDetail(fr, gr, cg)
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

func TestGetNodeDetail_MissingNode_ReturnsErrNodeNotFound(t *testing.T) {
	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	caseID := uuid.New()
	cg := &fakeCaseGetter{cases: map[uuid.UUID]casedom.Case{caseID: {ID: caseID, Status: casedom.StatusOpen}}}
	f1ID := uuid.New()
	_ = fr.Save(context.Background(), ports.File{ID: f1ID, CaseID: caseID, Filename: "bank.xlsx", Included: true, UploadedAt: timeFixture(1)})
	_ = gr.SaveFileGraph(context.Background(), f1ID, graph.Graph{Nodes: []graph.Node{{ID: "A"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1, FileID: f1ID}}})
	uc := NewGetNodeDetail(fr, gr, cg)
	if _, err := uc.Run(context.Background(), caseID, "Z"); !errors.Is(err, domain.ErrNodeNotFound) {
		t.Fatalf("want ErrNodeNotFound, got %v", err)
	}
}

func TestUsecaseLogs(t *testing.T) {
	// Asserts each documented log event fires on its happy path.
	// case.created / case.updated / case.archived / file.uploaded /
	// mapping.set / file.parsed / graph.exported / upload.rejected.
	want := []string{
		"case.created", "case.updated", "case.archived",
		"file.uploaded", "mapping.set", "file.parsed",
		"graph.exported", "upload.rejected",
	}

	var buf bytes.Buffer
	logger := newCapture(&buf)
	ctx := WithLogger(context.Background(), logger)

	caseR := newFakeCaseRepo()
	createUC := NewCreateCase(caseR)
	c, err := createUC.Run(ctx, "title-x", "", []string{"fraud"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	newTitle := "renamed-x"
	if _, err := NewUpdateCase(caseR).Run(ctx, c.ID, UpdateCasePatch{Title: &newTitle}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if err := NewArchiveCase(caseR).Run(ctx, c.ID); err != nil {
		t.Fatalf("archive: %v", err)
	}

	fr := newFakeFileRepo()
	gr := newFakeGraphRepo(fr)
	parser := xlsx.NewExcelizeParser()
	uploadUC := NewUploadFile(fr, parser)
	blob, _ := os.ReadFile("../../adapters/driven/xlsx/testdata/bank.xlsx")
	res, err := uploadUC.Run(ctx, c.ID, "bank.xlsx", blob)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	// upload.rejected on too-large blob
	big := make([]byte, MaxFileBytes+1)
	_, _ = uploadUC.Run(ctx, c.ID, "x.xlsx", big)

	txn := &fakeTxnWriter{files: fr, graphs: gr}
	smp := NewSetMappingAndParse(fr, gr, parser, txn)
	if _, err := smp.Run(ctx, res.FileID, graph.ColumnMapping{SourceCol: "sender", TargetCol: "receiver", WeightCol: "amount"}); err != nil {
		t.Fatalf("set mapping: %v", err)
	}

	cg := &fakeCaseGetter{cases: map[uuid.UUID]casedom.Case{c.ID: c}}
	if _, err := NewExportGraphJSON(gr, cg).Run(ctx, c.ID); err != nil {
		t.Fatalf("export: %v", err)
	}

	logged := buf.String()
	for _, ev := range want {
		if !bytes.Contains([]byte(logged), []byte(ev)) {
			t.Errorf("expected log event %q to fire; logs:\n%s", ev, logged)
		}
	}
}

func timeFixture(i int) time.Time {
	return time.Date(2026, 1, i, 0, 0, 0, 0, time.UTC)
}
