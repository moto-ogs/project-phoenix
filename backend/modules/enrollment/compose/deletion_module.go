package compose

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/enrollment/internal/adapters/postgres"
	applicationBindings "github.com/moto-ogs/project-phoenix/modules/enrollment/internal/application"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// DeletionOwner is the owner slice the admin deletion and the retention cleanup read, lock and delete through.
type DeletionOwner interface {
	DeletionQueries
	DeletionRequests
	DeletionChildren
	RejectedRequestCleaner
	UsedLateInviteCleaner
}

// DeletionModuleDependencies are the owner and ports of deletion and cleanup; a nil Audit leaves both unaudited, a nil Retention fails the retention lookup.
type DeletionModuleDependencies struct {
	Owner                 DeletionOwner
	Guardians             GuardianDirectory
	CountAuditAdjustments func(context.Context, int64, *int64) (int, error) // audited offering adjustments of a request or one of its children
	CountBookings         func(context.Context, []int64) (int, error)       // bookings of the request children
	SourceEnrollments     postgres.SourceEnrollmentCount                    // timetable enrollments a request sourced
	Audit                 EnrollmentDeletionAudit
	Delivery              EnrollmentDeletionDelivery
	Retention             RetentionSettings
	Logger                *slog.Logger
	Today                 func() calendar.Date // the cleanup's school day; nil reads the real Berlin day
}

// DeletionModule is the admin deletion and the retention cleanup over one shared impact preview.
type DeletionModule struct {
	Preview   *DeletionPreview
	Deletions enrollment.EnrollmentDeletions
	Cleanup   enrollment.RejectedEnrollmentCleaner
}

// NewDeletionModule composes the admin deletion and the retention cleanup.
func NewDeletionModule(deps DeletionModuleDependencies) DeletionModule {
	preview := NewDeletionPreview(DeletionPreviewDependencies{
		Enrollment: deps.Owner, Guardians: deps.Guardians,
		CountAuditAdjustments: deps.CountAuditAdjustments, CountBookings: deps.CountBookings,
		CountSourceEnrollments: newStore().SourceEnrollments(deps.SourceEnrollments),
	})
	deletions := NewDeletions(DeletionDependencies{
		Requests: deps.Owner, Children: deps.Owner, Preview: preview, Audit: deps.Audit,
		Delivery: deps.Delivery, Logger: applicationBindings.WithService(deps.Logger, "enrollment-deletion"),
	})
	// The cleanup audits through the shared preview only with an audit trail bound (not in focused suites).
	var cleanupPreview *DeletionPreview
	if deps.Audit != nil {
		cleanupPreview = preview
	}
	cleanup := NewRejectedCleanup(RejectedCleanupDependencies{
		Requests: deps.Owner, Children: deps.Owner, LateInvites: deps.Owner, Delivery: deps.Delivery,
		Settings: deps.Retention, Preview: cleanupPreview, Audit: deps.Audit,
		Logger: applicationBindings.WithService(deps.Logger, "enrollment-rejected-cleanup"), Today: deps.Today,
	})
	return DeletionModule{Preview: preview, Deletions: deletions, Cleanup: cleanup}
}
