package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewChildQuotaCounts composes the cross-school Kontingentzahl of the
// operator school overview (#3568). It reads on the caller's administrative
// transaction and counts on the root's Berlin day, the day every membership
// write is checked on.
func NewChildQuotaCounts(today func() calendar.Date) schoolmembership.ChildQuotaCounts {
	return NewChildQuotaCountsWithClock(postgres.SchoolDay(today))
}

// NewChildQuotaCountsWithClock binds the count day at construction.
func NewChildQuotaCountsWithClock(today func() string) schoolmembership.ChildQuotaCounts {
	return postgres.NewChildQuotaCounts(today, tenant.TransactionFromContext, tenant.IsAdminTx)
}
