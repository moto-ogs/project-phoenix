package parentstore

import (
	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/internal/adapters/parentpostgres"
	recordports "github.com/moto-ogs/project-phoenix/modules/communication/ports"
	"github.com/uptrace/bun"
)

func NewParentMessageRepository(db *bun.DB) recordports.ParentMessageRepository {
	return parentpostgres.NewParentMessageRepository(db)
}
func NewParentMessageThreadRepository(db *bun.DB, guardians recordports.GuardianLister, reachable recordports.ReachableStudentLister) recordports.ParentMessageThreadRepository {
	return parentpostgres.NewParentMessageThreadRepository(db, guardians, reachable)
}

// NewGroupThreadPortal is the guardian side of the group threads (#4784).
// names gives each thread the current name of its group or AG (#8207).
func NewGroupThreadPortal(db *bun.DB, names communication.ParentGroupTargetNames) communication.PortalGroupThreads {
	return parentpostgres.GroupThreadPortal{Store: parentpostgres.NewGroupThreadStore(postgresDatabase(db)), Names: names}
}
