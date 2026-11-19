package application

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/schoolsetup"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeStaffStore keeps the first steps of each person in memory. The tenant
// is implicit, as it is in the repository, where RLS supplies it.
type fakeStaffStore struct {
	states map[int64]*schoolsetup.StaffState
	writes int
	locks  int
}

func newFakeStaffStore() *fakeStaffStore {
	return &fakeStaffStore{states: map[int64]*schoolsetup.StaffState{}}
}

func (f *fakeStaffStore) LockStaffOnboarding(_ context.Context, _ int64) error {
	f.locks++
	return nil
}

func (f *fakeStaffStore) StaffOnboardingOf(_ context.Context, accountID int64) (*schoolsetup.StaffState, error) {
	state, ok := f.states[accountID]
	if !ok {
		return nil, nil
	}
	copied := *state
	copied.DoneSteps = append([]string{}, state.DoneSteps...)
	copied.SkippedSteps = append([]string{}, state.SkippedSteps...)
	return &copied, nil
}

func (f *fakeStaffStore) StoreStaffOnboarding(_ context.Context, state *schoolsetup.StaffState) error {
	f.writes++
	copied := *state
	f.states[state.AccountID] = &copied
	return nil
}

type staffFixture struct {
	service  *StaffOnboarding
	store    *fakeStaffStore
	progress *fakeSetupProgress
	now      time.Time
}

func newStaffFixture(t *testing.T) *staffFixture {
	t.Helper()
	fixture := &staffFixture{
		store:    newFakeStaffStore(),
		progress: &fakeSetupProgress{},
		now:      time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC),
	}
	service, err := NewStaffOnboarding(fixture.store, fixture.progress, func() time.Time { return fixture.now })
	require.NoError(t, err)
	fixture.service = service
	return fixture
}

func requireStaffStepState(t *testing.T, fixture *staffFixture, step, state string) {
	t.Helper()
	_, err := fixture.service.SetStaffStepState(t.Context(), setupTenant, setupColleague, step, state)
	require.NoError(t, err)
}

func requireStaffDismissed(t *testing.T, fixture *staffFixture, dismissed bool) {
	t.Helper()
	_, err := fixture.service.SetStaffDismissed(t.Context(), setupTenant, setupColleague, dismissed)
	require.NoError(t, err)
}

func TestNewStaffOnboardingRequiresEveryDependency(t *testing.T) {
	t.Parallel()

	_, err := NewStaffOnboarding(nil, &fakeSetupProgress{}, time.Now)
	require.Error(t, err)
	_, err = NewStaffOnboarding(newFakeStaffStore(), nil, time.Now)
	require.Error(t, err)
	_, err = NewStaffOnboarding(newFakeStaffStore(), &fakeSetupProgress{}, nil)
	require.Error(t, err)
}

func TestStaffStatusOfANewPersonWaitsForTheSchool(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)

	status, err := f.service.StaffStatus(t.Context(), setupTenant, setupColleague)
	require.NoError(t, err)

	assert.Equal(t, schoolsetup.StaffStatus{
		DoneSteps:    []string{},
		SkippedSteps: []string{},
	}, status, "a school without groups or children is not ready for the tours")
	assert.Zero(t, f.store.writes, "reading never creates a state")
}

func TestStaffStatusIsReadyWithAGroupOrAChild(t *testing.T) {
	t.Parallel()

	for name, facts := range map[string]schoolsetup.Facts{
		"group": {GroupCreated: true},
		"child": {StudentEnrolled: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newStaffFixture(t)
			f.progress.facts = facts

			status, err := f.service.StaffStatus(t.Context(), setupTenant, setupColleague)
			require.NoError(t, err)
			assert.True(t, status.SchoolReady)
		})
	}
}

func TestStaffStatusIgnoresFactsOtherThanGroupsAndChildren(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	f.progress.facts = schoolsetup.Facts{StaffInvited: true, RoomCreated: true, GuardianInvited: true}

	status, err := f.service.StaffStatus(t.Context(), setupTenant, setupColleague)
	require.NoError(t, err)
	assert.False(t, status.SchoolReady, "rooms and invitations alone give the tours nothing to show")
}

func TestSetStaffStepStateMovesAStepBetweenStates(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	ctx := t.Context()

	requireStaffStepState(t, f, "students", schoolsetup.StaffStepStateDone)
	requireStaffStepState(t, f, "work_time", schoolsetup.StaffStepStateSkipped)

	status, err := f.service.StaffStatus(ctx, setupTenant, setupColleague)
	require.NoError(t, err)
	assert.Equal(t, []string{"students"}, status.DoneSteps)
	assert.Equal(t, []string{"work_time"}, status.SkippedSteps)

	// A skipped step the person later finishes is done, not both.
	requireStaffStepState(t, f, "work_time", schoolsetup.StaffStepStateDone)
	// Open takes a step back entirely.
	requireStaffStepState(t, f, "students", schoolsetup.StaffStepStateOpen)

	status, err = f.service.StaffStatus(ctx, setupTenant, setupColleague)
	require.NoError(t, err)
	assert.Equal(t, []string{"work_time"}, status.DoneSteps)
	assert.Empty(t, status.SkippedSteps)

	stored := f.store.states[setupColleague]
	require.NotNil(t, stored)
	assert.Equal(t, int64(setupTenant), stored.TenantID, "the first write creates the state for the school")
	assert.Equal(t, 4, f.store.locks, "every state change locks before reading and replacing the shared state")
}

func TestStaffOnboardingReportsOnlyActualStateChanges(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	ctx := t.Context()

	changed, err := f.service.SetStaffStepState(ctx, setupTenant, setupColleague, "students", schoolsetup.StaffStepStateDone)
	require.NoError(t, err)
	assert.True(t, changed)

	changed, err = f.service.SetStaffStepState(ctx, setupTenant, setupColleague, "students", schoolsetup.StaffStepStateDone)
	require.NoError(t, err)
	assert.False(t, changed, "repeating a step state changes no checklist state")

	changed, err = f.service.SetStaffDismissed(ctx, setupTenant, setupColleague, true)
	require.NoError(t, err)
	assert.True(t, changed)

	changed, err = f.service.SetStaffDismissed(ctx, setupTenant, setupColleague, true)
	require.NoError(t, err)
	assert.False(t, changed, "hiding an already hidden checklist changes no checklist state")
}

func TestStaffProgressIsPersonal(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	ctx := t.Context()

	requireStaffStepState(t, f, "calendar", schoolsetup.StaffStepStateDone)
	requireStaffDismissed(t, f, true)

	other, err := f.service.StaffStatus(ctx, setupTenant, setupAdmin)
	require.NoError(t, err)
	assert.False(t, other.Dismissed)
	assert.Empty(t, other.DoneSteps, "another person's tours never count")
}

func TestSetStaffStepStateRejectsUnknownStepsAndStates(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	ctx := t.Context()

	_, err := f.service.SetStaffStepState(ctx, setupTenant, setupColleague, "team", schoolsetup.StaffStepStateDone)
	require.ErrorIs(t, err, schoolsetup.ErrUnknownStep, "the school wizard's steps are not the staff steps")

	_, err = f.service.SetStaffStepState(ctx, setupTenant, setupColleague, "students", "finished")
	require.ErrorIs(t, err, schoolsetup.ErrUnknownStepState)

	assert.Zero(t, f.store.writes)
}

func TestStaffDismissalHidesTheChecklistWithoutAProgressRead(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	f.progress.facts = schoolsetup.Facts{GroupCreated: true}
	ctx := t.Context()

	requireStaffDismissed(t, f, true)
	status, err := f.service.StaffStatus(ctx, setupTenant, setupColleague)
	require.NoError(t, err)

	assert.True(t, status.Dismissed)
	assert.Zero(t, f.progress.reads, "a hidden checklist needs no progress read")
	require.NotNil(t, f.store.states[setupColleague].DismissedAt)
	assert.Equal(t, f.now, *f.store.states[setupColleague].DismissedAt)
}

func TestStaffDismissalKeepsTheFirstTimeAndCanBeUndone(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	ctx := t.Context()
	first := f.now

	requireStaffDismissed(t, f, true)
	f.now = first.Add(time.Hour)
	requireStaffDismissed(t, f, true)
	assert.Equal(t, first, *f.store.states[setupColleague].DismissedAt, "hiding twice keeps the first time")

	requireStaffDismissed(t, f, false)
	status, err := f.service.StaffStatus(ctx, setupTenant, setupColleague)
	require.NoError(t, err)
	assert.False(t, status.Dismissed)
}

func TestStaffStatusDropsRetiredStepKeys(t *testing.T) {
	t.Parallel()
	f := newStaffFixture(t)
	f.store.states[setupColleague] = &schoolsetup.StaffState{
		TenantID:     setupTenant,
		AccountID:    setupColleague,
		DoneSteps:    []string{"students", "retired_step"},
		SkippedSteps: []string{"retired_step"},
	}

	status, err := f.service.StaffStatus(t.Context(), setupTenant, setupColleague)
	require.NoError(t, err)
	assert.Equal(t, []string{"students"}, status.DoneSteps)
	assert.Empty(t, status.SkippedSteps)
}
