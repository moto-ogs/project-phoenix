package daychangesview

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The day of the overview (#7657): today, or tomorrow as a preview to
// prepare the next day. Tomorrow is the next calendar day of the school, also
// on a weekend or a closing day; the closing day then stands as its entry.

// ErrDayOutOfRange reports a day other than today or tomorrow of the school.
var ErrDayOutOfRange = errors.New("day changes view: the overview reads only today and tomorrow")

// Today reads the overview of the school's today.
func (v *view) Today(ctx context.Context) (Overview, error) {
	return v.overview(ctx, v.today())
}

// On reads the overview of day. Every source reads with the same rule as
// for today; only the day differs.
func (v *view) On(ctx context.Context, day calendar.Date) (Overview, error) {
	today := v.today()
	if day != today && day != today.AddDays(1) {
		return Overview{}, ErrDayOutOfRange
	}
	return v.overview(ctx, day)
}
