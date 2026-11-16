// Command bootstrap does the once-per-run part of the test-database
// lifecycle: make sure the server is reachable (starting the local container
// if needed) and the template for this worktree's migrations hash is built.
// It prints the resolved template name, which the wrapper exports as
// PHX_TEST_TEMPLATE so package binaries can skip template preparation:
//
//	PHX_TEST_TEMPLATE=$(go run ./internal/testdb/cmd/bootstrap)
//
// Package binaries still acquire a server lease and check readiness, including
// when a long compilation outlives the local server's idle timeout. A naked
// `go test ./...` resolves its own template as before.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/moto-ogs/project-phoenix/internal/testdb"
	"github.com/subosito/gotenv"
)

func main() {
	var err error
	if len(os.Args) > 1 {
		// Dispatch before loading .env: the detached watcher needs no credentials.
		err = runCommand(os.Args[1:])
	} else {
		err = bootstrap()
	}
	if err != nil {
		fail(err)
	}
}

func runCommand(args []string) error {
	switch {
	case len(args) == 1 && args[0] == "--resolve-dsn":
		return printResolvedDSN(context.Background())
	case len(args) == 2 && args[0] == "--stop-ephemeral":
		return stopEphemeralServer(context.Background(), args[1])
	case len(args) == 1 && args[0] == "--idle-status":
		return testdb.IdleStatus(context.Background())
	case len(args) == 2 && args[0] == "--idle-watch":
		return watchIdle(args[1])
	default:
		return fmt.Errorf("usage: bootstrap [--idle-status|--resolve-dsn|--stop-ephemeral TEST_DB_DSN]")
	}
}

func printResolvedDSN(ctx context.Context) error {
	dsn, err := resolveDSN(ctx)
	if err != nil {
		return err
	}
	fmt.Println(dsn)
	return nil
}

func stopEphemeralServer(ctx context.Context, dsn string) error {
	cfg, err := testdb.NewConfig(dsn)
	if err != nil {
		return err
	}
	return testdb.StopEphemeralLocalServer(ctx, cfg)
}

func watchIdle(dir string) error {
	lock := os.NewFile(3, "watcher.lock")
	if lock == nil {
		return fmt.Errorf("watcher requires an inherited lock")
	}
	if _, err := lock.Stat(); err != nil {
		return err
	}
	defer func() { _ = lock.Close() }()
	return testdb.WatchIdle(context.Background(), dir, lock, 15*time.Minute, 30*time.Second)
}

func bootstrap() error {
	loadDotEnv()

	dsn := os.Getenv("TEST_DB_DSN")
	if dsn == "" {
		return fmt.Errorf("TEST_DB_DSN not set")
	}
	cfg, err := testdb.NewConfig(dsn)
	if err != nil {
		return err
	}

	// A template rebuild runs every migration (~25s).
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := testdb.EnsureServer(ctx, cfg); err != nil {
		return err
	}
	templateCfg, err := testdb.EnsureTemplate(ctx, cfg)
	if err != nil {
		return err
	}
	fmt.Println(templateCfg.TemplateName())
	return nil
}

// resolveDSN preserves an explicitly configured shared test server. Detached
// test worktrees without runtime configuration receive a private, credentialed
// loopback postgres-test service; stdout is only used for command substitution.
func resolveDSN(ctx context.Context) (string, error) {
	loadDotEnv()
	if dsn := os.Getenv("TEST_DB_DSN"); dsn != "" {
		return dsn, nil
	}

	cfg, err := testdb.NewEphemeralLocalConfig()
	if err != nil {
		return "", err
	}
	if err := testdb.StartEphemeralLocalServer(ctx, cfg); err != nil {
		return "", err
	}
	return cfg.TemplateDSN(), nil
}

func loadDotEnv() {
	if root, err := testdb.ProjectRoot(); err == nil {
		_ = gotenv.Load(filepath.Join(root, ".env"))
	}
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "testdb bootstrap: %v\n", err)
	os.Exit(1)
}
