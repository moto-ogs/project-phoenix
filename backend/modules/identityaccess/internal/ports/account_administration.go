package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

// AccountAdministrationStore is the persistence port over the auth.accounts
// row the account administration reads and writes (#3332). Ordinary management
// reads and writes carry the caller's visibility
// predicate in the same statement, so the boundary cannot be lost between a
// read and the write it authorizes. Statements run on the connection the
// caller's context carries. Platform deletion anonymization is explicitly
// account-wide; its workflow authorizes the target before calling.
type AccountAdministrationStore interface {
	// AnonymizeAccountForDeletion is the account-wide write used by an
	// authorized platform deletion workflow, not a school-management edit.
	AnonymizeAccountForDeletion(context.Context, int64, string) (domain.OperationStats, error)
	// FindAccountRecord reads the account without the administration
	// predicate. It serves the caller's own account and the credential
	// verification of a password change, both of which are the account
	// holder's own business.
	FindAccountRecord(ctx context.Context, id int64) (domain.ManagedAccountRecord, bool, domain.OperationStats, error)
	// FindManageableAccountRecord reads one account within the caller's
	// visibility.
	FindManageableAccountRecord(ctx context.Context, id int64, visibility domain.AccountVisibility) (domain.ManagedAccountRecord, bool, domain.OperationStats, error)
	// DeactivateManageableAccount clears the active flag within the caller's
	// visibility. found=false when the predicate matched no row.
	DeactivateManageableAccount(ctx context.Context, id int64, visibility domain.AccountVisibility) (bool, domain.OperationStats, error)
	// WriteAccountCredential is the one credential writer (#6289): it moves
	// the credential generation on with every write; see the adapter.
	WriteAccountCredential(ctx context.Context, accountID int64, write domain.CredentialWrite) (bool, domain.OperationStats, error)
	// FindAnalyticsConsent reads the holder's usage analytics answer (#4901);
	// found=false when the row is gone or erased.
	FindAnalyticsConsent(ctx context.Context, id int64) (domain.AnalyticsConsent, bool, domain.OperationStats, error)
	// SetAnalyticsConsent records the holder's answer with the time of the
	// decision; found=false when the row is gone or erased.
	SetAnalyticsConsent(ctx context.Context, id int64, granted bool) (bool, domain.OperationStats, error)
}
