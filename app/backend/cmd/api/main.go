package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	pgxgoose "github.com/pressly/goose/v3"

	"github.com/cib/app/backend/internal/adapters/driven/postgres"
	"github.com/cib/app/backend/internal/adapters/driven/xlsx"
	httpapi "github.com/cib/app/backend/internal/adapters/driving/http"
	"github.com/cib/app/backend/internal/adapters/driving/http/handlers"
	"github.com/cib/app/backend/internal/app/usecase"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "exit after smoke-checking config")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://cib:cib@localhost:5432/cib?sslmode=disable"
	}
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	if *healthcheck {
		logger.Info("startup.config_check_ok", slog.String("api_port", port))
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := postgres.NewPool(ctx, dsn)
	if err != nil {
		logger.Error("postgres.connect_failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer pool.Close()

	if err := runMigrations(dsn); err != nil {
		logger.Error("migrations.run_failed", slog.String("err", err.Error()))
		os.Exit(1)
	}

	caseRepo := postgres.NewCaseRepo(pool)
	fileRepo := postgres.NewFileRepo(pool)
	graphRepo := postgres.NewGraphRepo(pool)
	txWriter := postgres.NewMappingTxWriter(pool)
	parser := xlsx.NewExcelizeParser()

	createUC := usecase.NewCreateCase(caseRepo)
	updateUC := usecase.NewUpdateCase(caseRepo)
	archiveUC := usecase.NewArchiveCase(caseRepo)
	listUC := usecase.NewListCases(caseRepo)
	getUC := usecase.NewGetCase(caseRepo)
	uploadUC := usecase.NewUploadFile(fileRepo, parser)
	setMapUC := usecase.NewSetMappingAndParse(fileRepo, graphRepo, parser, txWriter)
	toggleUC := usecase.NewToggleFileIncluded(fileRepo)
	combinedUC := usecase.NewGetCombinedGraph(graphRepo, caseRepo)
	nodeUC := usecase.NewGetNodeDetail(fileRepo, graphRepo, caseRepo)
	exportUC := usecase.NewExportGraphJSON(graphRepo, caseRepo)

	deps := httpapi.Deps{
		Cases:  handlers.NewCasesHandler(createUC, updateUC, archiveUC, listUC, getUC),
		Files:  handlers.NewFilesHandler(uploadUC, setMapUC, toggleUC, fileRepo),
		Graph:  handlers.NewGraphHandler(combinedUC, nodeUC, exportUC),
		Health: handlers.NewHealthHandler(pool),
	}
	router := httpapi.NewRouter(deps)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("server.listen", slog.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server.listen_failed", slog.String("err", err.Error()))
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, sc := context.WithTimeout(context.Background(), 10*time.Second)
	defer sc()
	_ = srv.Shutdown(shutdownCtx)
}

func runMigrations(dsn string) error {
	db, err := pgxgoose.OpenDBWithDriver("postgres", dsn)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer func() { _ = db.Close() }()
	pgxgoose.SetBaseFS(nil)
	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "internal/adapters/driven/postgres/migrations"
	}
	if err := pgxgoose.Up(db, migrationsDir); err != nil {
		return fmt.Errorf("goose up: %w", err)
	}
	return nil
}
