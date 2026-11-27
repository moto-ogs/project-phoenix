package settings

import (
	"context"
)

// StudentPhotosEnabled propagates lookup failures instead of inventing photo policy.
func StudentPhotosEnabled(ctx context.Context, settings interface {
	ResolveBool(context.Context, string) (bool, error)
}) (bool, error) {
	return settings.ResolveBool(ctx, KeyStudentPhotosEnabled)
}
