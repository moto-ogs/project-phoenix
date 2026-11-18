package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The phase writes apply the service period bounds (#5658) when a phase is
// created and when its period moves. A stored phase beyond them stays
// readable and saves while its period stays as it is.

var boundsToday = calendar.NewDate(2026, 11, 18)

// boundsPhaseRecords serves one stored phase and records the writes; every
// other call would panic on the nil embedded interface.
type boundsPhaseRecords struct {
	PhaseRecords
	stored   *enrollment.Phase
	inserted int
	updated  int
}

func (r *boundsPhaseRecords) Phase(context.Context, int64) (*enrollment.Phase, error) {
	phase := *r.stored
	return &phase, nil
}

func (r *boundsPhaseRecords) InsertPhase(_ context.Context, phase *enrollment.Phase) error {
	r.inserted++
	phase.ID = 1
	return nil
}

func (r *boundsPhaseRecords) UpdatePhase(context.Context, *enrollment.Phase) error {
	r.updated++
	return nil
}

func boundsPhases(records *boundsPhaseRecords) *Phases {
	return newPhases(PhaseDependencies{
		Now:     enrollmentTestClock,
		Today:   func() calendar.Date { return boundsToday },
		Records: records,
	})
}

func boundsPhase(start, end enrollment.Date) *enrollment.Phase {
	return &enrollment.Phase{Name: "Schuljahr", Kind: enrollment.PhaseKindSchoolYear, ServiceStartDate: start, ServiceEndDate: end}
}

func requireBoundsRejection(t *testing.T, err error, sentinel error, code string) {
	t.Helper()
	require.ErrorIs(t, err, sentinel)
	var rejection *enrollment.InvalidInputError
	require.True(t, errors.As(err, &rejection), "want an InvalidInputError, got %v", err)
	assert.Equal(t, code, rejection.ErrorCode())
	assert.Equal(t, "service_end_date", rejection.ErrorField())
}

func TestCreatePhase_AppliesTheServicePeriodBounds(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		start, end enrollment.Date
		code       string
	}{
		{"exactly two years", "2026-08-01", "2028-08-01", ""},
		{"longer than two years", "2026-08-01", "2028-08-02", enrollment.CodePhaseServicePeriodTooLong},
		{"end exactly five years ahead", "2030-08-01", "2031-11-18", ""},
		{"end more than five years ahead", "2030-08-01", "2031-11-19", enrollment.CodePhaseServiceEndTooFar},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			records := &boundsPhaseRecords{}
			_, err := boundsPhases(records).CreatePhase(context.Background(), boundsPhase(tc.start, tc.end))
			if tc.code == "" {
				require.NoError(t, err)
				assert.Equal(t, 1, records.inserted)
				return
			}
			requireBoundsRejection(t, err, enrollment.ErrInvalidPhase, tc.code)
			assert.Zero(t, records.inserted, "a rejected phase is not stored")
		})
	}
}

func TestUpdatePhase_KeepsAStoredPeriodBeyondTheBounds(t *testing.T) {
	t.Parallel()

	stored := boundsPhase("2026-08-01", "5000-07-31")
	stored.ID = 7

	// Only the name changes: the stored period stays, the edit saves.
	records := &boundsPhaseRecords{stored: stored}
	renamed := *stored
	renamed.Name = "Schuljahr neu"
	_, err := boundsPhases(records).UpdatePhase(context.Background(), &renamed)
	require.NoError(t, err)
	assert.Equal(t, 1, records.updated)

	// A moved period meets the bounds, even when it only gets shorter.
	for _, tc := range []struct {
		name       string
		start, end enrollment.Date
		code       string
	}{
		{"end moved", "2026-08-01", "4000-07-31", enrollment.CodePhaseServicePeriodTooLong},
		{"start moved", "2026-09-01", "5000-07-31", enrollment.CodePhaseServicePeriodTooLong},
		{"end too far ahead", "2030-08-01", "2031-11-19", enrollment.CodePhaseServiceEndTooFar},
	} {
		records := &boundsPhaseRecords{stored: stored}
		moved := *stored
		moved.ServiceStartDate, moved.ServiceEndDate = tc.start, tc.end
		_, err := boundsPhases(records).UpdatePhase(context.Background(), &moved)
		requireBoundsRejection(t, err, enrollment.ErrInvalidPhase, tc.code)
		assert.Zero(t, records.updated, tc.name)
	}
}

func TestValidateRolloverServicePeriodBounds(t *testing.T) {
	t.Parallel()

	req := validRolloverReq()
	req.ServiceStartDate, req.ServiceEndDate = calendar.NewDate(2027, 8, 1), calendar.NewDate(2029, 8, 1)
	require.NoError(t, validateRolloverServicePeriodBounds(req, boundsToday), "exactly two years")

	req.ServiceEndDate = calendar.NewDate(2029, 8, 2)
	requireBoundsRejection(t, validateRolloverServicePeriodBounds(req, boundsToday), enrollment.ErrRolloverInvalidRequest, enrollment.CodePhaseServicePeriodTooLong)

	req.ServiceStartDate, req.ServiceEndDate = calendar.NewDate(2030, 8, 1), calendar.NewDate(2031, 11, 18)
	require.NoError(t, validateRolloverServicePeriodBounds(req, boundsToday), "end exactly five years ahead")

	req.ServiceEndDate = calendar.NewDate(2031, 11, 19)
	requireBoundsRejection(t, validateRolloverServicePeriodBounds(req, boundsToday), enrollment.ErrRolloverInvalidRequest, enrollment.CodePhaseServiceEndTooFar)
}

// The rollover checks the bounds before it opens its transaction, on the
// school's day of its clock.
func TestCreatePhaseFromSource_RejectsAPeriodBeyondTheBounds(t *testing.T) {
	t.Parallel()

	rollovers := NewRollovers(RolloverDependencies{Now: func() time.Time { return boundsToday.BerlinMidnight().Add(10 * time.Hour) }})
	req := validRolloverReq()
	req.ServiceStartDate, req.ServiceEndDate = calendar.NewDate(2027, 8, 1), calendar.NewDate(2030, 7, 31)
	_, err := rollovers.CreatePhaseFromSource(context.Background(), req)
	requireBoundsRejection(t, err, enrollment.ErrRolloverInvalidRequest, enrollment.CodePhaseServicePeriodTooLong)
}

// boundsTraegerStore holds one draft and records the writes.
type boundsTraegerStore struct {
	TraegerPhaseStore
	current  enrollment.TraegerPhase
	inserted int
	updated  int
}

func (s *boundsTraegerStore) LockTraegerPhase(context.Context, int64, int64) (enrollment.TraegerPhase, error) {
	return s.current, nil
}

func (s *boundsTraegerStore) TraegerPhase(context.Context, int64, int64) (enrollment.TraegerPhase, error) {
	return s.current, nil
}

func (s *boundsTraegerStore) InsertTraegerPhase(context.Context, int64, enrollment.TraegerPhaseFields, bool) (int64, error) {
	s.inserted++
	return 1, nil
}

func (s *boundsTraegerStore) UpdateTraegerPhaseDraft(context.Context, int64, int64, enrollment.TraegerPhaseFields, bool) (bool, error) {
	s.updated++
	return true, nil
}

func (s *boundsTraegerStore) ReplaceTraegerPhaseSchools(context.Context, int64, int64, []int64) error {
	return nil
}

func traegerBoundsInput(start, end enrollment.Date) enrollment.TraegerPhaseInput {
	return enrollment.TraegerPhaseInput{
		Fields:     enrollment.TraegerPhaseFields{Name: "Schuljahr", ServiceStartDate: start, ServiceEndDate: end},
		AllSchools: true,
	}
}

func TestTraegerPhases_ApplyTheServicePeriodBounds(t *testing.T) {
	t.Parallel()

	today := func() calendar.Date { return boundsToday }
	store := &boundsTraegerStore{}
	phases := NewTraegerPhases(store, today)

	_, err := phases.CreateTraegerPhase(context.Background(), 3, traegerBoundsInput("2026-08-01", "2028-08-01"))
	require.NoError(t, err, "exactly two years")
	_, err = phases.CreateTraegerPhase(context.Background(), 3, traegerBoundsInput("2026-08-01", "2028-08-02"))
	requireBoundsRejection(t, err, enrollment.ErrInvalidPhase, enrollment.CodePhaseServicePeriodTooLong)
	_, err = phases.CreateTraegerPhase(context.Background(), 3, traegerBoundsInput("2030-08-01", "2031-11-19"))
	requireBoundsRejection(t, err, enrollment.ErrInvalidPhase, enrollment.CodePhaseServiceEndTooFar)
	assert.Equal(t, 1, store.inserted)

	// A stored draft beyond the bounds saves while its period stays.
	legacy := traegerBoundsInput("2026-08-01", "5000-07-31")
	store.current = enrollment.TraegerPhase{ID: 9, Draft: legacy.Fields}
	renamed := legacy
	renamed.Fields.Name = "Schuljahr neu"
	_, err = phases.UpdateTraegerPhase(context.Background(), 3, 9, renamed)
	require.NoError(t, err)

	moved := legacy
	moved.Fields.ServiceEndDate = "4000-07-31"
	_, err = phases.UpdateTraegerPhase(context.Background(), 3, 9, moved)
	requireBoundsRejection(t, err, enrollment.ErrInvalidPhase, enrollment.CodePhaseServicePeriodTooLong)
	assert.Equal(t, 1, store.updated)
}
