package s3objects

import (
	"context"
	"testing"

	"github.com/minio/minio-go/v7"
	"github.com/stretchr/testify/require"
)

func TestCountObjectsRejectsPartialInventoryAfterCancellation(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	list := func(yield func(minio.ObjectInfo) bool) {
		// MinIO may stop between pages without yielding an error entry.
		yield(minio.ObjectInfo{Key: "staff-documents/18/report.pdf"})
		cancel()
	}
	count, err := countObjects(ctx, list)
	require.EqualValues(t, 1, count)
	require.ErrorIs(t, err, context.Canceled)
}
