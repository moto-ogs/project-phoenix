package tenantexport

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/stretchr/testify/require"
)

func TestObjectKeysExcludeInterruptedReplacements(t *testing.T) {
	t.Parallel()
	source, err := organizationtenancy.DataLifecycleCatalogSource.ReadFile("data_lifecycle_catalog.json")
	require.NoError(t, err)
	var catalog organizationtenancy.DataLifecycleCatalog
	require.NoError(t, json.Unmarshal(source, &catalog))
	run := &exportRun{catalog: catalog}
	uploads := t.TempDir()
	root, err := os.OpenRoot(uploads)
	require.NoError(t, err)
	defer func() { require.NoError(t, root.Close()) }()
	for _, kind := range catalog.Files {
		if kind.Kind != "staff-documents" && kind.Kind != "student-documents" {
			continue
		}
		base := kind.Kind + "/" + strconv.FormatInt(run.options.SchoolID, 10)
		require.NoError(t, os.MkdirAll(filepath.Join(uploads, base), 0o700))
		original := base + "/document.pdf"
		require.NoError(t, os.WriteFile(filepath.Join(uploads, original), []byte("original"), 0o600))
		replacement, err := os.CreateTemp(filepath.Join(uploads, base), ".replace-*")
		require.NoError(t, err)
		_, err = replacement.Write([]byte("interrupted or active replacement"))
		require.NoError(t, err)
		require.NoError(t, replacement.Close())

		keys, err := run.objectKeys(root, kind)
		require.NoError(t, err)
		require.Equal(t, []string{original}, keys)
		// Enumeration must not delete a replacement that a concurrent writer owns.
		content, err := os.ReadFile(replacement.Name())
		require.NoError(t, err)
		require.Equal(t, "interrupted or active replacement", string(content))
	}
}
