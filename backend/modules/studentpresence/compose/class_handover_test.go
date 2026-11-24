package compose_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestClassHandoverReplacesAndWithdraws pins the class handover store
// (#4794): one handover per class and day, matched trimmed and lowercased,
// with its children "da" and "nicht da"; a second one replaces the first with
// its children; a withdrawal reports whether there was one.
func TestClassHandoverReplacesAndWithdraws(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	first := testpkg.CreateTestStudent(t, db, "Erste", "Übergabe", "3c")
	second := testpkg.CreateTestStudent(t, db, "Zweite", "Übergabe", "3c")
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	day := calendar.NewDate(2099, 3, 2)

	existed, err := module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: " 3c ", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, ExpectedVersion: handoverVersion(t, ctx, module, "3c", day),
		PresentStudentIDs: []int64{second.ID}, AbsentStudentIDs: []int64{first.ID, first.ID},
	})
	require.NoError(t, err)
	assert.False(t, existed)

	handovers, err := module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	require.Len(t, handovers, 1)
	assert.Equal(t, "3c", handovers[0].SchoolClass, "stored trimmed")
	assert.Equal(t, staff.ID, handovers[0].HandedOverByStaffID)
	assert.Equal(t, []int64{first.ID}, handovers[0].AbsentStudentIDs, "a child named twice is absent once")
	assert.Equal(t, []int64{second.ID}, handovers[0].PresentStudentIDs)

	existed, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: "3C", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{second.ID},
		ExpectedVersion: handoverVersion(t, ctx, module, "3c", day),
	})
	require.NoError(t, err)
	assert.True(t, existed, "the same class in another spelling")
	handovers, err = module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	require.Len(t, handovers, 1)
	assert.Equal(t, []int64{second.ID}, handovers[0].AbsentStudentIDs)
	assert.Empty(t, handovers[0].PresentStudentIDs, "the replacement's children only")

	other, err := module.ClassHandoversOn(ctx, day.AddDays(1))
	require.NoError(t, err)
	assert.Empty(t, other, "another day has none")

	existed, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{SchoolClass: "3c", Date: day, Withdraw: true})
	require.NoError(t, err)
	assert.True(t, existed)
	existed, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{SchoolClass: "3c", Date: day, Withdraw: true})
	require.NoError(t, err)
	assert.False(t, existed)
	var absences int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM active.class_handover_children WHERE student_id IN (?, ?)`,
		first.ID, second.ID).Scan(ctx, &absences))
	assert.Zero(t, absences, "the children go with the handover")

	for name, change := range map[string]studentpresence.ClassHandoverChange{
		"no class":        {SchoolClass: " ", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren},
		"no staff":        {SchoolClass: "3c", Date: day},
		"no date":         {SchoolClass: "3c", HandedOverBy: staff.ID, HandoverChildren: noChildren},
		"bad child":       {SchoolClass: "3c", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{0}},
		"bad present":     {SchoolClass: "3c", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, PresentStudentIDs: []int64{-1}},
		"da and nicht da": {SchoolClass: "3c", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, PresentStudentIDs: []int64{first.ID}, AbsentStudentIDs: []int64{first.ID}},
		"no children":     {SchoolClass: "3c", Date: day, HandedOverBy: staff.ID},
		"withdraw blank":  {SchoolClass: "", Date: day, Withdraw: true},
	} {
		_, err := module.ChangeClassHandover(ctx, change)
		assert.ErrorIs(t, err, studentpresence.ErrClassHandoverInvalid, name)
	}
}

// TestClassHandoverStaysInItsSchool proves the RLS boundary: another school
// sees none of the handovers.
func TestClassHandoverStaysInItsSchool(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	student := testpkg.CreateTestStudent(t, db, "Eigene", "Schule", "4a")
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	day := calendar.NewDate(2099, 3, 2)
	_, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: "4a", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{student.ID},
		ExpectedVersion: handoverVersion(t, ctx, module, "4a", day),
	})
	require.NoError(t, err)

	t.Run("another school", func(t *testing.T) {
		otherCtx := testpkg.OwnCtx(t)
		handovers, err := module.ClassHandoversOn(otherCtx, day)
		require.NoError(t, err)
		assert.Empty(t, handovers)
		existed, err := module.ChangeClassHandover(otherCtx, studentpresence.ClassHandoverChange{SchoolClass: "4a", Date: day, Withdraw: true})
		require.NoError(t, err)
		assert.False(t, existed, "another school cannot take it back")
	})
	handovers, err := module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	assert.Len(t, handovers, 1)
}

// TestMorningAttendanceRetentionDeletesClassHandovers proves the nightly
// retention deletes the handovers of the expired days with the morning
// attendance and counts them.
func TestMorningAttendanceRetentionDeletesClassHandovers(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}, Now: presenceClock})
	require.NoError(t, err)
	student := testpkg.CreateTestStudent(t, db, "Frist", "Übergabe", "1b")
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	expired := presenceToday.AddDays(-400)
	kept := presenceToday.AddDays(-10)
	for _, day := range []calendar.Date{expired, kept} {
		_, err := module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
			SchoolClass: "1b", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{student.ID},
			ExpectedVersion: handoverVersion(t, ctx, module, "1b", day),
		})
		require.NoError(t, err)
	}

	require.NoError(t, tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		deleted, err := module.DeleteExpiredMorningAttendance(txCtx, 365)
		assert.Equal(t, 1, deleted, "the expired handover; its absence goes by cascade")
		return err
	}))
	gone, err := module.ClassHandoversOn(ctx, expired)
	require.NoError(t, err)
	assert.Empty(t, gone)
	left, err := module.ClassHandoversOn(ctx, kept)
	require.NoError(t, err)
	assert.Len(t, left, 1)
}

// A second submission read before an uncommitted first handover waits for
// it under the class and day's lock and is then refused as read before that
// handover (ADR 0311), without a unique-constraint error; the first handover
// and its absence list stay. A morning mark of the class waits for the same
// lock: the handover's version covers the marks, so none lands between its
// check and its commit.
func TestClassHandoverConcurrentReplacement(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx, cancel := context.WithTimeout(testpkg.Ctx(t), 10*time.Second)
	defer cancel()
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	first := testpkg.CreateTestStudent(t, db, "Erste", "Übergabe", "3c")
	second := testpkg.CreateTestStudent(t, db, "Zweite", "Übergabe", "3c")
	firstStaff := testpkg.CreateTestStaff(t, db, "Erste", "Lehrkraft")
	secondStaff := testpkg.CreateTestStaff(t, db, "Zweite", "Lehrkraft")
	day := calendar.NewDate(2099, 3, 2)
	type result struct {
		replaced bool
		err      error
	}
	before := handoverVersion(t, ctx, module, "3c", day)
	completed := make(chan result, 1)
	marked := make(chan error, 1)
	err = testpkg.WithTenantTx(t, ctx, db, testpkg.Tenant(t), func(txCtx context.Context, tx bun.Tx) error {
		_, changeErr := module.ChangeClassHandover(txCtx, studentpresence.ClassHandoverChange{
			SchoolClass: "3c", Date: day, HandedOverBy: firstStaff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{first.ID},
			ExpectedVersion: before,
		})
		require.NoError(t, changeErr)
		var holderPID int
		require.NoError(t, tx.NewRaw("SELECT pg_backend_pid()").Scan(txCtx, &holderPID))
		go func() {
			replaced, changeErr := module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
				SchoolClass: " 3C ", Date: day, HandedOverBy: secondStaff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{second.ID},
				ExpectedVersion: before,
			})
			completed <- result{replaced, changeErr}
		}()
		go func() {
			marked <- module.RecordMorningAttendance(ctx, studentpresence.MorningAttendanceWrite{
				Date: day, RecordedBy: secondStaff.ID, SchoolClass: " 3C ",
				Marks: []studentpresence.MorningAttendanceMark{{Child: studentpresence.MorningAttendanceChild{StudentID: second.ID}, Status: studentpresence.MorningAttendanceAbsent}},
			})
		}()
		// Wait until the second handover and the morning mark actually
		// contend with the first handover. Without serialization the
		// handover waits at INSERT after deleting zero rows, and the mark
		// does not wait at all.
		require.Eventually(t, func() bool {
			var blocked int
			queryErr := db.NewRaw(`SELECT COUNT(*) FROM pg_stat_activity
				WHERE datname = current_database() AND ? = ANY(pg_blocking_pids(pid))`, holderPID).Scan(ctx, &blocked)
			require.NoError(t, queryErr)
			return blocked == 2
		}, 5*time.Second, 10*time.Millisecond, "the second handover and the morning mark wait for the first handover")
		return nil
	})
	require.NoError(t, err)
	select {
	case markErr := <-marked:
		require.NoError(t, markErr, "the mark lands after the handover")
	case <-ctx.Done():
		t.Fatal("morning mark did not finish", ctx.Err())
	}
	select {
	case replacement := <-completed:
		require.ErrorIs(t, replacement.err, readstate.ErrChanged)
		assert.False(t, replacement.replaced)
	case <-ctx.Done():
		t.Fatal("concurrent handover did not finish", ctx.Err())
	}
	handovers, err := module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	require.Len(t, handovers, 1)
	assert.Equal(t, firstStaff.ID, handovers[0].HandedOverByStaffID)
	assert.Equal(t, []int64{first.ID}, handovers[0].AbsentStudentIDs)
	assert.Empty(t, handovers[0].PresentStudentIDs, "the first handover's children only")
}

// handoverVersion is the version of the class's handover on day as the
// class view reads it now.
func handoverVersion(t *testing.T, ctx context.Context, module interface {
	ClassHandoversOn(context.Context, calendar.Date) ([]studentpresence.ClassHandover, error)
}, class string, day calendar.Date) string {
	t.Helper()
	handovers, err := module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	for i := range handovers {
		if strings.EqualFold(strings.TrimSpace(handovers[i].SchoolClass), class) {
			return studentpresence.ClassHandoverVersion(&handovers[i], nil, nil)
		}
	}
	return studentpresence.ClassHandoverVersion(nil, nil, nil)
}

// noChildren is a class whose handover dialog lists no child staying in the
// OGS: the version covers the stored handover alone.
func noChildren(context.Context) ([]int64, error) { return nil, nil }

// A Lehrkraft whose class view was read before another handover of her class
// cannot mark the child that handover has "nicht da" as "da" again (ADR
// 0311): her save is refused and writes nothing.
func TestClassHandoverRefusesStaleVersion(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	absent := testpkg.CreateTestStudent(t, db, "Fehlt", "Heute", "2b")
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	day := calendar.NewDate(2099, 3, 2)
	read := handoverVersion(t, ctx, module, "2b", day)

	_, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: "2b", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, AbsentStudentIDs: []int64{absent.ID}, ExpectedVersion: read,
	})
	require.NoError(t, err)

	for name, expected := range map[string]string{"read before": read, "no version": ""} {
		_, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
			SchoolClass: "2B", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, PresentStudentIDs: []int64{absent.ID}, ExpectedVersion: expected,
		})
		require.ErrorIs(t, err, readstate.ErrChanged, name)
	}
	handovers, err := module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	require.Len(t, handovers, 1)
	assert.Equal(t, []int64{absent.ID}, handovers[0].AbsentStudentIDs, "the child stays nicht da")

	_, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: "2b", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, PresentStudentIDs: []int64{absent.ID},
		ExpectedVersion: handoverVersion(t, ctx, module, "2b", day),
	})
	require.NoError(t, err, "the current version replaces the handover")
}

// The version covers the children the handover dialog lists and their
// morning absence marks, read under the lock: a child taken out of the
// dialog after the read (a sick report, an excused day, a class trip, a
// cancelled care day) or a morning absence entered for one of them refuses
// the stale handover and stores nothing (ADR 0311).
func TestClassHandoverRefusesAnotherDialog(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	stays := testpkg.CreateTestStudent(t, db, "Bleibt", "Da", "5d")
	leaves := testpkg.CreateTestStudent(t, db, "Wird", "Krank", "5d")
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	day := calendar.NewDate(2099, 3, 2)
	read := studentpresence.ClassHandoverVersion(nil, []int64{stays.ID, leaves.ID}, nil)
	onlyStays := func(context.Context) ([]int64, error) { return []int64{stays.ID}, nil }
	handOver := func(version string) error {
		_, err := module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
			SchoolClass: "5d", Date: day, HandedOverBy: staff.ID, HandoverChildren: onlyStays,
			PresentStudentIDs: []int64{stays.ID, leaves.ID}, ExpectedVersion: version,
		})
		return err
	}

	require.ErrorIs(t, handOver(read), readstate.ErrChanged, "a child left the dialog")
	read = studentpresence.ClassHandoverVersion(nil, []int64{stays.ID}, nil)
	require.NoError(t, module.RecordMorningAttendance(ctx, studentpresence.MorningAttendanceWrite{
		Date: day, RecordedBy: staff.ID, SchoolClass: "5d",
		Marks: []studentpresence.MorningAttendanceMark{{Child: studentpresence.MorningAttendanceChild{StudentID: stays.ID}, Status: studentpresence.MorningAttendanceAbsent}},
	}))
	require.ErrorIs(t, handOver(read), readstate.ErrChanged, "a child of the dialog was marked absent")
	handovers, err := module.ClassHandoversOn(ctx, day)
	require.NoError(t, err)
	assert.Empty(t, handovers, "no refused handover stored anything")

	require.NoError(t, handOver(studentpresence.ClassHandoverVersion(nil, []int64{stays.ID}, []int64{stays.ID})))
}

// Parents and children must share one statement snapshot so a concurrent
// replacement or withdrawal cannot leave an old handover without its children.
func TestClassHandoversReadSingleSnapshot(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	module, err := compose.New(compose.Dependencies{DB: db, Observe: func(compose.Observation) {}})
	require.NoError(t, err)
	first := testpkg.CreateTestStudent(t, db, "Erste", "Übergabe", "3c")
	second := testpkg.CreateTestStudent(t, db, "Zweite", "Übergabe", "3c")
	third := testpkg.CreateTestStudent(t, db, "Dritte", "Übergabe", "3c")
	staff := testpkg.CreateTestStaff(t, db, "Lehr", "Kraft")
	day := calendar.NewDate(2099, 3, 2)
	_, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: "3c", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren,
		PresentStudentIDs: []int64{second.ID, first.ID}, AbsentStudentIDs: []int64{third.ID},
		ExpectedVersion: handoverVersion(t, ctx, module, "3c", day),
	})
	require.NoError(t, err)
	_, err = module.ChangeClassHandover(ctx, studentpresence.ClassHandoverChange{
		SchoolClass: "4a", Date: day, HandedOverBy: staff.ID, HandoverChildren: noChildren, ExpectedVersion: handoverVersion(t, ctx, module, "4a", day),
	})
	require.NoError(t, err)

	counter := testpkg.CaptureQueriesForContext(t, db)
	handovers, err := module.ClassHandoversOn(counter.Context(ctx), day)
	require.NoError(t, err)
	require.Len(t, handovers, 2)
	assert.Equal(t, "3c", handovers[0].SchoolClass)
	assert.Equal(t, []int64{first.ID, second.ID}, handovers[0].PresentStudentIDs)
	assert.Equal(t, []int64{third.ID}, handovers[0].AbsentStudentIDs)
	assert.Equal(t, "4a", handovers[1].SchoolClass)
	assert.NotNil(t, handovers[1].PresentStudentIDs)
	assert.Empty(t, handovers[1].PresentStudentIDs)
	assert.NotNil(t, handovers[1].AbsentStudentIDs)
	assert.Empty(t, handovers[1].AbsentStudentIDs)
	parentReads := counter.Selects("class_handovers")
	require.Len(t, parentReads, 1)
	assert.Equal(t, parentReads, counter.Selects("class_handover_children"),
		"handovers and children must be loaded by the same statement")
}
