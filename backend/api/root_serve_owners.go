package api

import (
	"context"
	"errors"
	"fmt"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	staffAudience "github.com/moto-ogs/project-phoenix/modules/staffannouncementaudience"
	"github.com/moto-ogs/project-phoenix/modules/staffannouncementaudience/contract"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	communicationModule "github.com/moto-ogs/project-phoenix/modules/communication"
	communicationCompose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// The owner modules of the serving roots, observed into the metrics sinks.

// buildCalendarAdministration composes the School Calendar's period
// administration: the recurrence gate serializes it against every
// recurrence-derived write, and Care Plan's catalog refuses a period change
// a linked care offering still needs.
//
// A planned, changed or cancelled closing day reaches the whole school and
// its families through Delivery's notification feed, without the account of
// the request that changed it (#7144).
//
// A changed closing day cancels or plans again the unchanged series shifts
// of the days it closed or opened, in the same transaction (#8205).
func buildCalendarAdministration(db transactionruntime.Database, observe func(schoolCalendarCompose.Observation), records schoolcalendar.Days, lock timetable.RecurrenceWriteLock, offerings careplan.CareOfferingGuards, notifications owners.DeliveryNotifications, breakDays workforce.SeriesBreakDays) (schoolcalendar.Calendar, error) {
	return schoolCalendarCompose.NewAdministration(records, schoolCalendarCompose.AdministrationDependencies{
		DB: db.Pool(), Observe: observe, RecurrenceGate: lock.LockRecurrenceWrites,
		ClosingDayPlans: owners.NewSchoolCalendarClosingDayPlans(breakDays),
		ClosingDayNotices: owners.NewSchoolCalendarClosingDayNotices(notifications, func(ctx context.Context) int64 {
			return int64(sessiontoken.ClaimsFromCtx(ctx).ID)
		}),
		CareOfferingGuard: func(ctx context.Context, periodID int64, replacement *schoolcalendar.CalendarPeriodFields) error {
			err := offerings.ValidateCalendarPeriodChange(ctx, periodID, calendarPeriodReplacement(replacement))
			if errors.Is(err, careplan.ErrCalendarPeriodCareOfferingConflict) {
				return fmt.Errorf("%w: %w", schoolcalendar.ErrCalendarPeriodRequiredByCareOffering, err)
			}
			return err
		},
	})
}

// buildCommunicationModule composes Communication over Organisation &
// Tenancy, the People Directory's viewer names and the operator audit log.
func buildCommunicationModule(db transactionruntime.Database, env owners.RootEnvironment, organizations organizationtenancy.Capability, persons peopledirectory.Capability, operatorAuditLog owners.OperatorAuditEntries) (communicationModule.Capability, error) {
	return NewCommunicationAnnouncements(communicationCompose.Dependencies{
		DB:            db.Pool(),
		Organizations: organizations,
		Viewers:       communicationViewerNames{query: persons},
		Audit:         NewCommunicationAnnouncementAudit(operatorAuditLog.Create),
		Observe:       env.Observe.Communication,
		Now:           env.Now,
	})
}

// NewCommunicationAnnouncements binds the staff audience projection at the root.
func NewCommunicationAnnouncements(deps communicationCompose.Dependencies) (communicationModule.Capability, error) {
	return communicationCompose.New(deps, staffAudience.Map(staffAudience.New(communicationCompose.AnnouncementDatabase()), announcementAudienceMapping()))
}

func announcementAudienceMapping() contract.Rows[communicationModule.Announcement, communicationModule.AnnouncementViewDetail, communicationCompose.OperationStats] {
	return contract.Rows[communicationModule.Announcement, communicationModule.AnnouncementViewDetail, communicationCompose.OperationStats]{
		Announcement: func(row contract.Announcement) communicationModule.Announcement {
			return communicationModule.Announcement(row)
		},
		Target: func(value communicationModule.Announcement) contract.Target {
			return contract.Target{PublishedAt: value.PublishedAt, TargetRoles: value.TargetRoles, TargetOrgIDs: value.TargetOrgIDs, TargetTenantIDs: value.TargetTenantIDs}
		},
		View: func(row contract.ViewDetail) communicationModule.AnnouncementViewDetail {
			return communicationModule.AnnouncementViewDetail(row)
		},
		Stats: func(stats contract.Stats) communicationCompose.OperationStats {
			return communicationCompose.OperationStats{Queries: stats.Queries, Rows: stats.Rows, StatementDuration: stats.StatementDuration}
		},
	}
}
