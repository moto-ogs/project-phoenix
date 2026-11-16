// Router-level test for the end of a Springer's employment after the last
// block at a school (#7197, ADR 0089 section 8, ADR 0252): the Worker's run
// offboards the employment the first block created, through the production
// offboarding owners and Identity & Access. It becomes a former employment,
// the home school keeps the account, and the next block resumes it.
package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// pastBlocks moves every block of the record at the school to a day long
// past, so the run finds the last block over whatever the clock says.
func pastBlocks(t *testing.T, db *bun.DB, recordID, schoolID int64) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `UPDATE workforce.staff_pool_blocks SET date = DATE '2000-01-03' + (id % 1000)::int
		WHERE staff_record_id = ? AND school_id = ?`, recordID, schoolID)
	require.NoError(t, err)
}

func TestStaffPoolLastBlockEndsTheSpringerEmployment(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2037, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, _, _, unit, office, schoolRoutes := newTraegerStaffFixtureWith(t, db, func() time.Time { return today }, &StaffPlanningTestRules{})
	school := testpkg.TenantRuntimeMiddleware(t, db)(schoolRoutes)
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)
	manage := []string{permissions.TimeTrackingManage}

	mira, miraAccount := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Springer")
	_, southLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, south, "Sina", "Süd")
	rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
		"members": []map[string]int64{{"school_id": north, "staff_id": mira.ID}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	record := decode[staffRecordBody](t, rec).ID
	rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/contracts", record), map[string]any{
		"kind": "part_time", "starts_on": "2026-08-01", "pool": true,
		"sites": []map[string]any{{"school_id": north, "staff_id": mira.ID, "weekday_minutes": []int{300, 300, 300, 300, 300}}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	block := func(date string) {
		t.Helper()
		rec := poolSchoolRequest(t, school, south, southLead.ID, manage, http.MethodPost, "/api/staff-pool/blocks", map[string]any{
			"staff_record_id": fmt.Sprint(record), "date": date, "start_time": "08:00", "end_time": "13:00",
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	}
	account := miraAccount.ID
	runSchool, err := NewSpringerExitsForTest(testpkg.NewDatabase(t, db), unit)
	require.NoError(t, err)
	run := func(schoolID int64) []string {
		t.Helper()
		ctx := tenant.WithUnitOfWork(testpkg.ContextForTenant(testpkg.WithTenantRuntime(t, t.Context(), db), schoolID), unit)
		outcomes, err := testpkg.TenantQuery0(t, ctx, db, runSchool)
		require.NoError(t, err)
		return outcomes
	}
	employment := func() (staffID int64, live bool) {
		t.Helper()
		require.NoError(t, db.NewRaw(`SELECT link.membership_id, membership.deleted_at IS NULL FROM workforce.staff_record_links AS link
			JOIN users.staff_school_memberships AS membership ON membership.tenant_id = link.school_id AND membership.id = link.membership_id
			WHERE link.staff_record_id = ? AND link.school_id = ? AND link.via_pool`, record, south).Scan(t.Context(), &staffID, &live))
		return staffID, live
	}
	mappingActive := func(schoolID int64) bool {
		t.Helper()
		active, err := testpkg.ActiveAccountTenantExists(t.Context(), db, account, schoolID)
		require.NoError(t, err)
		return active
	}
	traegerEmployment := func() (active, viaPool bool) {
		t.Helper()
		rec := traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", record), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		type place struct {
			SchoolID int64 `json:"school_id"`
			Active   bool  `json:"active"`
			ViaPool  bool  `json:"via_pool"`
		}
		body := decode[struct {
			Employments []place `json:"employments"`
		}](t, rec)
		for _, employment := range body.Employments {
			if employment.SchoolID == south {
				return employment.Active, employment.ViaPool
			}
		}
		t.Fatal("the Einsatzort of the pool is missing")
		return false, false
	}

	block("2037-11-19")
	first, live := employment()
	require.True(t, live)

	t.Run("a coming block keeps the employment", func(t *testing.T) {
		assert.Empty(t, run(south))
		_, live := employment()
		assert.True(t, live)
		active, viaPool := traegerEmployment()
		assert.True(t, active)
		assert.True(t, viaPool, "the Personalverwaltung sees that the pool created the Einsatzort")
	})

	t.Run("after the last block the employment is a former one", func(t *testing.T) {
		_, err := db.ExecContext(t.Context(), `UPDATE auth.account_tenants
			SET access_windows = access_windows || '{"999999": ["2000-01-03T07:30:00Z", "2000-01-03T13:30:00Z"]}'::jsonb
			WHERE tenant_id = ? AND account_id = ?`, south, account)
		require.NoError(t, err)
		pastBlocks(t, db, record, south)
		// Only the pool's school is left: the exit would deactivate the
		// account.
		_, err = db.ExecContext(t.Context(), `UPDATE auth.account_tenants SET status = 'inactive', deactivated_at = now()
			WHERE account_id = ? AND tenant_id <> ?`, account, south)
		require.NoError(t, err)

		result := run(south)
		require.Len(t, result, 1)
		assert.Equal(t, "kept", result[0],
			"without another school the exit would deactivate the account the next block needs")
		_, live := employment()
		require.True(t, live)

		testpkg.MapAccountToTenant(t, db, account, north)
		result = run(south)
		require.Len(t, result, 1)
		assert.Equal(t, "succeeded", result[0])
		staffID, live := employment()
		assert.Equal(t, first, staffID)
		assert.False(t, live, "the employment at the school ended")
		assert.Equal(t, springerAt{People: 1, Links: 1, Windows: 1}, springerAtSchool(t, db, south, account, record),
			"role and live employment are gone, the person and the link stay for the next block; the ended window is pruned")
		assert.False(t, mappingActive(south))
		assert.True(t, mappingActive(north), "the exit locks no account that works at another school")
		var accountActive bool
		require.NoError(t, db.NewRaw(`SELECT active FROM auth.accounts WHERE id = ?`, account).Scan(t.Context(), &accountActive))
		assert.True(t, accountActive)

		var trail int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM workforce.staff_record_changes
			WHERE staff_record_id = ? AND kind = 'ended' AND field = 'school' AND school_id = ? AND account_id = ?`, record, south, southLead.ID).Scan(t.Context(), &trail))
		assert.Equal(t, 1, trail, "the end is in the record's trail with the Leitung of the last block")
		var reason string
		require.NoError(t, db.NewRaw(`SELECT deletion_reason FROM audit.data_deletions WHERE tenant_id = ? AND staff_id = ?`, south, first).Scan(t.Context(), &reason))
		assert.Contains(t, reason, "springer employment ended after last block day 2000-")

		active, viaPool := traegerEmployment()
		assert.False(t, active, "the Personalverwaltung sees a former employment")
		assert.True(t, viaPool)
		assert.Empty(t, run(south), "a former employment is no exit any more")
	})

	t.Run("the next block resumes the former employment", func(t *testing.T) {
		block("2037-11-24")
		staffID, live := employment()
		assert.Equal(t, first, staffID, "the block resumes the employment (ADR 0021)")
		assert.True(t, live)
		state := springerAtSchool(t, db, south, account, record)
		assert.Equal(t, 1, state.Memberships)
		assert.Equal(t, 1, state.Roles)
		assert.True(t, mappingActive(south))
	})

	t.Run("a role of the school's own keeps the employment", func(t *testing.T) {
		_, err := db.ExecContext(t.Context(), `INSERT INTO auth.account_roles (account_id, role_id, tenant_id)
			SELECT ?, id, ? FROM auth.roles WHERE name = 'user' AND tenant_id IS NULL`, account, south)
		require.NoError(t, err)
		pastBlocks(t, db, record, south)
		result := run(south)
		require.Len(t, result, 1)
		assert.Equal(t, "kept", result[0])
		_, live := employment()
		assert.True(t, live, "the school employs the person beyond the pool")
	})
}
