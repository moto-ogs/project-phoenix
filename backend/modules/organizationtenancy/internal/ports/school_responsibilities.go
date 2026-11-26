package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/domain"
)

// SchoolPartyStore persists the Schulträger and the Gemeinde of the schools
// of a Träger (#4811). Every method runs in the caller's Träger transaction
// of organizationID and names the Träger in its own filter again.
type SchoolPartyStore interface {
	// LockProfile holds the Träger's profile row until the end of the
	// transaction, so two writes of one Träger run one after the other.
	LockProfile(ctx context.Context, organizationID int64, create bool) (organizationtenancy.TraegerProfile, error)
	// TraegerSchoolNames lists the undeleted schools of the Träger by name.
	TraegerSchoolNames(ctx context.Context, organizationID int64) ([]organizationtenancy.TraegerSchoolName, error)
	// SchoolParties reads the stored bodies of the given schools of the
	// Träger, by school and kind; nil reads those of every school.
	SchoolParties(ctx context.Context, organizationID int64, schoolIDs []int64) ([]organizationtenancy.SchoolParty, error)
	// OwnSchoolParties reads in one statement the stored bodies of the
	// undeleted schools of the Träger, by school and kind; nil asks for
	// every school (#8040).
	OwnSchoolParties(ctx context.Context, organizationID int64, schoolIDs []int64) ([]organizationtenancy.SchoolParty, error)
	// SaveSchoolParty inserts the body of the school or overwrites it.
	SaveSchoolParty(ctx context.Context, organizationID, accountID, schoolID int64, kind organizationtenancy.ResponsibleBody, input organizationtenancy.SchoolPartyInput) (organizationtenancy.SchoolParty, error)
	// DeleteSchoolParty reports false when the school has no such body.
	DeleteSchoolParty(ctx context.Context, organizationID, schoolID int64, kind organizationtenancy.ResponsibleBody) (bool, error)
	AppendAudit(ctx context.Context, entry domain.TraegerMasterDataAuditEntry) error
}
