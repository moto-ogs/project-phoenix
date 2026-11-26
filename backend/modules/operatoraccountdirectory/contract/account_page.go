package contract

import (
	"context"
	"errors"
)

const AccountPageSize = 50

var (
	ErrInvalidAccountCursor = errors.New("invalid account page cursor")
	ErrInvalidAccountSort   = errors.New("invalid account sort")
)

// AccountScope restricts the operator directory to one school or organization.
// With both IDs zero it includes every non-deleted school.
type AccountScope struct {
	SchoolID       int64
	OrganizationID int64
}

type AccountPageQuery struct {
	Sort       string
	Descending bool
	Search     string
	Cursor     string
}

type AccountRow struct {
	SchoolID      int64
	AccountID     int64
	InvitationID  int64
	SchoolName    string
	Email         string
	Active        bool
	FirstName     string
	LastName      string
	RoleName      string
	PedagogicRole string
	Status        string
	HasAdminRole  bool
	HasUserRole   bool
	HasCaregiver  bool
}

type AccountPage struct {
	Rows       []AccountRow
	Total      int
	Number     int
	NextCursor string
}

type AccountDirectory interface {
	AccountPage(context.Context, AccountScope, AccountPageQuery) (AccountPage, error)
}
