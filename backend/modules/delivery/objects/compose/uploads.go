package compose

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/adapters/s3objects"
	"github.com/moto-ogs/project-phoenix/modules/delivery/objects"
)

func NewBackend(ctx context.Context, config objects.UploadStorageConfig, localRoot string) (objects.UploadBackend, error) {
	return config.Open(ctx, localRoot, s3objects.New)
}
