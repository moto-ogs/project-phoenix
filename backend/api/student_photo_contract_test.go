package api

import (
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/stretchr/testify/require"
)

func TestStudentPhotoServeURLFollowsFileContract(t *testing.T) {
	t.Parallel()
	document, err := ContractDocument()
	require.NoError(t, err)

	for _, route := range document.Routes {
		if route.Key() != "GET /api/students/{id}/photo/{filename}" {
			continue
		}
		address := route.BrowserPath
		if address == "" {
			address = route.Pattern
		}
		filename := "16bba450-274b-4403-b44e-94ace852c9c8.jpg"
		expected := strings.NewReplacer("{id}", "9007199254740993", "{filename}", filename).Replace(address)
		require.Equal(t, expected, common.BuildStudentPhotoServeURL(
			9007199254740993, common.StudentPhotoStoredURLPrefix+filename,
		))
		return
	}
	t.Fatal("student photo has no registered file route")
}
