package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

type PrivacyConsentStore interface {
	// LockPrivacyConsents holds the consents of one student until the
	// tenant transaction ends, also while the student has none yet.
	LockPrivacyConsents(context.Context, int64) (Stats, error)
	RevisePrivacyConsent(context.Context, *studentpresence.PrivacyConsent) (Stats, error)
	ListAcceptedRetentionSettings(context.Context) ([]studentpresence.StudentRetentionSetting, Stats, error)
	// ListPrivacyConsents returns the consents of one student, oldest first.
	ListPrivacyConsents(context.Context, int64) ([]studentpresence.PrivacyConsent, Stats, error)
	// RecordPrivacyConsent inserts one consent row and fills the generated
	// columns on the passed value.
	RecordPrivacyConsent(context.Context, *studentpresence.PrivacyConsent) (Stats, error)
	// RecordPrivacyConsents inserts many consent rows in one statement with
	// the columns RecordPrivacyConsent writes.
	RecordPrivacyConsents(context.Context, []studentpresence.PrivacyConsent) (Stats, error)
}
