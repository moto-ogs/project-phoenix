package careplan_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

// The mark of the Träger-Büro replaces a staff author only where there is
// none: a staff member of the school is always named in the row itself.
func TestEnteredByTraeger(t *testing.T) {
	t.Parallel()

	plain := context.Background()
	traeger := careplan.WithTraegerBueroAuthor(plain)
	const staffID int64 = 7

	assert.False(t, careplan.EnteredByTraeger(plain, 0), "an ordinary request carries no mark")
	assert.True(t, careplan.EnteredByTraeger(traeger, 0))
	assert.False(t, careplan.EnteredByTraeger(traeger, staffID), "a staff member is named in the row")

	assert.False(t, careplan.HasScheduleAuthor(plain, 0), "nobody is no author")
	assert.True(t, careplan.HasScheduleAuthor(plain, staffID))
	assert.True(t, careplan.HasScheduleAuthor(traeger, 0))
}

// A row without a staff author is valid only with the mark of the
// Träger-Büro; the database checks of migration 20261122063000 say the same.
func TestScheduleRowsNeedAStaffAuthorOrTheTraegerMark(t *testing.T) {
	t.Parallel()

	const studentID int64 = 11
	clock := time.Date(2000, 1, 1, 14, 0, 0, 0, time.UTC)
	day := careplan.Date("2026-09-09")
	rows := map[string]func(enteredByTraeger bool) error{
		"arrival schedule": func(mark bool) error {
			return (&careplan.ArrivalSchedule{StudentID: studentID, Weekday: 1, EnteredByTraeger: mark}).Validate()
		},
		"arrival exception": func(mark bool) error {
			return (&careplan.ArrivalException{StudentID: studentID, ExceptionDate: day, EnteredByTraeger: mark}).Validate()
		},
		"arrival note": func(mark bool) error {
			return (&careplan.ArrivalNote{StudentID: studentID, NoteDate: day, Content: "kommt später", EnteredByTraeger: mark}).Validate()
		},
		"pickup schedule": func(mark bool) error {
			return (&careplan.PickupSchedule{StudentID: studentID, Weekday: 1, PickupTime: clock, EnteredByTraeger: mark}).Validate()
		},
		"pickup exception": func(mark bool) error {
			return (&careplan.PickupException{StudentID: studentID, ExceptionDate: day, PickupTime: &clock, EnteredByTraeger: mark}).Validate()
		},
		"pickup note": func(mark bool) error {
			return (&careplan.PickupNote{StudentID: studentID, NoteDate: day, Content: "Oma holt ab", EnteredByTraeger: mark}).Validate()
		},
		"partial absence": func(mark bool) error {
			return (&careplan.PickupException{
				StudentID: studentID, ExceptionDate: day, PickupTime: &clock, ExcusedFrom: &clock,
				EnteredByTraeger: true, ExcusedByTraeger: mark,
			}).Validate()
		},
	}
	for name, validate := range rows {
		require.Error(t, validate(false), "%s without author and without mark", name)
		require.NoError(t, validate(true), "%s entered by the Träger-Büro", name)
	}
}
