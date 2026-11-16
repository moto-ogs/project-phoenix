package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTheCommittedContractIsCurrent(t *testing.T) {
	t.Parallel()
	files, err := generatedContract()
	require.NoError(t, err)
	require.NoError(t, writeContract(filepath.Join("..", ".."), files, true))
}

func TestWriteContractOwnsItsGeneratedFiles(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	stale := filepath.Join(root, contractFrontendDir, "gone.generated.ts")
	handwritten := filepath.Join(root, contractFrontendDir, "runtime.ts")
	require.NoError(t, os.MkdirAll(filepath.Dir(stale), 0o750))
	require.NoError(t, os.WriteFile(stale, []byte("old"), 0o600))
	require.NoError(t, os.WriteFile(handwritten, []byte("kept"), 0o600))
	files := map[string][]byte{filepath.Join(contractFrontendDir, "rows.generated.ts"): []byte("new")}

	err := writeContract(root, files, true)
	assert.ErrorContains(t, err, "gone.generated.ts")
	assert.ErrorContains(t, err, "rows.generated.ts")
	assert.FileExists(t, stale, "check mode repairs nothing")

	require.NoError(t, writeContract(root, files, false))
	assert.NoFileExists(t, stale)
	assert.FileExists(t, handwritten)
	require.NoError(t, writeContract(root, files, true))
}
