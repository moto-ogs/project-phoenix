package timetracking

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// compTimeOverdraftFixture is a Leitung booking a Freizeitausgleich below
// zero while the staff member is checked in: the month fixture's real
// balance math (Monday-only 480-minute schedule, account start 2026-06-01),
// today 2026-07-15 with a session open since 08:00, and one clock that the
// test moves for both services.
type compTimeOverdraftFixture struct {
	svc     *staffAbsenceService
	months  *wtmFixture
	now     time.Time
	created int
}

func newCompTimeOverdraftFixture() *compTimeOverdraftFixture {
	f := &compTimeOverdraftFixture{now: wtmNow()}
	clock := func() time.Time { return f.now }
	today := func() Date { return DateFromTime(f.now) }

	f.months = newWTMFixture()
	f.months.svc.nowFunc, f.months.svc.todayFunc = clock, today
	f.months.sessions.nowFunc = clock
	open := &WorkSession{
		Model:       Model{ID: 501},
		StaffID:     wtmStaffID,
		Date:        today(),
		Status:      WorkSessionStatusPresent,
		CheckInTime: time.Date(2026, time.July, 15, 8, 0, 0, 0, Berlin),
	}
	f.months.sessions.sessions = []*WorkSession{open}

	svc, absRepo, _ := absSetupServiceWithSyncer()
	svc.nowFunc, svc.todayFunc = clock, today
	svc.settings = f.months.settings
	svc.monthService = f.months.svc
	absRepo.createFunc = func(_ context.Context, absence *StaffAbsence) error {
		f.created++
		absence.ID = 600
		return nil
	}
	f.svc = svc
	return f
}

// compTimeOverdraftDay is the booked Freizeitausgleich: a Monday after today
// with a full target day.
var compTimeOverdraftDay = NewDate(2026, time.July, 20)

func (f *compTimeOverdraftFixture) preview(t *testing.T) *CompTimeBalancePreview {
	t.Helper()
	preview, err := f.svc.PreviewCompTimeBalance(context.Background(), wtmStaffID, compTimeOverdraftDay, compTimeOverdraftDay, false)
	require.NoError(t, err)
	require.Negative(t, preview.ProjectedBalanceMinutes, "the booking must need a confirmation")
	return preview
}

func (f *compTimeOverdraftFixture) book(fingerprint string) error {
	_, err := f.svc.CreateAbsenceFor(context.Background(), wtmStaffID, 200, nil, CreateAbsenceRequest{
		AbsenceType:          AbsenceTypeCompTime,
		DateStart:            compTimeOverdraftDay.String(),
		DateEnd:              compTimeOverdraftDay.String(),
		OverdraftFingerprint: &fingerprint,
	})
	return err
}

// The running check-in moves the live balance every minute; the confirmed
// projection still books, because no stored row changed (ADR 0311).
func TestAbsCompTimeOverdraft_OpenSessionAndMovedClockStillBook(t *testing.T) {
	t.Parallel()

	f := newCompTimeOverdraftFixture()
	confirmed := f.preview(t)

	f.now = f.now.Add(30 * time.Minute)
	later := f.preview(t)
	require.Equal(t, confirmed.CurrentBalanceMinutes+30, later.CurrentBalanceMinutes,
		"the shown balance stays live")
	assert.Equal(t, confirmed.Fingerprint, later.Fingerprint)

	require.NoError(t, f.book(confirmed.Fingerprint))
	assert.Equal(t, 1, f.created)
}

// A stored booking that changed since the preview refuses the confirmation
// and writes nothing.
func TestAbsCompTimeOverdraft_ChangedStoredSessionRefuses(t *testing.T) {
	t.Parallel()

	f := newCompTimeOverdraftFixture()
	confirmed := f.preview(t)

	// Someone corrects the open session's check-in to an hour earlier.
	f.months.sessions.sessions[0].CheckInTime = f.months.sessions.sessions[0].CheckInTime.Add(-time.Hour)
	f.now = f.now.Add(time.Minute)

	require.ErrorIs(t, f.book(confirmed.Fingerprint), readstate.ErrChanged)
	assert.Zero(t, f.created)
}
