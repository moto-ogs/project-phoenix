// Flow I — Personalpool + atomarer Personal-Move (#1884).
//
// Drives the two new endpoints through the production router: the pool read
// categorizes staff against a block's window, the move relocates one person
// from Schulhof to Mensa in one save, the Änderungsprotokoll shows the single
// staff_moved entry, and a foreign tenant sees 404.
package e2e_timetable

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestFlowI_StaffPoolAndAtomicMove(t *testing.T) {
	t.Parallel()

	// The scenario decides on a school Monday; the blocks lie a week later.
	today := calendar.NewDate(2030, 8, 26)
	s := setupTimetableScenarioModule(t, func() time.Time { return today.BerlinMidnight().Add(12 * time.Hour) })

	date := today.AddDays(7)
	room := testpkg.CreateTestRoom(t, s.db, "Flow-I-Raum")
	mover := testpkg.CreateTestStaff(t, s.db, "Ina", "Umzieherin")
	free := testpkg.CreateTestStaff(t, s.db, "Frido", "Verfuegbar")

	schulhof := testpkg.CreateTestActivityInstance(t, s.db, date, room.ID, testpkg.ActivityInstanceOpts{
		Title: "Schulhof", StartHHMM: "12:00", EndHHMM: "14:00",
	})
	mensa := testpkg.CreateTestActivityInstance(t, s.db, date, room.ID, testpkg.ActivityInstanceOpts{
		Title: "Mensa", StartHHMM: "12:30", EndHHMM: "13:30",
	})

	row := testpkg.CreateTestInstanceStaff(t, s.db, schulhof.ID, mover.ID, testpkg.InstanceStaffOpts{})
	testpkg.CreateTestStaffShift(t, s.db, mover.ID, date, testpkg.StaffShiftOpts{})
	testpkg.CreateTestStaffShift(t, s.db, free.ID, date, testpkg.StaffShiftOpts{})

	claims := s.primaryAdminClaims()

	// 1. Pool read: mover is planned elsewhere, free is on shift and free.
	rr := s.do(http.MethodGet, fmt.Sprintf("/instances/%d/staff-pool", mensa.ID), nil, claims)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var pool struct {
		DienstplanInUse bool `json:"dienstplan_in_use"`
		Entries         []struct {
			StaffID     testpkg.ID `json:"staff_id"`
			Category    string     `json:"category"`
			Assignments []struct {
				InstanceID testpkg.ID `json:"instance_id"`
				Title      string     `json:"title"`
			} `json:"assignments"`
		} `json:"entries"`
	}
	decodeResponse(t, rr, &pool)
	assert.True(t, pool.DienstplanInUse)
	categories := map[int64]string{}
	for _, e := range pool.Entries {
		categories[int64(e.StaffID)] = e.Category
		if int64(e.StaffID) == mover.ID {
			require.Len(t, e.Assignments, 1)
			assert.Equal(t, schulhof.ID, int64(e.Assignments[0].InstanceID))
			assert.Equal(t, "Schulhof", e.Assignments[0].Title)
		}
	}
	assert.Equal(t, "assigned_elsewhere", categories[mover.ID])
	assert.Equal(t, "on_shift_free", categories[free.ID])

	// 2. Atomic move Schulhof → Mensa.
	moveBody := map[string]any{"staff_id": testpkg.ID(mover.ID), "source_instance_id": testpkg.ID(schulhof.ID)}
	rr = s.do(http.MethodPost, fmt.Sprintf("/instances/%d/move-staff", mensa.ID), moveBody, claims)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var moved struct {
		TargetInstanceID testpkg.ID  `json:"target_instance_id"`
		SourceInstanceID *testpkg.ID `json:"source_instance_id"`
		Action           string      `json:"action"`
	}
	decodeResponse(t, rr, &moved)
	assert.Equal(t, "moved", moved.Action)
	assert.Equal(t, mensa.ID, int64(moved.TargetInstanceID))

	var rows []*testpkg.InstanceStaff
	require.NoError(t, s.db.NewSelect().Model(&rows).
		ModelTableExpr(`schedule.instance_staff AS "instance_staff"`).
		Where(`"instance_staff".id = ?`, row.ID).Scan(s.tenantCtx()))
	require.Len(t, rows, 1)
	assert.Equal(t, mensa.ID, rows[0].InstanceID, "row relocated to the target block")

	// 3. Änderungsprotokoll: one connected staff_moved entry with names.
	rr = s.do(http.MethodGet, fmt.Sprintf("/deviations/history?date=%s", date.String()), nil, claims)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var history struct {
		Events []struct {
			EventType        string      `json:"event_type"`
			InstanceID       *testpkg.ID `json:"instance_id"`
			SubjectStaffName *string     `json:"subject_staff_name"`
		} `json:"events"`
	}
	decodeResponse(t, rr, &history)
	require.Len(t, history.Events, 1, "exactly one protocol entry for the move")
	assert.Equal(t, "staff_moved", history.Events[0].EventType)
	require.NotNil(t, history.Events[0].InstanceID)
	assert.Equal(t, mensa.ID, int64(*history.Events[0].InstanceID))
	require.NotNil(t, history.Events[0].SubjectStaffName)
	assert.Contains(t, *history.Events[0].SubjectStaffName, "Ina")
	// 4. Pool assign: the free person joins Mensa without a source block.
	rr = s.do(http.MethodPost, fmt.Sprintf("/instances/%d/move-staff", mensa.ID),
		map[string]any{"staff_id": testpkg.ID(free.ID)}, claims)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	decodeResponse(t, rr, &moved)
	assert.Equal(t, "assigned", moved.Action)
	var mensaRows []*testpkg.InstanceStaff
	require.NoError(t, s.db.NewSelect().Model(&mensaRows).
		ModelTableExpr(`schedule.instance_staff AS "instance_staff"`).
		Where(`"instance_staff".instance_id = ?`, mensa.ID).Scan(s.tenantCtx()))
	assert.Len(t, mensaRows, 2)

	// 5. Tenant isolation: a foreign tenant cannot see or move.
	foreign := adminClaimsForTenant(2, s.secondaryTenant)
	rr = s.do(http.MethodGet, fmt.Sprintf("/instances/%d/staff-pool", mensa.ID), nil, foreign)
	assert.Equal(t, http.StatusNotFound, rr.Code, rr.Body.String())
	rr = s.do(http.MethodPost, fmt.Sprintf("/instances/%d/move-staff", mensa.ID), moveBody, foreign)
	assert.Equal(t, http.StatusNotFound, rr.Code, rr.Body.String())
}
