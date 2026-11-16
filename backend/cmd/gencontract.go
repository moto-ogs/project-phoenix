package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/contract"
	"github.com/spf13/cobra"
)

// The generated contract, relative to the repository root.
const (
	contractModelPath    = "backend/api/contract/contract.json"
	contractFrontendDir  = "frontend/src/lib/contract"
	contractGeneratedExt = ".generated.ts"
)

var gencontractCmd = &cobra.Command{
	Use:   "gencontract",
	Short: "Generate the frontend contract from the typed route registrations",
	Long: `Writes the contract model and the TypeScript types and zod decoders of every
registered route (ADR 0270). With --check it writes nothing and fails when
the committed files differ.`,
	// The generator reads Go types only; it needs no configuration.
	PersistentPreRun: func(*cobra.Command, []string) {},
	RunE: func(cmd *cobra.Command, _ []string) error {
		root, _ := cmd.Flags().GetString("root")
		check, _ := cmd.Flags().GetBool("check")
		files, err := generatedContract()
		if err != nil {
			return err
		}
		return writeContract(root, files, check)
	},
}

func init() {
	RootCmd.AddCommand(gencontractCmd)
	gencontractCmd.Flags().String("root", "..", "repository root")
	gencontractCmd.Flags().Bool("check", false, "fail when the committed files are stale")
}

// generatedContract returns every generated file by its path below the
// repository root.
func generatedContract() (map[string][]byte, error) {
	doc, err := api.ContractDocument()
	if err != nil {
		return nil, err
	}
	model, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	sources, err := contract.TypeScript(doc)
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{contractModelPath: append(model, '\n')}
	for name, source := range sources {
		files[filepath.Join(contractFrontendDir, name)] = []byte(source)
	}
	return files, nil
}

// writeContract owns every *.generated.ts in the contract directory: a file
// the registrations no longer produce is stale. Check mode repairs nothing.
func writeContract(root string, files map[string][]byte, check bool) error {
	drift, err := removeStaleContractFiles(root, files, check)
	if err != nil {
		return err
	}
	for relative, content := range files {
		changed, err := writeContractFile(filepath.Join(root, relative), content, check)
		if err != nil {
			return err
		}
		if changed {
			drift = append(drift, relative)
		}
	}
	if check && len(drift) > 0 {
		sort.Strings(drift)
		return fmt.Errorf("the generated contract is stale; run `scripts/run-go-toolchain.sh go -C backend run . gencontract`:\n%s", strings.Join(drift, "\n"))
	}
	return nil
}

func removeStaleContractFiles(root string, files map[string][]byte, check bool) ([]string, error) {
	existing, err := filepath.Glob(filepath.Join(root, contractFrontendDir, "*"+contractGeneratedExt))
	if err != nil {
		return nil, err
	}
	var stale []string
	for _, path := range existing {
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return nil, err
		}
		if _, ok := files[filepath.ToSlash(relative)]; ok {
			continue
		}
		stale = append(stale, relative)
		if check {
			continue
		}
		if err := os.Remove(path); err != nil {
			return nil, err
		}
	}
	return stale, nil
}

// writeContractFile reports whether the file differed from content.
func writeContractFile(path string, content []byte, check bool) (bool, error) {
	current, err := os.ReadFile(path) //nolint:gosec // path is below the repository root the caller names
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if err == nil && bytes.Equal(current, content) {
		return false, nil
	}
	if check {
		return true, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return false, err
	}
	return true, os.WriteFile(path, content, 0o644) //nolint:gosec // generated source, committed and world-readable like its neighbours
}
