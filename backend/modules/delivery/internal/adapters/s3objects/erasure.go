package s3objects

import (
	"context"
	"errors"
	"iter"

	"github.com/minio/minio-go/v7"
	"github.com/moto-ogs/project-phoenix/modules/delivery/contract"
)

func (s *Backend) TenantObjects(ctx context.Context, kind, layout string, tenantID int64, remove bool) (int64, error) {
	prefix, err := contract.TenantObjectPrefix(kind, layout, tenantID)
	if err != nil {
		return 0, err
	}
	if err := s.requireUnversionedBucket(ctx); err != nil {
		return 0, err
	}
	list := s.client.ListObjectsIter(ctx, s.bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true})
	if !remove {
		return countObjects(ctx, list)
	}
	return s.removeObjects(ctx, list)
}

var errS3Inventory = errors.New("storage: S3 inventory failed")

func countObjects(ctx context.Context, list iter.Seq[minio.ObjectInfo]) (int64, error) {
	var count int64
	for object := range list {
		if object.Err != nil {
			return count, errors.Join(errS3Inventory, ctx.Err())
		}
		count++
	}
	return count, ctx.Err()
}

func (s *Backend) removeObjects(ctx context.Context, list iter.Seq[minio.ObjectInfo]) (int64, error) {
	var listingErr error
	objects := func(yield func(minio.ObjectInfo) bool) {
		for object := range list {
			if object.Err != nil {
				listingErr = errS3Inventory
				return
			}
			if !yield(object) {
				return
			}
		}
	}
	results, err := s.client.RemoveObjectsWithIter(ctx, s.bucket, objects, minio.RemoveObjectsOptions{})
	if err != nil {
		return 0, errors.New("storage: S3 removal failed")
	}
	var count int64
	var failure error
	for result := range results {
		if result.Err != nil {
			failure = errors.New("storage: S3 removal failed")
		} else {
			count++
		}
	}
	return count, errors.Join(failure, listingErr, ctx.Err())
}
