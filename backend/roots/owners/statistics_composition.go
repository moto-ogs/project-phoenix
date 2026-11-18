package owners

import (
	"context"
	"log/slog"

	settingsModule "github.com/moto-ogs/project-phoenix/modules/settings"

	careContractCompose "github.com/moto-ogs/project-phoenix/modules/carecontract/compose"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// NewStatistics builds the Statistik report over the presence database of
// deps with the operation logging of NewLoggedStudentPresence.
func NewStatistics(logger *slog.Logger, deps presenceCompose.StatisticsDependencies) studentpresence.StatisticsReports {
	deps.Observe = presenceCompose.DebugLogger(logger)
	reports, err := presenceCompose.NewStatistics(deps)
	if err != nil {
		panic(err)
	}
	return reports
}

// StatisticsSettings keeps the history switch separate from unrelated retention consumers.
type StatisticsSettings interface {
	RetentionSettings
	ResolveBool(context.Context, string) (bool, error)
}

// newStatisticsReports binds the Statistik report to the owners it reads;
// the service graph calls the result with its access log and retention
// settings. The demo shows a weekday history alongside its live simulation.
func newStatisticsReports(db transactionruntime.Database, carePlan careplan.StudentStatusDaysQuery, careDays careplan.CareDayQuery, calendar schoolcalendar.Days, students statisticsStudentRows, birthdays statisticsBirthdays, rooms facilities.Query, env RootEnvironment) func(AccessLogLedger, StatisticsSettings) studentpresence.StatisticsReports {
	return func(accessLog AccessLogLedger, settings StatisticsSettings) studentpresence.StatisticsReports {
		return NewStatistics(env.Logger, presenceCompose.StatisticsDependencies{
			DB:               db.Pool(),
			StatusDays:       StatisticsStatusDays{carePlan},
			Courses:          NewCourseStatistics(db),
			Holidays:         schoolCalendarCompose.NewTenantHolidays(calendar),
			CalendarDays:     calendar,
			Students:         StatisticsReportStudents{students},
			Rooms:            StatisticsReportRooms{rooms},
			AccessLog:        StatisticsAuditLog{accessLog},
			Retention:        settingsModule.NewStatisticsRetention(settings),
			PlannedCareDays:  StatisticsPlannedCareDays{careDays},
			ContractCareDays: StatisticsContractCareDays{careContractCompose.NewBookedCare()},
			HolidayCareDays:  StatisticsHolidayCareDays{enrollmentCompose.NewHolidayGuestBookedCare(StatisticsHolidayStudents{birthdays})},
			DemoHistory:      email.IsDemoEnvironment(env.Config.AppEnv),
			Logger:           env.Logger.With("service", "statistics"),
			Now:              env.Now,
		})
	}
}
