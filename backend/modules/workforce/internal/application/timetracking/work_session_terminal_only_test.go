package timetracking

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// wsTimeTrackingManagers answers the leadership question from a set of fake
// staff IDs and counts how often it was asked.
type wsTimeTrackingManagers struct {
	managers map[int64]bool
	err      error
	asked    *int
}

func (f wsTimeTrackingManagers) FindTimeTrackingManagerStaffIDs(_ context.Context, staffIDs []int64) (map[int64]bool, error) {
	if f.asked != nil {
		*f.asked++
	}
	found := map[int64]bool{}
	for _, staffID := range staffIDs {
		if f.managers[staffID] {
			found[staffID] = true
		}
	}
	return found, f.err
}

const (
	wsCaregiverID = int64(100)
	wsLeadID      = int64(200)
)

// wsTerminalOnlyService is a school with terminal-only stamping on, one
// caregiver and one lead. No block exists; a created block gets ID 11.
func wsTerminalOnlyService(t *testing.T) (*workSessionService, *wsMockWorkSessionRepository, *int) {
	t.Helper()
	svc, sessionRepo, _, _, _ := wsCreateTestService()
	svc.settings = &wsMockSettingsResolver{terminalOnly: true}
	svc.timeTrackingManagers = wsTimeTrackingManagers{managers: map[int64]bool{wsLeadID: true}}
	sessionRepo.getCurrentByStaffIDFunc = func(context.Context, int64) (*WorkSession, error) { return nil, ErrNotFound }
	sessionRepo.listByStaffAndDateFunc = func(context.Context, int64, Date) ([]*WorkSession, error) { return nil, nil }
	created := 0
	sessionRepo.createFunc = func(_ context.Context, entity *WorkSession) error {
		entity.ID = 11
		created++
		return nil
	}
	return svc, sessionRepo, &created
}

func TestWSTerminalOnly_OffNeverAsksForRightsAndKeepsAppStamps(t *testing.T) {
	t.Parallel()
	svc, _, created := wsTerminalOnlyService(t)
	asked := 0
	svc.settings = &wsMockSettingsResolver{}
	svc.timeTrackingManagers = wsTimeTrackingManagers{asked: &asked}

	session, err := svc.CheckIn(context.Background(), wsCaregiverID, WorkSessionStatusPresent, WorkSessionSourceApp, "")
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, 1, *created)
	assert.Zero(t, asked, "with the setting off nobody's rights are read")
}

func TestWSTerminalOnly_CaregiverCannotStampInApp(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	stamps := map[string]func(*workSessionService) error{
		"check-in": func(s *workSessionService) error {
			_, err := s.CheckIn(ctx, wsCaregiverID, WorkSessionStatusPresent, WorkSessionSourceApp, "")
			return err
		},
		"check-out":   func(s *workSessionService) error { _, err := s.CheckOut(ctx, wsCaregiverID, ""); return err },
		"break start": func(s *workSessionService) error { _, err := s.StartBreak(ctx, wsCaregiverID, nil); return err },
		"break end":   func(s *workSessionService) error { _, err := s.EndBreak(ctx, wsCaregiverID); return err },
	}
	for name, stamp := range stamps {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			svc, sessionRepo, created := wsTerminalOnlyService(t)
			sessionRepo.updateFunc = func(context.Context, *WorkSession) error {
				t.Fatal("a refused stamp must not write")
				return nil
			}
			require.ErrorIs(t, stamp(svc), workforce.ErrTerminalOnlyStamping)
			assert.Zero(t, *created)
		})
	}
}

func TestWSTerminalOnly_CaregiverStampsAtTheTerminal(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, _, created := wsTerminalOnlyService(t)

	session, err := svc.CheckInOn(ctx, wsCaregiverID, TodayDate(), WorkSessionStatusPresent, WorkSessionSourceNFC, "")
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, WorkSessionSourceNFC, session.Source)
	assert.Equal(t, 1, *created)

	// The kiosk's day-pinned stamps pass the rule and reach the block lookup.
	_, err = svc.CheckOutOn(ctx, wsCaregiverID, TodayDate(), "")
	require.ErrorIs(t, err, workforce.ErrNoActiveSession)
	_, err = svc.StartBreakOn(ctx, wsCaregiverID, TodayDate(), nil)
	require.ErrorIs(t, err, workforce.ErrNoActiveSession)
	_, err = svc.EndBreakOn(ctx, wsCaregiverID, TodayDate())
	require.ErrorIs(t, err, workforce.ErrNoActiveSession)
}

// One managing role suffices: the lookup answers for the account's combined
// permissions, so a lead who is also a caregiver keeps the app.
func TestWSTerminalOnly_LeadKeepsAppStamps(t *testing.T) {
	t.Parallel()
	svc, _, created := wsTerminalOnlyService(t)

	session, err := svc.CheckIn(context.Background(), wsLeadID, WorkSessionStatusPresent, WorkSessionSourceApp, "")
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, 1, *created)

	restricted, err := svc.TerminalOnlyStamping(context.Background(), wsLeadID)
	require.NoError(t, err)
	assert.False(t, restricted)
	restricted, err = svc.TerminalOnlyStamping(context.Background(), wsCaregiverID)
	require.NoError(t, err)
	assert.True(t, restricted)
}

// A rule that cannot be read refuses the write; it never lifts the lock.
func TestWSTerminalOnly_UnreadableRuleRefusesInsteadOfAllowing(t *testing.T) {
	t.Parallel()
	settingErr := errors.New("settings unavailable")
	rightsErr := errors.New("rights unavailable")
	cases := map[string]struct {
		arrange func(*workSessionService)
		want    error
	}{
		"setting": {func(s *workSessionService) { s.settings = &wsMockSettingsResolver{terminalOnlyErr: settingErr} }, settingErr},
		"rights": {func(s *workSessionService) {
			s.timeTrackingManagers = wsTimeTrackingManagers{err: rightsErr}
		}, rightsErr},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			svc, _, created := wsTerminalOnlyService(t)
			tc.arrange(svc)

			_, err := svc.CheckIn(ctx, wsCaregiverID, WorkSessionStatusPresent, WorkSessionSourceApp, "")
			require.ErrorIs(t, err, tc.want)
			_, err = svc.CheckOut(ctx, wsCaregiverID, "")
			require.ErrorIs(t, err, tc.want)
			session, err := svc.EnsureCheckedIn(ctx, wsCaregiverID, WorkSessionSourceNFC)
			require.ErrorIs(t, err, tc.want)
			assert.Nil(t, session)
			assert.Zero(t, *created)
		})
	}

	t.Run("missing rights lookup", func(t *testing.T) {
		t.Parallel()
		svc, _, created := wsTerminalOnlyService(t)
		svc.timeTrackingManagers = nil
		_, err := svc.CheckIn(context.Background(), wsCaregiverID, WorkSessionStatusPresent, WorkSessionSourceApp, "")
		require.Error(t, err)
		assert.Zero(t, *created)
	})
}

// A supervision or attendance action is no chip scan: it opens no block for
// a caregiver, from the app and from a kiosk alike, and does not fail.
func TestWSTerminalOnly_AutomaticCheckInOpensNoBlockForCaregiver(t *testing.T) {
	t.Parallel()
	for _, source := range []string{WorkSessionSourceApp, WorkSessionSourceNFC} {
		t.Run(source, func(t *testing.T) {
			t.Parallel()
			svc, _, created := wsTerminalOnlyService(t)

			session, err := svc.EnsureCheckedIn(context.Background(), wsCaregiverID, source)
			require.NoError(t, err)
			assert.Nil(t, session)
			assert.Zero(t, *created)

			session, err = svc.EnsureCheckedIn(context.Background(), wsLeadID, source)
			require.NoError(t, err)
			require.NotNil(t, session)
			assert.Equal(t, 1, *created)
		})
	}
}

// Switching the setting on while a block runs leaves that block alone.
func TestWSTerminalOnly_RunningBlockStaysUntouched(t *testing.T) {
	t.Parallel()
	svc, sessionRepo, created := wsTerminalOnlyService(t)
	running := &WorkSession{
		Model: Model{ID: 12}, StaffID: wsCaregiverID, Status: WorkSessionStatusPresent, Source: WorkSessionSourceApp,
		Date: TodayDate(), CheckInTime: testNow().Add(-time.Hour), CreatedBy: wsCaregiverID,
	}
	sessionRepo.getCurrentByStaffIDFunc = func(context.Context, int64) (*WorkSession, error) { return running, nil }

	session, err := svc.EnsureCheckedIn(context.Background(), wsCaregiverID, WorkSessionSourceApp)
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, running.ID, session.ID)
	assert.Zero(t, *created)
}

func TestWSTerminalOnly_SelfEditCannotMoveRecordedTimes(t *testing.T) {
	t.Parallel()
	ctx := tenant.WithTenantID(context.Background(), 43)
	checkIn := testNow().Add(-8 * time.Hour)
	checkOut := testNow().Add(-time.Hour)
	stored := func() *WorkSession {
		return &WorkSession{
			Model: Model{ID: 5}, StaffID: wsCaregiverID, Status: WorkSessionStatusPresent, Source: WorkSessionSourceNFC,
			Date: TodayDate(), CheckInTime: checkIn, CheckOutTime: &checkOut, CreatedBy: wsCaregiverID,
		}
	}
	earlier, later, minutes, otherDay, note := checkIn.Add(-time.Hour), checkOut.Add(30*time.Minute), 15, checkIn.AddDate(0, 0, -1), "Notiz"
	moves := map[string]SessionUpdateRequest{
		"check-in":      {CheckInTime: &earlier, Notes: &note},
		"check-out":     {CheckOutTime: &later, Notes: &note},
		"break minutes": {BreakMinutes: &minutes, Notes: &note},
		"single break":  {Breaks: []BreakDurationUpdate{{ID: 1, DurationMinutes: 5}}, Notes: &note},
		"day":           {Date: &otherDay, Notes: &note},
	}
	for name, updates := range moves {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			svc, sessionRepo, _ := wsTerminalOnlyService(t)
			sessionRepo.findByIDFunc = func(context.Context, any) (*WorkSession, error) { return stored(), nil }
			sessionRepo.updateFunc = func(context.Context, *WorkSession) error {
				t.Fatal("a refused self-edit must not write")
				return nil
			}
			_, err := svc.UpdateSession(ctx, wsCaregiverID, 5, updates)
			require.ErrorIs(t, err, workforce.ErrTerminalOnlyTimeEdit)
		})
	}

	t.Run("notes stay editable", func(t *testing.T) {
		t.Parallel()
		svc, sessionRepo, _ := wsTerminalOnlyService(t)
		sessionRepo.findByIDFunc = func(context.Context, any) (*WorkSession, error) { return stored(), nil }
		written := false
		sessionRepo.updateFunc = func(context.Context, *WorkSession) error { written = true; return nil }
		_, err := svc.UpdateSession(ctx, wsCaregiverID, 5, SessionUpdateRequest{Notes: &note})
		require.NoError(t, err)
		assert.True(t, written)
	})

	t.Run("the leadership corrects a caregiver's times", func(t *testing.T) {
		t.Parallel()
		svc, sessionRepo, _ := wsTerminalOnlyService(t)
		auditRepo := svc.auditRepo.(*wsMockWorkSessionEditRepository)
		sessionRepo.findByIDFunc = func(context.Context, any) (*WorkSession, error) { return stored(), nil }
		written := false
		sessionRepo.updateFunc = func(context.Context, *WorkSession) error { written = true; return nil }
		var audited []*WorkSessionEdit
		auditRepo.createBatchFunc = func(_ context.Context, edits []*WorkSessionEdit) error { audited = edits; return nil }

		_, err := svc.UpdateSessionAsAdmin(ctx, wsLeadID, wsCaregiverID, 5, SessionUpdateRequest{CheckOutTime: &later, Notes: &note})
		require.NoError(t, err)
		assert.True(t, written)
		require.NotEmpty(t, audited)
		assert.Equal(t, wsLeadID, audited[0].EditedBy)
	})
}
