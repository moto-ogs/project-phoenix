package api

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStudentPhotoHasFileContract(t *testing.T) {
	t.Parallel()
	document, err := ContractDocument()
	require.NoError(t, err)

	for _, route := range document.Routes {
		if route.Key() != "GET /api/students/{id}/photo/{filename}" {
			continue
		}
		require.True(t, route.File)
		return
	}
	t.Fatal("student photo has no registered file route")
}
