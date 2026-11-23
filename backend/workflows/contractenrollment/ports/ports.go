// Package ports declares the consumer-owned ports of the enrollment of the
// children of imported contracts (ADR 0309 section 4); the root binds them
// to the owners.
package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Contracts are Care Contract's plan and binding: the read and the binding
// in the Träger transaction, the plan in the school's tenant transaction.
type Contracts = carecontract.ContractEnrollments

// SchoolEnrollments is Enrollment's silent enrollment in the school's
// tenant transaction.
type SchoolEnrollments = enrollment.ContractEnrollments

// Schools lists the undeleted schools of a Träger (Organisation & Tenancy).
type Schools interface {
	TraegerSchoolIDs(ctx context.Context, organizationID int64) ([]int64, error)
}

// Child is a child record as the school has it.
type Child struct {
	StudentID int64
	FirstName string
	LastName  string
	BirthDate *calendar.Date
}

// Children reads the child records of the school whose tenant transaction
// the caller holds, by their identifiers and in a fixed number of
// statements (People Directory). A child record the school does not have is
// not in the answer.
type Children interface {
	SchoolChildren(ctx context.Context, studentIDs []int64) ([]Child, error)
}

// SchoolRead is a read of the Träger-Büro at a school: the imported
// contracts it looked at and the child records it saw.
type SchoolRead struct {
	OrganizationID int64
	AccountID      int64
	ContractIDs    []int64
	StudentIDs     []int64
}

// Access writes a read into the access log of the school whose tenant
// transaction the caller holds (ADR 0084 section 7).
type Access interface {
	RecordAccess(ctx context.Context, read SchoolRead) error
}

// Runtime opens the Träger transaction or one school's tenant transaction,
// never both at once (ADR 0105 point 2).
type Runtime interface {
	WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error
	WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error
}

// Dependencies bind the workflow to its owners.
type Dependencies struct {
	Contracts         Contracts
	SchoolEnrollments SchoolEnrollments
	Schools           Schools
	Children          Children
	Access            Access
	Runtime           Runtime
	// Fingerprint is the SHA-256 hex digest of content (Security Runtime).
	Fingerprint func(content []byte) string
}
