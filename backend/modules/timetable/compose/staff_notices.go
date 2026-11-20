package compose

import (
	"context"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

// StaffNoticeDependencies binds the staff notices (#2180) to the database, the root's readers
// and the feed of a new Hinweis (#7143); application.StaffNoticeDependencies names the optional ones.
type StaffNoticeDependencies struct {
	DB           *bun.DB
	Periods      application.StaffNoticePeriodLookup
	Names        func(ctx context.Context, accountIDs []int64) (map[int64]string, error)
	Publications ports.StaffNoticePublications
	// Changes signals a new, changed or deleted notice after the commit (#7667); optional.
	Changes ports.StaffingAnnouncer
	Logger  *slog.Logger
	Now     func() time.Time // stamps and dates the notices; required
}

// NewStaffNotices builds the staff notices over the owner's repository.
func NewStaffNotices(deps StaffNoticeDependencies) timetable.StaffNotices {
	return application.NewStaffNotices(NewStaffNoticeRepository(deps.DB, deps.Now), application.StaffNoticeDependencies{
		Periods: deps.Periods, Names: deps.Names, Publications: deps.Publications, Changes: deps.Changes, Logger: deps.Logger, CurrentDate: calendar.CalendarDateClock(deps.Now),
	})
}

// NewStaffNoticeRepository builds the retained staff notice repository; now is required.
func NewStaffNoticeRepository(db *bun.DB, now func() time.Time) ports.StaffNoticeRecords {
	return application.NewStaffNoticeRecords(postgres.NewStaffNoticeRepository(postgres.New(postgres.DatabaseRuntime(db)).WithClock(now)), transaction{})
}
