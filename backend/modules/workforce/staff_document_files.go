package workforce

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
)

type StaffDocumentObjectRemover interface {
	RemovePrivate(ctx context.Context, kind string, tenantID int64, storedName string) error
}

// StaffDocumentFileRecovery removes the stored bytes of staff documents: the
// scheduler's recovery pass, the leased offboarding cleanup and the removal
// of one stored file.
type StaffDocumentFileRecovery interface {
	// CleanupOrphanedStaffDocumentFiles retries file removal independently of
	// document UI traffic. The scheduler calls it in each tenant transaction
	// after the upload grace period has elapsed.
	CleanupOrphanedStaffDocumentFiles(ctx context.Context) (int, error)
	// RunOffboardingDocumentCleanup claims and runs due offboarding cleanups.
	RunOffboardingDocumentCleanup(ctx context.Context) (int, error)
	// WakeOffboardingDocumentCleanup runs the offboarding cleanup after the
	// transaction of ctx commits.
	WakeOffboardingDocumentCleanup(ctx context.Context)
}

// RemoveStoredDocument deletes one stored file of the tenant. The file may already be absent.
func RemoveStoredDocument(ctx context.Context, objects StaffDocumentObjectRemover, tenantID int64, storedName string) error {
	if storedName == "" || strings.Contains(storedName, "..") || filepath.Base(storedName) != storedName {
		return errors.New("stored document filename failed validation on delete")
	}
	if err := objects.RemovePrivate(ctx, StaffDocumentStorageKind, tenantID, storedName); err != nil {
		return errors.New("failed to remove stored document")
	}
	return nil
}
