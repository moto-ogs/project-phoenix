package organizationtenancy

import "context"

const AccountPageSize = 50

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

type AccountPage struct {
	Rows       []OrganizationAccount
	Total      int
	Number     int
	NextCursor string
}

type AccountDirectory interface {
	ListAccountPage(context.Context, AccountScope, AccountPageQuery) (AccountPage, error)
}
