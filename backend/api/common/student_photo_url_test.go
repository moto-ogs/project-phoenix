package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStudentPhotoVersion(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "abc.jpg", StudentPhotoVersion(StudentPhotoStoredURLPrefix+"abc.jpg"))
	for _, path := range []string{"", "/legacy/avatars/foo.jpg", StudentPhotoStoredURLPrefix + "../other.jpg", StudentPhotoStoredURLPrefix + ".."} {
		assert.Empty(t, StudentPhotoVersion(path))
	}
}
