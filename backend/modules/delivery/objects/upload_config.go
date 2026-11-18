package objects

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

type UploadStorageConfig struct {
	backend, endpoint, region, bucket, accessKey, secretKey string
}

func UploadStorageConfigFrom(read func(string) string) UploadStorageConfig {
	return UploadStorageConfig{
		backend: read("UPLOADS_BACKEND"), endpoint: read("UPLOADS_S3_ENDPOINT"),
		region: read("UPLOADS_S3_REGION"), bucket: read("UPLOADS_S3_BUCKET"),
		accessKey: read("UPLOADS_S3_ACCESS_KEY"), secretKey: read("UPLOADS_S3_SECRET_KEY"),
	}
}

func (c UploadStorageConfig) IsLocal() bool { return c.backend == "" || c.backend == "local" }

// Open selects the byte backend once in each root. With local
// storage the optional root comes from the maintenance command's mount flag.
func (c UploadStorageConfig) Open(ctx context.Context, localRoot string, s3 func(context.Context, string, string, string, string, string) (UploadBackend, error)) (UploadBackend, error) {
	switch {
	case c.IsLocal():
		if localRoot == "" {
			public, err := ResolvePublicDir()
			if err != nil {
				return nil, err
			}
			localRoot = filepath.Join(public, "uploads")
		}
		return NewLocal(localRoot), nil
	case c.backend == "s3":
		if err := c.validateS3(); err != nil {
			return nil, err
		}
		return s3(ctx, c.endpoint, c.region, c.bucket, c.accessKey, c.secretKey)
	default:
		return nil, errors.New("storage: UPLOADS_BACKEND must be local or s3")
	}
}

func (c UploadStorageConfig) validateS3() error {
	var missing []string
	for _, value := range []struct{ key, value string }{
		{"UPLOADS_S3_ENDPOINT", c.endpoint}, {"UPLOADS_S3_REGION", c.region},
		{"UPLOADS_S3_BUCKET", c.bucket}, {"UPLOADS_S3_ACCESS_KEY", c.accessKey},
		{"UPLOADS_S3_SECRET_KEY", c.secretKey},
	} {
		if value.value == "" {
			missing = append(missing, value.key)
		}
	}
	if len(missing) != 0 {
		return fmt.Errorf("storage: missing %s", strings.Join(missing, ", "))
	}
	return nil
}
