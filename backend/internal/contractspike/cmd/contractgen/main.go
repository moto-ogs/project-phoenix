// Command contractgen is the throwaway generator of the #2342 spike.
//
//	go run ./internal/contractspike/cmd/contractgen <out-dir>
//
// It writes contract.json (the model), own/students.generated.ts (variant 1)
// and openapi/openapi.json (input of variant 2) below <out-dir>.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/moto-ogs/project-phoenix/internal/contractspike"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: contractgen <out-dir>")
	}
	doc, err := contractspike.Build(contractspike.Routes(), contractspike.Probes())
	if err != nil {
		return err
	}
	if err := checkCatalog(doc); err != nil {
		return err
	}
	model, err := marshal(doc)
	if err != nil {
		return err
	}
	openAPI, err := marshal(contractspike.OpenAPI(doc))
	if err != nil {
		return err
	}
	files := map[string][]byte{
		"contract.json":                   model,
		"own/students.generated.ts":       []byte(contractspike.TypeScript(doc)),
		"openapi/openapi.json":            openAPI,
		"fixtures/fixtures.json":          nil,
		"native/Students.generated.swift": []byte(contractspike.Swift(doc)),
	}
	fixtures, err := contractspike.Fixtures()
	if err != nil {
		return err
	}
	files["fixtures/fixtures.json"] = fixtures
	for name, content := range files {
		path := filepath.Join(args[0], name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, content, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func marshal(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	return append(data, '\n'), err
}

// checkCatalog ties the registration to the existing route catalog: a typed
// route must be a catalog line. Read from disk so the generator does not link
// the whole api package.
func checkCatalog(doc contractspike.Document) error {
	lines := map[string]bool{}
	fragments, err := filepath.Glob("api/testdata/routes/*/*.golden")
	if err != nil {
		return err
	}
	for _, fragment := range fragments {
		data, err := os.ReadFile(fragment)
		if err != nil {
			return err
		}
		for _, line := range strings.Split(string(data), "\n") {
			lines[line] = true
		}
	}
	for _, route := range doc.Routes {
		if !lines[route.Method+" "+route.Pattern] {
			return fmt.Errorf("%s %s is not in the route catalog", route.Method, route.Pattern)
		}
	}
	return nil
}
