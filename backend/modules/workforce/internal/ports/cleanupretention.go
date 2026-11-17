package ports

import (
	"context"
	"time"
)

// CleanupRetentionStore deletes a school's finished cleanup jobs after the
// retention window (#4046). Every statement uses the school's tenant transaction;
// the file cleanups count on the database clock, the offboarding jobs on the owner's.
type CleanupRetentionStore interface {
	DeleteFinishedStaffDocumentFileCleanups(ctx context.Context, window time.Duration) (int, error)
	DeleteCompletedOffboardingCleanups(ctx context.Context, window time.Duration) (int, error)
}
