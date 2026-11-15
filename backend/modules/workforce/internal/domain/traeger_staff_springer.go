package domain

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The employment the first block of a Springer creates (#7173, ADR 0249).

// PoolAccessMargin opens the access window of a block before its start and
// closes it after its end, so the Springer clocks in and out at its edges.
const PoolAccessMargin = 30 * time.Minute

// PoolSpringerIdentity is what the blocking school needs to employ a
// Springer: the account behind one of its employments (0 without one), the
// names of the record and its Einsatzort at the school, if any.
type PoolSpringerIdentity struct {
	AccountID      int64
	FirstName      string
	LastName       string
	MembershipID   int64
	MembershipLive bool
	ViaPool        bool
}

// RegularSite reports an Einsatzort the Personalverwaltung linked: the
// block adds nothing there.
func (i PoolSpringerIdentity) RegularSite() bool {
	return i.MembershipID > 0 && i.MembershipLive && !i.ViaPool
}

// PoolAccessWindow is the time a block admits its Springer at the school,
// in Berlin time with the margin on both sides. Start and End are the
// checked HH:MM clocks of the block.
func PoolAccessWindow(date calendar.Date, start, end string) (time.Time, time.Time, error) {
	from, err := time.Parse("15:04", start)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	until, err := time.Parse("15:04", end)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	midnight := date.BerlinMidnight()
	at := func(clock time.Time) time.Time {
		return time.Date(midnight.Year(), midnight.Month(), midnight.Day(), clock.Hour(), clock.Minute(), 0, 0, calendar.Berlin)
	}
	return at(from).Add(-PoolAccessMargin), at(until).Add(PoolAccessMargin), nil
}
