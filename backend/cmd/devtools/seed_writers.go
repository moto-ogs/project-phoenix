package main

import (
	"context"
	"os"
	"strings"
	"time"

	seedapi "github.com/moto-ogs/project-phoenix/internal/devtools/seedapi"
	devicefleetCompose "github.com/moto-ogs/project-phoenix/modules/devicefleet/compose"
	feedbackCompose "github.com/moto-ogs/project-phoenix/modules/feedback/compose"
	organizationCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	schoolMembershipCompose "github.com/moto-ogs/project-phoenix/modules/schoolmembership/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// seedWriters bind the seed's writes that no route a client uses can make
// (ADR 0298): the past ratings through Feedback, the seeded school vacations
// through School Calendar and the billing snapshot through Organisation &
// Tenancy, on the database the server uses (DB_DSN). Without DB_DSN, as in
// the sidecar of the public demo, every writer is nil; close is then a no-op.
type seedWriters struct {
	feedback        seedapi.FeedbackHistoryWriter
	schoolVacations seedapi.SchoolVacationWriter
	keyDateCounts   func(context.Context) (int, error)
}

func openSeedWriters() (seedWriters, func(), error) {
	if strings.TrimSpace(os.Getenv("DB_DSN")) == "" {
		return seedWriters{}, func() {}, nil
	}
	db, err := transactionruntime.OpenDatabase()
	if err != nil {
		return seedWriters{}, nil, err
	}
	unit := func(ctx context.Context) context.Context { return tenant.WithUnitOfWork(ctx, db.UnitOfWork()) }
	history := feedbackCompose.NewFeedbackHistory(time.Now)
	vacations, err := schoolCalendarCompose.NewSchoolVacations(nil, "", nil)
	if err != nil {
		_ = db.Close()
		return seedWriters{}, nil, err
	}
	billing, err := organizationCompose.NewBilling(organizationCompose.BillingDependencies{Counts: seedBillingCounts{}})
	if err != nil {
		_ = db.Close()
		return seedWriters{}, nil, err
	}
	return seedWriters{
		feedback: func(ctx context.Context, schoolID int64, entries []seedapi.PastFeedback) (int, error) {
			return history.RecordFeedbackHistory(tenant.WithTenantID(unit(ctx), schoolID), ownerFeedback(entries))
		},
		schoolVacations: func(ctx context.Context, windows []seedapi.SchoolVacationWindow) (int, error) {
			owned := make([]schoolCalendarCompose.SchoolVacation, len(windows))
			for i, window := range windows {
				owned[i] = schoolCalendarCompose.SchoolVacation{Name: window.Name, StartDate: window.StartDate, EndDate: window.EndDate}
			}
			return vacations.SeedSchoolVacations(unit(ctx), owned)
		},
		keyDateCounts: func(ctx context.Context) (int, error) {
			return billing.SeedBillingKeyDateCounts(unit(ctx), time.Now())
		},
	}, func() { _ = db.Close() }, nil
}

func ownerFeedback(entries []seedapi.PastFeedback) []feedbackCompose.PastFeedback {
	owned := make([]feedbackCompose.PastFeedback, len(entries))
	for i, entry := range entries {
		owned[i] = feedbackCompose.PastFeedback{
			Value: entry.Value, Day: feedbackCompose.Date(entry.Day), Time: entry.Time,
			StudentID: entry.StudentID, IsMensaFeedback: entry.IsMensaFeedback,
		}
	}
	return owned
}

// seedBillingCounts binds the billing snapshot's counts to their owners, as
// the server's root does: School Membership counts the active students,
// Device Fleet the active terminals.
type seedBillingCounts struct{}

func (seedBillingCounts) CountActiveStudentsByTenant(ctx context.Context, capturedAt time.Time) (map[int64]int, error) {
	return schoolMembershipCompose.NewActiveStudentCounts().CountActiveStudentsByTenant(ctx, capturedAt)
}

func (seedBillingCounts) CountActiveTerminalsByTenant(ctx context.Context) (map[int64]int, error) {
	return devicefleetCompose.NewActiveTerminalCounts().CountActiveTerminalsByTenant(ctx)
}
