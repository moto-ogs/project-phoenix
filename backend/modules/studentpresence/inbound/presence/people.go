package presence

import (
	"context"
)

type PersonIdentity struct{ ID int64 }

type StaffIdentity struct {
	ID       int64
	TenantID int64
}

// People supplies identity and student lookups used by attendance routes.
type People interface {
	FindByAccountID(context.Context, int64) (*PersonIdentity, error)
	GetStaffByPersonID(context.Context, int64) (*StaffIdentity, error)
}
