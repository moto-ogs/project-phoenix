package peopledirectory

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StudentRecordIdentity is a child record of the school with the names and
// the date of birth of its person; Birthday is nil without one.
type StudentRecordIdentity struct {
	StudentID int64
	FirstName string
	LastName  string
	Birthday  *calendar.Date
}

// StudentRecordIdentities reads the child records of the school whose tenant
// transaction the caller holds by their identifiers, in one statement
// (#7760): also a child whose care has ended or who graduated, never a
// deleted one. An identifier the school does not have answers nothing.
type StudentRecordIdentities interface {
	StudentRecordIdentities(ctx context.Context, ids []int64) ([]StudentRecordIdentity, error)
}
