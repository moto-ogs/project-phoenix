package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/appointments"
)

func normalizeWallClock(value time.Time) time.Time {
	return time.Date(1, time.January, 1, value.Hour(), value.Minute(), value.Second(), value.Nanosecond(), time.UTC)
}

// today is the Berlin calendar day of the calendar's clock (ADR 0239).
func (s *service) today() appointments.Date { return s.cfg.Today() }

// now is the calendar's clock (ADR 0239).
func (s *service) now() time.Time { return s.cfg.Now() }
