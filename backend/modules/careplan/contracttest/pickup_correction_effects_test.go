package contracttest_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Bind the real ledger and root bridge: corrections must consume the events
// that decisions and earlier corrections actually persisted.
func pickupCorrectionFixture(t *testing.T) (*careFixture, calendar.Date, int64) {
	t.Helper()
	f := newPickupChangeFixture(t)
	ctx := correctionContext(t, f)
	date := calendar.Date("2026-08-26")
	require.NoError(t, f.schedules.Pickups.UpsertStudentPickupSchedule(ctx, &careplan.PickupSchedule{
		StudentID: f.chain.StudentID, Weekday: int(date.Weekday()), PickupTime: *wallClockAt(16, 0), CreatedBy: f.staffID,
	}))
	room := testpkg.CreateTestRoom(t, f.db, "Correction block")
	block := testpkg.CreateTestActivityInstance(t, f.db, date, room.ID, testpkg.ActivityInstanceOpts{StartHHMM: "15:00", EndHHMM: "16:00"})
	slot := testpkg.CreateTestInstanceStudent(t, f.db, block.ID, f.chain.StudentID, studentpresence.SessionAttendanceExpected)
	slotID := slot.ID
	permissionChecks := owners.NewPickupPermissionApprovals(
		owners.NewParentGuardianProfileReads(f.reposPeople.GuardianProfile),
		owners.NewParentStudentGuardianReads(f.reposPeople.StudentGuardian),
		owners.NewParentGuardianPolicy(), nil)
	f.svc = owners.NewCareScheduleRequestServiceWithPickupChangesAndPolicy(nil,
		f.reposCare.CarePlan(), f.persons, f.schedules.Arrivals, f.schedules.Pickups,
		newPickupChangePresence(t, f.db), f.autoExcusal, f.reposCare.CarePlan(), f.caller,
		f.emitter(t, messagingOnSettings{}, nil), nil, testpkg.RequestReviewPolicy[*peopledirectory.StudentState]{UserContext: f.caller},
		testpkg.PermissionsFromContext, f.reposPeople.ParentRequestEvent, slog.Default(), f.services.StudentAudit,
		owners.WithCareRequestToday(func() calendar.Date { return "2026-08-24" }),
		owners.WithPickupPermissionApprovals(permissionChecks))
	return f, date, slotID
}

func correctionContext(t *testing.T, f *careFixture) context.Context {
	t.Helper()
	return testpkg.WithTenantRuntime(t, f.staffCtx(f.staffAccount), f.db)
}

func correctionRequest(t *testing.T, f *careFixture, date calendar.Date, approve bool) carerequests.Request {
	t.Helper()
	contact := testpkg.CreateTestGuardianProfile(t, f.db, "collector@example.test")
	link := &testpkg.StudentGuardian{TenantID: f.chain.TenantID, StudentID: f.chain.StudentID,
		GuardianProfileID: contact.ID, RelationshipType: "other"}
	testpkg.ApplyStudentGuardianRole(link, "contact")
	require.NoError(t, testpkg.InsertTestStudentGuardian(correctionContext(t, f), f.db, link))
	raw, err := json.Marshal(map[string]any{
		"date": date.String(), "pickup_time": "14:00", "departure_mode": "pickup", "reason": "Termin",
		"pickup_person": map[string]any{"guardian_profile_id": contact.ID, "name": "Sabine Schneider"},
	})
	require.NoError(t, err)
	owner := f.reposCare.CarePlan()
	row, err := owner.CreateCareScheduleRequest(correctionContext(t, f), carerequests.Request{
		StudentID: f.chain.StudentID, SubmittedBy: f.chain.AccountID, RequestKind: carerequests.KindPickupChange,
		Status: carerequests.StatusPending, Payload: raw,
	})
	require.NoError(t, err)
	result, err := f.svc.Decide(correctionContext(t, f), carerequests.DecideInput{ExpectedVersion: testpkg.CareRequestVersion(t, row.ID),
		RequestID: row.ID, Approve: approve, Reason: "Geprüft", ReviewedBy: f.staffAccount,
	})
	require.NoError(t, err)
	return *result.Request
}

func correctPickup(ctx context.Context, t *testing.T, f *careFixture, row carerequests.Request, approve bool) error {
	t.Helper()
	return testpkg.WithTenantTx(t, ctx, f.db, f.chain.TenantID, func(txCtx context.Context, _ bun.Tx) error {
		return f.svc.(pickupCorrecter).Correct(txCtx, row.ID, approve, readstate.Of(row.UpdatedAt), "Korrektur", f.staffAccount)
	})
}

func currentCorrectionRequest(t *testing.T, f *careFixture, id int64) carerequests.Request {
	t.Helper()
	row, err := f.reposCare.CarePlan().FindCareScheduleRequest(correctionContext(t, f), id, false)
	require.NoError(t, err)
	return row
}

func assertCorrectionEffects(t *testing.T, f *careFixture, date calendar.Date, slotID int64, approved bool) {
	t.Helper()
	ctx := correctionContext(t, f)
	owner := f.reposCare.CarePlan()
	filter := careplan.StudentScheduleFilter{StudentIDs: []int64{f.chain.StudentID}, Date: careplan.Date(date)}
	pickups, err := owner.ListPickupExceptions(ctx, filter)
	require.NoError(t, err)
	departures, err := owner.ListDepartureExceptions(ctx, filter)
	require.NoError(t, err)
	notes, err := owner.ListPickupNotes(ctx, filter)
	require.NoError(t, err)
	slot := testpkg.InstanceStudentByIDContext(t, ctx, f.db, slotID)
	if approved {
		require.Len(t, pickups, 1)
		require.Len(t, departures, 1)
		require.Len(t, notes, 1)
		assert.Equal(t, studentpresence.SessionAttendanceAbsent, slot.Status)
		require.NotNil(t, slot.PickupExceptionID)
		assert.Equal(t, pickups[0].ID, *slot.PickupExceptionID)
	} else {
		assert.Empty(t, pickups)
		assert.Empty(t, departures)
		assert.Empty(t, notes)
		assert.Equal(t, studentpresence.SessionAttendanceExpected, slot.Status)
		assert.Nil(t, slot.Substatus)
		assert.Nil(t, slot.PickupExceptionID)
	}
}

func TestPickupCorrectionUsesCurrentGeneration(t *testing.T) {
	t.Parallel()
	for _, initialApproval := range []bool{false, true} {
		name := "initially rejected"
		if initialApproval {
			name = "initially approved"
		}
		t.Run(name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			f, date, slotID := pickupCorrectionFixture(t)
			ctx := correctionContext(t, f)
			row := correctionRequest(t, f, date, initialApproval)
			if initialApproval {
				require.NoError(t, correctPickup(ctx, t, f, row, false))
				row = currentCorrectionRequest(t, f, row.ID)
			}
			for range 2 {
				require.NoError(t, correctPickup(ctx, t, f, row, true))
				row = currentCorrectionRequest(t, f, row.ID)
				assertCorrectionEffects(t, f, date, slotID, true)
				require.NoError(t, correctPickup(ctx, t, f, row, false), "the corrected approval's generation must be reversible")
				row = currentCorrectionRequest(t, f, row.ID)
				assertCorrectionEffects(t, f, date, slotID, false)
			}
		})
	}
}

func TestPickupCorrectionReleasesAutoExcusal(t *testing.T) {
	t.Parallel()
	f, date, slotID := pickupCorrectionFixture(t)
	row := correctionRequest(t, f, date, true)
	assertCorrectionEffects(t, f, date, slotID, true)
	require.NoError(t, correctPickup(correctionContext(t, f), t, f, row, false))
	assertCorrectionEffects(t, f, date, slotID, false)
}

// Two corrections overlap on real connections. The winner consumes the latest
// approved generation; after waiting, the loser must reject its stale version.
func TestPickupCorrectionConcurrentGeneration(t *testing.T) {
	t.Parallel()
	testpkg.SetupIsolatedTestDB(t)
	f, date, slotID := pickupCorrectionFixture(t)
	row := correctionRequest(t, f, date, false)
	require.NoError(t, correctPickup(correctionContext(t, f), t, f, row, true))
	row = currentCorrectionRequest(t, f, row.ID)
	ctx, cancel := context.WithTimeout(correctionContext(t, f), 15*time.Second)
	defer cancel()
	done := make(chan error, 1)
	err := testpkg.WithTenantTx(t, ctx, f.db, f.chain.TenantID, func(txCtx context.Context, tx bun.Tx) error {
		require.NoError(t, f.reposCare.CarePlan().LockStudentAndExceptionDay(txCtx, f.chain.StudentID, date.String()))
		var pid int
		require.NoError(t, tx.NewRaw("SELECT pg_backend_pid()").Scan(txCtx, &pid))
		go func() { done <- correctPickup(ctx, t, f, row, false) }()
		waitForRequestWriter(t, txCtx, tx, pid)
		return f.svc.(pickupCorrecter).Correct(txCtx, row.ID, false, readstate.Of(row.UpdatedAt), "Korrektur", f.staffAccount)
	})
	loser := awaitRequestWriter(t, ctx, done)
	require.NoError(t, err)
	require.ErrorIs(t, loser, readstate.ErrChanged)
	assertCorrectionEffects(t, f, date, slotID, false)
}

// The day-status writer commits while the correction is waiting for the child.
// Releasing the pickup must restore the newly valid illness, never expected or
// a provenance-free excused absence from the revoked pickup.
func TestPickupCorrectionConcurrentStatusDay(t *testing.T) {
	t.Parallel()
	testpkg.SetupIsolatedTestDB(t)
	f, date, slotID := pickupCorrectionFixture(t)
	row := correctionRequest(t, f, date, true)
	ctx, cancel := context.WithTimeout(correctionContext(t, f), 15*time.Second)
	defer cancel()
	done := make(chan error, 1)
	var statusID int64
	err := testpkg.WithTenantTx(t, ctx, f.db, f.chain.TenantID, func(txCtx context.Context, tx bun.Tx) error {
		owner := f.reposCare.CarePlan()
		require.NoError(t, owner.LockStudentAndExceptionDay(txCtx, f.chain.StudentID, date.String()))
		var pid int
		require.NoError(t, tx.NewRaw("SELECT pg_backend_pid()").Scan(txCtx, &pid))
		go func() { done <- correctPickup(ctx, t, f, row, false) }()
		waitForRequestWriter(t, txCtx, tx, pid)
		status, err := owner.UpsertStudentStatusDay(txCtx, careplan.StudentStatusDay{StudentID: f.chain.StudentID, Status: "sick", Date: careplan.Date(date), Source: "manual", ReportedAt: time.Now()})
		statusID = status.ID
		return err
	})
	correctionErr := awaitRequestWriter(t, ctx, done)
	require.NoError(t, err)
	require.NoError(t, correctionErr)
	slot := testpkg.InstanceStudentByIDContext(t, ctx, f.db, slotID)
	assert.Equal(t, studentpresence.SessionAttendanceAbsent, slot.Status)
	require.NotNil(t, slot.Substatus)
	assert.Equal(t, "sick", *slot.Substatus)
	require.NotNil(t, slot.StudentStatusDayID)
	assert.Equal(t, statusID, *slot.StudentStatusDayID)
	assert.Nil(t, slot.PickupExceptionID)
}

func TestPickupCorrectionPreservesProtectedAttendance(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"sick", "excused", "manual", "completed"} {
		t.Run(kind, func(t *testing.T) {
			testpkg.OwnTenant(t)
			f, date, slotID := pickupCorrectionFixture(t)
			row := correctionRequest(t, f, date, true)
			ctx := correctionContext(t, f)
			presence := api.NewStudentPresenceForTests(testpkg.NewDatabase(t, f.db))
			switch kind {
			case "sick", "excused":
				_, err := f.reposCare.CarePlan().UpsertStudentStatusDay(ctx, careplan.StudentStatusDay{
					StudentID: f.chain.StudentID, Date: careplan.Date(date), Status: kind, Source: "manual", ReportedAt: time.Now(),
				})
				require.NoError(t, err)
			case "manual":
				status := studentpresence.SessionAttendancePresent
				require.NoError(t, presence.PatchSessionAttendance(ctx, slotID, studentpresence.SessionAttendancePatch{Status: &status}))
			case "completed":
				slot := testpkg.InstanceStudentByIDContext(t, ctx, f.db, slotID)
				block := testpkg.ActivityInstanceByID(t, ctx, f.db, slot.InstanceID)
				block.Status = "completed"
				testpkg.UpsertActivitySession(t, ctx, f.db, block)
			}
			before := testpkg.InstanceStudentByIDContext(t, ctx, f.db, slotID)
			require.NoError(t, correctPickup(ctx, t, f, row, false))
			after := testpkg.InstanceStudentByIDContext(t, ctx, f.db, slotID)
			if kind == "manual" || kind == "completed" {
				assert.Equal(t, before.Status, after.Status)
				assert.Equal(t, before.Substatus, after.Substatus)
				assert.Equal(t, before.ManualStatusAt, after.ManualStatusAt)
			} else {
				assert.Equal(t, studentpresence.SessionAttendanceAbsent, after.Status)
				require.NotNil(t, after.Substatus)
				assert.Equal(t, kind, *after.Substatus)
				assert.NotNil(t, after.StudentStatusDayID)
			}
			assert.Nil(t, after.PickupExceptionID)
		})
	}
}

func TestPickupCorrectionRollsBackEveryEffect(t *testing.T) {
	t.Parallel()
	for _, stage := range []string{"release", "ledger", "notification"} {
		t.Run(stage, func(t *testing.T) {
			testpkg.OwnTenant(t)
			db := testpkg.SetupIsolatedTestDB(t)
			f, date, slotID := pickupCorrectionFixture(t)
			ctx := correctionContext(t, f)
			row := correctionRequest(t, f, date, true)
			eventsBefore, err := testpkg.TenantQuery2(t, ctx, f.db, f.reposPeople.ParentRequestEvent.ParentRequestEventsForRequest, "pickup_change", row.ID)
			require.NoError(t, err)
			require.NotEmpty(t, eventsBefore)
			var messagesBefore int
			require.NoError(t, db.NewRaw("SELECT count(*) FROM users.parent_messages WHERE tenant_id = ?", f.chain.TenantID).Scan(ctx, &messagesBefore))
			table, condition := "active.activity_session_attendance", "NEW.status = 'expected'"
			if stage == "ledger" {
				table, condition = "users.parent_request_events", "NEW.event_type = 'corrected'"
			}
			if stage == "notification" {
				table, condition = "users.parent_messages", "true"
			}
			_, err = db.ExecContext(ctx, fmt.Sprintf(`
    CREATE FUNCTION public.reject_pickup_correction() RETURNS trigger AS $$
    BEGIN
     IF %s THEN RAISE EXCEPTION 'injected correction failure'; END IF;
     RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_pickup_correction BEFORE INSERT OR UPDATE ON %s
     FOR EACH ROW EXECUTE FUNCTION public.reject_pickup_correction();`, condition, table))
			require.NoError(t, err)
			require.ErrorContains(t, correctPickup(ctx, t, f, row, false), "injected correction failure")
			assert.Equal(t, row, currentCorrectionRequest(t, f, row.ID))
			assertCorrectionEffects(t, f, date, slotID, true)
			eventsAfter, err := testpkg.TenantQuery2(t, ctx, f.db, f.reposPeople.ParentRequestEvent.ParentRequestEventsForRequest, "pickup_change", row.ID)
			require.NoError(t, err)
			assert.Equal(t, eventsBefore, eventsAfter)
			var messagesAfter int
			require.NoError(t, db.NewRaw("SELECT count(*) FROM users.parent_messages WHERE tenant_id = ?", f.chain.TenantID).Scan(ctx, &messagesAfter))
			assert.Equal(t, messagesBefore, messagesAfter)
		})
	}
}

func TestPickupCorrectionDoesNotFallBackToAnOlderGeneration(t *testing.T) {
	t.Parallel()
	f, date, slotID := pickupCorrectionFixture(t)
	ctx := correctionContext(t, f)
	row := correctionRequest(t, f, date, true)
	require.NoError(t, testpkg.TenantCommand1(t, ctx, f.db, f.reposPeople.ParentRequestEvent.AppendParentRequestEvent, &peopledirectory.ParentRequestEventSnapshot{
		StudentID: f.chain.StudentID, RequestType: "pickup_change", RequestID: row.ID, EventType: "corrected", Payload: json.RawMessage(`{"approve":true}`),
	}))
	require.ErrorContains(t, correctPickup(ctx, t, f, row, false), "cannot be corrected")
	assertCorrectionEffects(t, f, date, slotID, true)
}

// A staff edit whose transaction began before the approval but committed after
// it carries an older transaction stamp than the decision. The correction must
// still see the row as changed and refuse instead of deleting the staff value.
func TestPickupCorrectionRefusesEditFromOverlappingTransaction(t *testing.T) {
	t.Parallel()
	for _, leg := range []string{"pickup", "departure"} {
		t.Run(leg, func(t *testing.T) {
			testpkg.OwnTenant(t)
			testpkg.SetupIsolatedTestDB(t)
			f, date, slotID := pickupCorrectionFixture(t)
			ctx, cancel := context.WithTimeout(correctionContext(t, f), 15*time.Second)
			defer cancel()
			owner := f.reposCare.CarePlan()
			filter := careplan.StudentScheduleFilter{StudentIDs: []int64{f.chain.StudentID}, Date: careplan.Date(date)}
			var row carerequests.Request
			err := testpkg.WithTenantTx(t, ctx, f.db, f.chain.TenantID, func(txCtx context.Context, tx bun.Tx) error {
				// The staff transaction starts, and fixes its now(), first.
				var started time.Time
				require.NoError(t, tx.NewRaw("SELECT now()").Scan(txCtx, &started))
				row = correctionRequest(t, f, date, true)
				require.NoError(t, owner.LockStudentAndExceptionDay(txCtx, f.chain.StudentID, date.String()))
				reason := "Vom Team geändert"
				if leg == "pickup" {
					pickups, err := owner.ListPickupExceptions(txCtx, filter)
					require.NoError(t, err)
					require.Len(t, pickups, 1)
					pickups[0].Reason = &reason
					return owner.UpdatePickupException(txCtx, pickups[0])
				}
				departures, err := owner.ListDepartureExceptions(txCtx, filter)
				require.NoError(t, err)
				require.Len(t, departures, 1)
				departures[0].Reason = &reason
				_, err = owner.SaveDepartureException(txCtx, departures[0])
				return err
			})
			require.NoError(t, err)
			err = correctPickup(ctx, t, f, currentCorrectionRequest(t, f, row.ID), false)
			require.ErrorContains(t, err, "nach der Entscheidung geändert")
			assertCorrectionEffects(t, f, date, slotID, true)
		})
	}
}

// The approval wrote the day's collector note; staff then replaced its text
// through the note editor (PUT /students/{id}/pickup-notes/{noteId}). The
// correction must refuse instead of deleting the team's note.
func TestPickupCorrectionRefusesStaffEditedCollectorNote(t *testing.T) {
	t.Parallel()
	f, date, slotID := pickupCorrectionFixture(t)
	ctx := correctionContext(t, f)
	row := correctionRequest(t, f, date, true)
	notes, err := f.reposCare.CarePlan().ListPickupNotes(ctx, careplan.StudentScheduleFilter{StudentIDs: []int64{f.chain.StudentID}, Date: careplan.Date(date)})
	require.NoError(t, err)
	require.Len(t, notes, 1)
	// The handler's model: the request body plus the preserved identity.
	edited := &careplan.PickupNote{ID: notes[0].ID, TenantID: notes[0].TenantID, StudentID: f.chain.StudentID,
		NoteDate: careplan.Date(date), Content: "Abholung durch Oma Erika", CreatedBy: notes[0].CreatedBy, CreatedAt: notes[0].CreatedAt}
	require.NoError(t, testpkg.TenantCommand2(t, ctx, f.db, f.schedules.Pickups.UpdateStudentPickupNote, edited, careplan.PickupNoteVersion(notes[0])))

	err = correctPickup(ctx, t, f, currentCorrectionRequest(t, f, row.ID), false)
	require.ErrorContains(t, err, "die Abholnotiz am 26.08.2026 wurde nach der Entscheidung geändert")
	assertCorrectionEffects(t, f, date, slotID, true)
	notes, err = f.reposCare.CarePlan().ListPickupNotes(ctx, careplan.StudentScheduleFilter{StudentIDs: []int64{f.chain.StudentID}, Date: careplan.Date(date)})
	require.NoError(t, err)
	require.Len(t, notes, 1)
	assert.Equal(t, "Abholung durch Oma Erika", notes[0].Content)
}

// Ledger entries written before row versions existed keep the guard they were
// written under: a row counts as changed only when its updated_at lies after
// the request's reviewed_at. The old approval stamped an updated exception on
// the owner clock after its transaction began, so an untouched row can lie
// between the request's trigger stamp (updated_at) and reviewed_at.
func TestPickupCorrectionLegacyLedgerKeepsReviewedAtGuard(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name    string
		offset  string
		refused bool
	}{
		{"untouched row stamped inside the decision", "1 second", false},
		{"row edited after the decision", "3 seconds", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			db := testpkg.SetupIsolatedTestDB(t)
			f, date, slotID := pickupCorrectionFixture(t)
			ctx := correctionContext(t, f)
			row := correctionRequest(t, f, date, true)
			require.NoError(t, db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
				if _, err := tx.ExecContext(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE users.parent_request_events
					SET payload = payload - 'pickup_exception_version' - 'departure_exception_version' - 'pickup_note_version'
					WHERE request_type = 'pickup_change' AND request_id = ?`, row.ID); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE schedule.care_schedule_change_requests
					SET updated_at = now() - interval '1 hour', reviewed_at = now() - interval '1 hour' + interval '2 seconds'
					WHERE id = ?`, row.ID); err != nil {
					return err
				}
				for _, table := range []string{"schedule.student_pickup_exceptions", "schedule.student_departure_exceptions"} {
					if _, err := tx.ExecContext(ctx, fmt.Sprintf(`UPDATE %s SET updated_at = now() - interval '1 hour' + interval '%s'
						WHERE student_id = ? AND exception_date = ?`, table, tc.offset), f.chain.StudentID, date.String()); err != nil {
						return err
					}
				}
				return nil
			}))
			err := correctPickup(ctx, t, f, currentCorrectionRequest(t, f, row.ID), false)
			if tc.refused {
				require.ErrorContains(t, err, "nach der Entscheidung geändert")
				assertCorrectionEffects(t, f, date, slotID, true)
				return
			}
			require.NoError(t, err)
			assertCorrectionEffects(t, f, date, slotID, false)
		})
	}
}
