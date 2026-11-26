package enrollmenthttp

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// renderHolidayWeekWithoutCare answers a week that contains a day without
// care at its host school (#4702) with 409 and the day it names, and reports
// whether err was such a refusal. The week is its position in the written
// period or booking, week_id its ID once stored.
func renderHolidayWeekWithoutCare(w http.ResponseWriter, r *http.Request, err error) bool {
	var refusal *capability.HolidayWeekNoCareDayRefusal
	if !errors.As(err, &refusal) {
		return false
	}
	common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeEnrollmentHolidayWeekNoCareDay, common.HolidayWeekNoCareDetails{
		Week: refusal.Week, WeekID: ident.ID(refusal.WeekID), Date: refusal.Day.Date.Format("02.01.2006"),
		ISODate: refusal.Day.Date, Kind: refusal.Day.Kind, Name: refusal.Day.Name,
	}))
	return true
}

// noCareDaysOrEmpty answers an empty list for an unmarked week.
func noCareDaysOrEmpty(days []capability.HolidayNoCareDay) []capability.HolidayNoCareDay {
	if days == nil {
		return []capability.HolidayNoCareDay{}
	}
	return days
}
