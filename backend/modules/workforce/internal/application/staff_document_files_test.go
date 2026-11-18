package application

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type documentFilesFixture struct{ root string }

func (f documentFilesFixture) RemovePrivate(_ context.Context, kind string, tenantID int64, name string) error {
	err := os.Remove(filepath.Join(f.root, kind, strconv.FormatInt(tenantID, 10), name))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

type noStaffDocuments struct{ workforce.StaffDocuments }

type noDocumentCleanupQueue struct{ workforce.DocumentCleanupQueue }

func TestNewStaffDocumentFileRecoveryRequiresEveryDependency(t *testing.T) {
	t.Parallel()
	documents, queue, uploads := noStaffDocuments{}, noDocumentCleanupQueue{}, documentFilesFixture{}
	for name, build := range map[string]func() (workforce.StaffDocumentFileRecovery, error){
		"documents": func() (workforce.StaffDocumentFileRecovery, error) {
			return NewStaffDocumentFileRecovery(nil, queue, uploads, slog.Default())
		},
		"queue": func() (workforce.StaffDocumentFileRecovery, error) {
			return NewStaffDocumentFileRecovery(documents, nil, uploads, slog.Default())
		},
		"uploads": func() (workforce.StaffDocumentFileRecovery, error) {
			return NewStaffDocumentFileRecovery(documents, queue, nil, slog.Default())
		},
		"logger": func() (workforce.StaffDocumentFileRecovery, error) {
			return NewStaffDocumentFileRecovery(documents, queue, uploads, nil)
		},
	} {
		recovery, err := build()
		assert.Nil(t, recovery, name)
		assert.EqualError(t, err, "workforce staff document files: all dependencies are required", name)
	}
}

func TestStaffDocumentFileRecoveryRemovesOnlyPlainStoredNames(t *testing.T) {
	t.Parallel()
	publicDir := t.TempDir()
	objects := documentFilesFixture{root: publicDir}

	dir := filepath.Join(publicDir, "staff-documents", "42")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	stored := filepath.Join(dir, "document.pdf")
	require.NoError(t, os.WriteFile(stored, []byte("pdf"), 0o600))

	require.NoError(t, workforce.RemoveStoredDocument(t.Context(), objects, 42, "document.pdf"))
	_, statErr := os.Stat(stored)
	assert.True(t, os.IsNotExist(statErr), "the stored file is removed")
	require.NoError(t, workforce.RemoveStoredDocument(t.Context(), objects, 42, "document.pdf"), "a missing file is no error")

	for _, name := range []string{"", "../document.pdf", "nested/document.pdf"} {
		assert.EqualError(t, workforce.RemoveStoredDocument(t.Context(), objects, 42, name), "stored document filename failed validation on delete", name)
	}
}
