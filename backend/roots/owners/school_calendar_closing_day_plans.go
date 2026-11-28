package owners

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewSchoolCalendarClosingDayPlans binds School Calendar's closing-day plans
// (#8205) to Workforce's series-shift follow-up, which joins the closing
// day's tenant transaction. Workforce takes its own staff-shift gates; the
// closing day write holds no ordered lock before them (ADR 0067, command
// participation).
func NewSchoolCalendarClosingDayPlans(breakDays workforce.SeriesBreakDays) schoolcalendar.ClosingDayPlans {
	if breakDays == nil {
		panic("school calendar closing day plans: Workforce's series break days are required")
	}
	return schoolCalendarClosingDayPlans{breakDays: breakDays}
}

type schoolCalendarClosingDayPlans struct {
	breakDays workforce.SeriesBreakDays
}

func (p schoolCalendarClosingDayPlans) FollowClosingDays(ctx context.Context, from, to calendar.Date) error {
	return p.breakDays.FollowBreakDays(ctx, from, to)
}
