package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/cib/app/backend/internal/adapters/driven/xlsx"
	httpmw "github.com/cib/app/backend/internal/adapters/driving/http/middleware"
	"github.com/cib/app/backend/internal/app/ports"
	"github.com/cib/app/backend/internal/app/usecase"
	"github.com/cib/app/backend/internal/domain"
	casedom "github.com/cib/app/backend/internal/domain/case"
	"github.com/cib/app/backend/internal/domain/graph"
)

// --- shared fakes for handler tests ---

type fCaseRepo struct {
	store map[uuid.UUID]casedom.Case
	all   []casedom.Case
}

func newFCaseRepo() *fCaseRepo { return &fCaseRepo{store: map[uuid.UUID]casedom.Case{}} }
func (r *fCaseRepo) Create(_ context.Context, c casedom.Case) error {
	r.store[c.ID] = c
	r.all = append(r.all, c)
	return nil
}
func (r *fCaseRepo) Get(_ context.Context, id uuid.UUID) (casedom.Case, error) {
	c, ok := r.store[id]
	if !ok {
		return casedom.Case{}, domain.ErrCaseNotFound
	}
	return c, nil
}
func (r *fCaseRepo) Update(_ context.Context, c casedom.Case) error {
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
func (r *fCaseRepo) List(_ context.Context, f casedom.CaseFilters) ([]casedom.Case, error) {
	var out []casedom.Case
	for _, c := range r.all {
		if len(f.Statuses) == 0 && c.Status == casedom.StatusArchived {
			continue
		}
		out = append(out, c)
	}
	return out, nil
}

type fFileRepo struct {
	store map[uuid.UUID]ports.File
}

func newFFileRepo() *fFileRepo { return &fFileRepo{store: map[uuid.UUID]ports.File{}} }
func (r *fFileRepo) Save(_ context.Context, f ports.File) error {
	r.store[f.ID] = f
	return nil
}
func (r *fFileRepo) Get(_ context.Context, id uuid.UUID) (ports.File, error) {
	f, ok := r.store[id]
	if !ok {
		return ports.File{}, domain.ErrFileNotFound
	}
	return f, nil
}
func (r *fFileRepo) ListByCase(_ context.Context, caseID uuid.UUID) ([]ports.File, error) {
	var out []ports.File
	for _, f := range r.store {
		if f.CaseID == caseID {
			out = append(out, f)
		}
	}
	return out, nil
}
func (r *fFileRepo) SetIncluded(_ context.Context, id uuid.UUID, included bool) error {
	f, ok := r.store[id]
	if !ok {
		return domain.ErrFileNotFound
	}
	f.Included = included
	r.store[id] = f
	return nil
}
func (r *fFileRepo) SetMapping(_ context.Context, id uuid.UUID, m graph.ColumnMapping) error {
	f, ok := r.store[id]
	if !ok {
		return domain.ErrFileNotFound
	}
	mm := m
	f.Mapping = &mm
	r.store[id] = f
	return nil
}

type fGraphRepo struct {
	files map[uuid.UUID]graph.Graph
	fr    *fFileRepo
}

func newFGraphRepo(fr *fFileRepo) *fGraphRepo {
	return &fGraphRepo{files: map[uuid.UUID]graph.Graph{}, fr: fr}
}
func (r *fGraphRepo) SaveFileGraph(_ context.Context, fileID uuid.UUID, g graph.Graph) error {
	r.files[fileID] = g
	return nil
}
func (r *fGraphRepo) GetByCase(_ context.Context, caseID uuid.UUID) ([]graph.FileGraph, error) {
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

type fTxnWriter struct {
	files  *fFileRepo
	graphs *fGraphRepo
}

func (w *fTxnWriter) SaveMappingAndGraph(ctx context.Context, fileID uuid.UUID, m graph.ColumnMapping, g graph.Graph) error {
	if err := w.files.SetMapping(ctx, fileID, m); err != nil {
		return err
	}
	return w.graphs.SaveFileGraph(ctx, fileID, g)
}

// --- wiring + helpers ---

type testApp struct {
	cases *CasesHandler
	files *FilesHandler
	graph *GraphHandler
	fr    *fFileRepo
	cr    *fCaseRepo
	gr    *fGraphRepo
}

func newTestApp(t *testing.T) *testApp {
	t.Helper()
	cr := newFCaseRepo()
	fr := newFFileRepo()
	gr := newFGraphRepo(fr)
	parser := xlsx.NewExcelizeParser()
	txn := &fTxnWriter{files: fr, graphs: gr}

	createUC := usecase.NewCreateCase(cr)
	updateUC := usecase.NewUpdateCase(cr)
	archiveUC := usecase.NewArchiveCase(cr)
	listUC := usecase.NewListCases(cr)
	getUC := usecase.NewGetCase(cr)
	uploadUC := usecase.NewUploadFile(fr, parser)
	setMapUC := usecase.NewSetMappingAndParse(fr, gr, parser, txn)
	toggleUC := usecase.NewToggleFileIncluded(fr)
	combinedUC := usecase.NewGetCombinedGraph(gr, cr)
	nodeUC := usecase.NewGetNodeDetail(fr, gr, cr)
	exportUC := usecase.NewExportGraphJSON(gr, cr)

	return &testApp{
		cases: NewCasesHandler(createUC, updateUC, archiveUC, listUC, getUC),
		files: NewFilesHandler(uploadUC, setMapUC, toggleUC, fr),
		graph: NewGraphHandler(combinedUC, nodeUC, exportUC),
		fr:    fr, cr: cr, gr: gr,
	}
}

func withChi(routePattern, param, value string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add(param, value)
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx)))
		_ = routePattern
	}
}

// withChiParams seeds multiple chi URL params on the request context.
func withChiParams(h http.HandlerFunc, params map[string]string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.NewRouteContext()
		for k, v := range params {
			rctx.URLParams.Add(k, v)
		}
		h.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx)))
	}
}

// --- cases tests ---

func TestCasesHandler_Create_Happy(t *testing.T) {
	app := newTestApp(t)
	body := bytes.NewBufferString(`{"title":"case-1","notes":"n","tags":["fraud"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cases/", body)
	rr := httptest.NewRecorder()
	app.cases.Create(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d body=%s", rr.Code, rr.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out["title"] != "case-1" || out["status"] != "open" {
		t.Fatalf("unexpected body: %v", out)
	}
}

func TestCasesHandler_Create_TitleRequired_400(t *testing.T) {
	app := newTestApp(t)
	body := bytes.NewBufferString(`{"title":"","notes":"","tags":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cases/", body)
	rr := httptest.NewRecorder()
	app.cases.Create(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestCasesHandler_GetByID_404(t *testing.T) {
	app := newTestApp(t)
	id := uuid.New().String()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/cases/"+id, nil)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}", "id", id, app.cases.Get).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCasesHandler_PatchAndGet(t *testing.T) {
	app := newTestApp(t)
	// create
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/cases/", bytes.NewBufferString(`{"title":"x","notes":"","tags":[]}`))
	cw := httptest.NewRecorder()
	app.cases.Create(cw, createReq)
	var created map[string]any
	_ = json.Unmarshal(cw.Body.Bytes(), &created)
	id := created["id"].(string)

	// patch
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/v1/cases/"+id, bytes.NewBufferString(`{"title":"renamed"}`))
	pw := httptest.NewRecorder()
	withChi("/cases/{id}", "id", id, app.cases.Patch).ServeHTTP(pw, patchReq)
	if pw.Code != http.StatusOK {
		t.Fatalf("patch want 200, got %d body=%s", pw.Code, pw.Body.String())
	}

	// archive
	arcReq := httptest.NewRequest(http.MethodPost, "/api/v1/cases/"+id+"/archive", nil)
	aw := httptest.NewRecorder()
	withChi("/cases/{id}/archive", "id", id, app.cases.Archive).ServeHTTP(aw, arcReq)
	if aw.Code != http.StatusNoContent {
		t.Fatalf("archive want 204, got %d", aw.Code)
	}

	// list (default excludes archived)
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/cases/", nil)
	lw := httptest.NewRecorder()
	app.cases.List(lw, listReq)
	if lw.Code != http.StatusOK {
		t.Fatalf("list want 200, got %d", lw.Code)
	}
	var out []map[string]any
	if err := json.Unmarshal(lw.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("archived case must be hidden from default list; got %v", out)
	}
}

// --- files tests ---

func bankBlob(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../../driven/xlsx/testdata/bank.xlsx")
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	return b
}

func multipartBody(filename string, content []byte) (*bytes.Buffer, string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		return nil, "", err
	}
	if _, err := fw.Write(content); err != nil {
		return nil, "", err
	}
	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return &buf, w.FormDataContentType(), nil
}

func seedCase(t *testing.T, app *testApp) uuid.UUID {
	t.Helper()
	c, err := casedom.NewCase("case-files", "", nil)
	if err != nil {
		t.Fatalf("seed case: %v", err)
	}
	c.CreatedAt = time.Now().UTC()
	c.UpdatedAt = c.CreatedAt
	_ = app.cr.Create(context.Background(), c)
	return c.ID
}

func TestFilesHandler_Upload_Happy(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	body, ct, err := multipartBody("bank.xlsx", bankBlob(t))
	if err != nil {
		t.Fatalf("multipart: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cases/"+caseID.String()+"/files", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/files", "id", caseID.String(), app.files.Upload).ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d body=%s", rr.Code, rr.Body.String())
	}
	var out uploadFileResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.FileID == "" || len(out.Headers) != 5 {
		t.Fatalf("unexpected body: %+v", out)
	}
}

func TestFilesHandler_Upload_TooLarge(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	big := make([]byte, MaxMultipartBytes+1024)
	body, ct, err := multipartBody("x.xlsx", big)
	if err != nil {
		t.Fatalf("multipart: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cases/"+caseID.String()+"/files", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/files", "id", caseID.String(), app.files.Upload).ServeHTTP(rr, req)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestFilesHandler_Upload_WrongContentType(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	// JSON body posted to multipart endpoint
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cases/"+caseID.String()+"/files", bytes.NewBufferString(`{"hi":"there"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/files", "id", caseID.String(), app.files.Upload).ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestFilesHandler_SetMapping_Happy_AndRollback(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	// upload first
	body, ct, _ := multipartBody("bank.xlsx", bankBlob(t))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cases/"+caseID.String()+"/files", body)
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/files", "id", caseID.String(), app.files.Upload).ServeHTTP(rr, req)
	var up uploadFileResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &up)

	// happy mapping
	mapReq := httptest.NewRequest(http.MethodPatch, "/x", bytes.NewBufferString(`{"source_col":"sender","target_col":"receiver","weight_col":"amount"}`))
	mw := httptest.NewRecorder()
	withChiParams(app.files.SetMapping, map[string]string{"id": caseID.String(), "fid": up.FileID}).ServeHTTP(mw, mapReq)
	if mw.Code != http.StatusOK {
		t.Fatalf("set mapping want 200, got %d body=%s", mw.Code, mw.Body.String())
	}
	var sm setMappingResponse
	if err := json.Unmarshal(mw.Body.Bytes(), &sm); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if sm.EdgeCount != 5 || sm.RowsEmitted != 5 {
		t.Fatalf("unexpected stats: %+v", sm)
	}

	// invalid mapping → 400 + no graph row beyond the one we already saved
	app2 := newTestApp(t)
	caseID2 := seedCase(t, app2)
	body2, ct2, _ := multipartBody("bank.xlsx", bankBlob(t))
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/cases/"+caseID2.String()+"/files", body2)
	req2.Header.Set("Content-Type", ct2)
	rr2 := httptest.NewRecorder()
	withChi("/cases/{id}/files", "id", caseID2.String(), app2.files.Upload).ServeHTTP(rr2, req2)
	var up2 uploadFileResponse
	_ = json.Unmarshal(rr2.Body.Bytes(), &up2)
	fid2, _ := uuid.Parse(up2.FileID)

	badReq := httptest.NewRequest(http.MethodPatch, "/x", bytes.NewBufferString(`{"source_col":"nope","target_col":"still_nope"}`))
	bw := httptest.NewRecorder()
	withChiParams(app2.files.SetMapping, map[string]string{"id": caseID2.String(), "fid": fid2.String()}).ServeHTTP(bw, badReq)
	if bw.Code != http.StatusBadRequest {
		t.Fatalf("invalid mapping want 400, got %d body=%s", bw.Code, bw.Body.String())
	}
	if _, ok := app2.gr.files[fid2]; ok {
		t.Fatal("invalid-mapping rollback: graph row must not exist")
	}
	stored, _ := app2.fr.Get(context.Background(), fid2)
	if stored.Mapping != nil {
		t.Fatal("invalid-mapping rollback: mapping must not be persisted")
	}
}

func TestFilesHandler_SetIncluded_Toggle(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	fid := uuid.New()
	_ = app.fr.Save(context.Background(), ports.File{ID: fid, CaseID: caseID, Filename: "f.xlsx", Included: true, UploadedAt: time.Now()})

	req := httptest.NewRequest(http.MethodPatch, "/x", bytes.NewBufferString(`{"included":false}`))
	rr := httptest.NewRecorder()
	withChiParams(app.files.SetIncluded, map[string]string{"id": caseID.String(), "fid": fid.String()}).ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d body=%s", rr.Code, rr.Body.String())
	}
	got, _ := app.fr.Get(context.Background(), fid)
	if got.Included {
		t.Fatal("included flag should be false")
	}
}

// --- graph tests ---

func TestGraphHandler_Combined_CaseNotFound_404(t *testing.T) {
	app := newTestApp(t)
	id := uuid.New().String()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/graph", "id", id, app.graph.Combined).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestGraphHandler_Combined_Happy(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	fid := uuid.New()
	_ = app.fr.Save(context.Background(), ports.File{ID: fid, CaseID: caseID, Filename: "f.xlsx", Included: true, UploadedAt: time.Now()})
	_ = app.gr.SaveFileGraph(context.Background(), fid, graph.Graph{Nodes: []graph.Node{{ID: "A"}, {ID: "B"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1, FileID: fid}}})
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/graph", "id", caseID.String(), app.graph.Combined).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var out combinedGraphResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out.Nodes) != 2 || len(out.Edges) != 1 {
		t.Fatalf("unexpected body: %+v", out)
	}
}

func TestGraphHandler_Node_NodeNotFound_404(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	withChiParams(app.graph.Node, map[string]string{"id": caseID.String(), "nodeID": "Z"}).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404 (no such node), got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestGraphHandler_ExportJSON_HasContentDisposition(t *testing.T) {
	app := newTestApp(t)
	caseID := seedCase(t, app)
	fid := uuid.New()
	_ = app.fr.Save(context.Background(), ports.File{ID: fid, CaseID: caseID, Filename: "f.xlsx", Included: true, UploadedAt: time.Now()})
	_ = app.gr.SaveFileGraph(context.Background(), fid, graph.Graph{Nodes: []graph.Node{{ID: "A"}, {ID: "B"}}, Edges: []graph.Edge{{Source: "A", Target: "B", Weight: 1, FileID: fid}}})
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rr := httptest.NewRecorder()
	withChi("/cases/{id}/graph/export.json", "id", caseID.String(), app.graph.ExportJSON).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	cd := rr.Header().Get("Content-Disposition")
	if !strings.Contains(cd, "attachment") || !strings.Contains(cd, "graph.json") {
		t.Fatalf("want Content-Disposition attachment graph.json, got %q", cd)
	}
}

// --- middleware integration sanity ---

func TestErrorMiddleware_OnArbitraryErrorWritesJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	httpmw.WriteError(rr, errors.New("boom"))
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rr.Code)
	}
	body, _ := io.ReadAll(rr.Body)
	if !strings.Contains(string(body), "internal error") {
		t.Fatalf("want generic msg, got %s", body)
	}
}
