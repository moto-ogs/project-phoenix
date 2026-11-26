package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/application"
)

func NewNonWorkingDays(source schoolcalendar.NonWorkingDayQuery) application.NonWorkingDays {
	return application.NewNonWorkingDays(source)
}
func NewTenantHolidays(source schoolcalendar.NonWorkingDayQuery) application.TenantHolidays {
	return application.NewTenantHolidays(source)
}
func NewCalendarPeriodIDs(source schoolcalendar.Query) application.CalendarPeriodIDs {
	return application.NewCalendarPeriodIDs(source)
}
func NewNoticedOpeningChanges(notices schoolcalendar.OpeningChangeNotices, today func() string) schoolcalendar.OpeningChanges {
	return application.NewNoticedOpeningChanges(postgres.NewOpeningChangeStore(postgres.NewCompositionDatabase()), notices, today)
}
