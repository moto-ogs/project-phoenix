package api

// The Hinweise der Leitung source of "Heute anders" (ADR 0299, #7667). The
// owner is Timetable: its read of the day's notices for the staff portal
// decides which notices apply (period, weekdays, week pattern, audience) and
// carries the caller's own acknowledgement. This binding applies the rule of
// the existing read path (users:read, like GET /api/staff-notices/today) and
// translates the notices into the projection's vocabulary.

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesNoticeReads is Timetable's read of the day's notices.
type dayChangesNoticeReads interface {
	StaffNoticesOn(ctx context.Context, accountID int64, date string, reader string) ([]timetable.StaffNoticeView, error)
}

// newDayChangesNoticeReads builds Timetable's notices for the overview's
// reads: the calendar periods resolve the week pattern, as on the page.
func newDayChangesNoticeReads(db transactionruntime.Database, days schoolcalendar.Calendar, planning timetable.Capability, now func() time.Time) dayChangesNoticeReads {
	return timetableCompose.NewStaffNotices(timetableCompose.StaffNoticeDependencies{
		DB: db.Pool(), Periods: timetableCompose.NewCalendarPeriodRepository(days, newCalendarPeriodUsage(planning)), Now: now,
	})
}

// dayChangesNotices is the Hinweise der Leitung source.
type dayChangesNotices struct{ reads dayChangesNoticeReads }

func (s dayChangesNotices) StaffNotices(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !securityruntime.HasPermission(permissions.UsersRead, sessiontoken.PermissionsFromCtx(ctx)) {
		// The account may not read the notices: no entries, not a failure.
		return nil, nil
	}
	accountID := int64(sessiontoken.ClaimsFromCtx(ctx).ID)
	notices, err := s.reads.StaffNoticesOn(ctx, accountID, day.String(), timetable.StaffNoticeAudienceStaff)
	if err != nil {
		return nil, fmt.Errorf("list staff notices: %w", err)
	}
	entries := make([]daychangesview.SourceEntry, 0, len(notices))
	for _, notice := range notices {
		entries = append(entries, dayChangesNoticeEntry(notice))
	}
	return entries, nil
}

// dayChangesNoticeEntry puts a notice the caller still has to confirm under
// "Betrifft dich"; a confirmed one and one without acknowledgement stand
// under "Schule".
func dayChangesNoticeEntry(notice timetable.StaffNoticeView) daychangesview.SourceEntry {
	acknowledged := notice.AcknowledgedAt != nil
	priority := daychangesview.NoticeInfo
	if notice.Priority == timetable.StaffNoticePriorityImportant {
		priority = daychangesview.NoticeImportant
	}
	return daychangesview.SourceEntry{
		Kind:     daychangesview.KindStaffNotice,
		Involved: notice.RequiresAcknowledgement && !acknowledged,
		Link:     &daychangesview.Link{Target: daychangesview.LinkStaffNotices},
		Notice: &daychangesview.DayNotice{
			ID: notice.ID, Title: notice.Title, Body: notice.Body, Priority: priority,
			RequiresAcknowledgement: notice.RequiresAcknowledgement, Acknowledged: acknowledged,
		},
	}
}
