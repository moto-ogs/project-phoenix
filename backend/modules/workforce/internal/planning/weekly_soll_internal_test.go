package planning

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TestWeeklySollLeavesOutOnlyTheOwnSchoolsDaysOff: a closing day of the
// checking school drops its own share of the Soll, never the share of
// another Einsatzort, whose calendar it cannot read (#4708, ADR 0242).
func TestWeeklySollLeavesOutOnlyTheOwnSchoolsDaysOff(t *testing.T) {
	t.Parallel()
	wednesday := calendar.NewDate(2026, 11, 25)
	thursday := calendar.NewDate(2026, 11, 26)
	days := []workforce.ShiftPlanSollDay{
		{StaffRecordID: 1, Date: wednesday, Own: true, Minutes: 300},
		{StaffRecordID: 1, Date: wednesday, Own: false, Minutes: 240},
		{StaffRecordID: 1, Date: thursday, Own: true, Minutes: 300},
	}
	weeks := WeeklySoll(days, map[calendar.Date]bool{wednesday: true})
	assert.Equal(t, map[string]int{"2026-11-23": 540}, weeks)
}
