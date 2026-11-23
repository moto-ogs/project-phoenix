package compose

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
)

// scheduleReader reads a child's regular days as a client does before it
// changes them.
type scheduleReader interface {
	Participation(context.Context, int64, mealplan.Date, mealplan.Date) (mealplan.ParticipationPlan, error)
}

// ReadVersion is the version of the child's regular days a read gives now
// (ADR 0311), or none when the read is refused: the change then meets the
// same refusal.
func ReadVersion(t *testing.T, module scheduleReader, ctx context.Context, studentID int64) string {
	t.Helper()
	plan, err := module.Participation(ctx, studentID, "2026-09-07", "2026-09-07")
	if err != nil {
		return ""
	}
	return plan.Version
}

// AsRead is a parent's change of the regular days with the version read
// just before it.
func AsRead(t *testing.T, module scheduleReader, ctx context.Context, command mealplan.ReplaceParticipationSchedule) mealplan.ReplaceParticipationSchedule {
	t.Helper()
	command.ExpectedVersion = ReadVersion(t, module, ctx, command.StudentID)
	return command
}

// SchoolAsRead is the school's change of the regular days with the version
// read just before it.
func SchoolAsRead(t *testing.T, module scheduleReader, ctx context.Context, command mealplan.SchoolSchedule) mealplan.SchoolSchedule {
	t.Helper()
	command.ExpectedVersion = ReadVersion(t, module, ctx, command.StudentID)
	return command
}

// dayEditor reads the days of a week and saves one of them.
type dayEditor interface {
	Days(context.Context, mealplan.Date) ([]mealplan.Day, error)
	ReplaceDay(context.Context, mealplan.ReplaceDay) (mealplan.Day, error)
}

// SaveDay saves a day with the version a read of its week gives just
// before, as the meal plan page does.
func SaveDay(t *testing.T, module dayEditor, ctx context.Context, command mealplan.ReplaceDay) error {
	t.Helper()
	command.ExpectedVersion = DayVersionNow(t, module, ctx, command.Date)
	_, err := module.ReplaceDay(ctx, command)
	return err
}

// DayVersionNow is the version a read of the day gives now.
func DayVersionNow(t *testing.T, module dayEditor, ctx context.Context, date mealplan.Date) string {
	t.Helper()
	days, err := module.Days(ctx, date)
	if err != nil {
		return ""
	}
	for _, day := range days {
		if day.Date == date {
			return day.Version
		}
	}
	return ""
}
