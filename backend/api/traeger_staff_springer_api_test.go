// Router-level test for the employment the first block of a Springer
// creates (#7173, ADR 0089 section 9, ADR 0251): person, employment, the
// system role springer and a mapping at the blocking school, linked as an
// Einsatzort of the record. Two first blocks at once create one
// employment. Each block opens a window; lifting it closes the window, and
// without an open window the school does not admit the Springer.
package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// springerAt is what the first block left at one school for one account.
type springerAt struct {
	People, Memberships, Roles, Links, Windows int
}

func springerAtSchool(t *testing.T, db *bun.DB, schoolID, accountID, recordID int64) springerAt {
	t.Helper()
	var state springerAt
	require.NoError(t, db.NewRaw(`SELECT
		(SELECT count(*) FROM users.persons WHERE tenant_id = ?0 AND account_id = ?1 AND deleted_at IS NULL) AS people,
		(SELECT count(*) FROM users.staff_school_memberships AS m JOIN users.persons AS p ON p.tenant_id = m.tenant_id AND p.id = m.person_id
			WHERE m.tenant_id = ?0 AND p.account_id = ?1 AND m.deleted_at IS NULL) AS memberships,
		(SELECT count(*) FROM auth.account_roles AS ar JOIN auth.roles AS r ON r.id = ar.role_id
			WHERE ar.tenant_id = ?0 AND ar.account_id = ?1 AND r.name = 'springer' AND r.tenant_id IS NULL) AS roles,
		(SELECT count(*) FROM workforce.staff_record_links WHERE school_id = ?0 AND staff_record_id = ?2 AND via_pool) AS links,
		COALESCE((SELECT count(*) FROM auth.account_tenants AS mapping, jsonb_object_keys(mapping.access_windows)
			WHERE mapping.tenant_id = ?0 AND mapping.account_id = ?1), 0) AS windows`,
		schoolID, accountID, recordID).Scan(t.Context(), &state.People, &state.Memberships, &state.Roles, &state.Links, &state.Windows))
	return state
}

func admitted(t *testing.T, db *bun.DB, accountID, schoolID int64) bool {
	t.Helper()
	var ok bool
	require.NoError(t, db.NewRaw(`SELECT auth.account_tenant_admitted(?, ?)`, accountID, schoolID).Scan(t.Context(), &ok))
	return ok
}

func TestStaffPoolFirstBlockEmploysTheSpringer(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	// Far ahead of the database clock, so every window lies ahead of it.
	today := time.Date(2037, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, _, _, unit, office, schoolRoutes := newTraegerStaffFixtureWith(t, db, func() time.Time { return today }, &StaffPlanningTestRules{})
	school := testpkg.TenantRuntimeMiddleware(t, db)(schoolRoutes)
	north, south := office.schools[0], office.schools[1]
	west := testpkg.CreateTestSchoolInOrganization(t, db, office.organization, "Träger Personal OGS West")
	staffRelease(t, db, office.organization)
	manage := []string{permissions.TimeTrackingManage}

	mira, miraAccount := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Springer")
	_, southLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, south, "Sina", "Süd")
	_, westLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, west, "Wim", "West")
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

	block := func(schoolID, accountID int64, date, start, end string) *httptest.ResponseRecorder {
		return poolSchoolRequest(t, school, schoolID, accountID, manage, http.MethodPost, "/api/staff-pool/blocks", map[string]any{
			"staff_record_id": fmt.Sprint(record), "date": date, "start_time": start, "end_time": end,
		})
	}
	blockID := func(rec *httptest.ResponseRecorder) int64 {
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		return int64(*decode[struct {
			ID *testpkg.ID `json:"id"`
		}](t, rec).ID)
	}
	account := miraAccount.ID

	var first int64
	t.Run("the first block employs the Springer at the school", func(t *testing.T) {
		require.Equal(t, springerAt{}, springerAtSchool(t, db, south, account, int64(record)))
		first = blockID(block(south, southLead.ID, "2037-11-19", "08:00", "13:00"))
		assert.Equal(t, springerAt{People: 1, Memberships: 1, Roles: 1, Links: 1, Windows: 1},
			springerAtSchool(t, db, south, account, int64(record)))

		var startsAt, endsAt time.Time
		require.NoError(t, db.NewRaw(`SELECT (access_windows -> ?::text ->> 0)::timestamptz, (access_windows -> ?::text ->> 1)::timestamptz
			FROM auth.account_tenants WHERE tenant_id = ? AND account_id = ?`, first, first, south, account).
			Scan(t.Context(), &startsAt, &endsAt))
		assert.Equal(t, time.Date(2037, time.November, 19, 7, 30, 0, 0, calendar.Berlin), startsAt.In(calendar.Berlin), "30 minutes before the block")
		assert.Equal(t, time.Date(2037, time.November, 19, 13, 30, 0, 0, calendar.Berlin), endsAt.In(calendar.Berlin), "30 minutes after the block")

		var firstName string
		require.NoError(t, db.NewRaw(`SELECT first_name FROM users.persons WHERE tenant_id = ? AND account_id = ?`, south, account).Scan(t.Context(), &firstName))
		assert.Equal(t, "Mira", firstName, "the person carries the names of the record")

		var trail int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM workforce.staff_record_changes
			WHERE staff_record_id = ? AND kind = 'linked' AND field = 'school' AND school_id = ? AND account_id = ?`, record, south, southLead.ID).Scan(t.Context(), &trail))
		assert.Equal(t, 1, trail, "the new Einsatzort is in the record's trail with the blocking lead (ADR 0089 section 6)")

		rec := traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", record), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var atSouth bool
		for _, employment := range decode[staffRecordBody](t, rec).Employments {
			atSouth = atSouth || (int64(employment.SchoolID) == south && employment.Active)
		}
		assert.True(t, atSouth, "the Personalverwaltung sees and plans the new Einsatzort")
	})

	t.Run("a further block of the school adds only its window", func(t *testing.T) {
		blockID(block(south, southLead.ID, "2037-11-19", "14:00", "16:00"))
		assert.Equal(t, springerAt{People: 1, Memberships: 1, Roles: 1, Links: 1, Windows: 2},
			springerAtSchool(t, db, south, account, int64(record)))
	})

	t.Run("two first blocks at once create one employment", func(t *testing.T) {
		var wg sync.WaitGroup
		codes := make([]int, 2)
		for i, start := range []string{"08:00", "13:00"} {
			wg.Go(func() {
				end := map[string]string{"08:00": "12:00", "13:00": "16:00"}[start]
				codes[i] = block(west, westLead.ID, "2037-11-20", start, end).Code
			})
		}
		wg.Wait()
		assert.Equal(t, []int{http.StatusCreated, http.StatusCreated}, codes)
		assert.Equal(t, springerAt{People: 1, Memberships: 1, Roles: 1, Links: 1, Windows: 2},
			springerAtSchool(t, db, west, account, int64(record)))
	})

	t.Run("a regular Einsatzort stays unlimited and gets nothing", func(t *testing.T) {
		before := springerAtSchool(t, db, north, account, int64(record))
		blockID(block(north, account, "2037-11-23", "08:00", "10:00"))
		assert.Equal(t, before, springerAtSchool(t, db, north, account, int64(record)))
		assert.True(t, admitted(t, db, account, north), "the home school admits without a window")
	})

	t.Run("the school admits the Springer only while a window is open", func(t *testing.T) {
		assert.False(t, admitted(t, db, account, south), "every window of the school lies ahead")
		// A session at the school ends at its next request (the per-request
		// family check, #5194) while no window is open.
		identity, err := lifecycleTestModule(testpkg.NewDatabase(t, db), unit, GuardianInvitationTestConfig{})
		require.NoError(t, err)
		// The session expires on the clock of Identity & Access, here time.Now
		// (ADR 0281); the access windows stay on the database clock of
		// auth.account_tenant_admitted.
		var family string
		require.NoError(t, db.NewRaw(`INSERT INTO auth.tokens (account_id, token, expiry, family_id, generation, tenant_id, portal_scope, identifier)
			SELECT ?, encode(sha256(convert_to(f, 'UTF8')), 'hex'), ?, f, 0, ?, 'tenant', 'refresh'
			FROM (SELECT gen_random_uuid()::text AS f) AS family RETURNING family_id`, account, time.Now().Add(7*24*time.Hour), south).Scan(t.Context(), &family))
		session := identityaccess.AccessSession{AccountID: account, FamilyID: family}
		ctx := tenant.WithUnitOfWork(t.Context(), unit)
		assert.ErrorIs(t, identity.VerifyAccessSession(ctx, session), identityaccess.ErrInvalidToken, "no open window ends the session")
		_, err = db.ExecContext(t.Context(), `UPDATE auth.account_tenants
			SET access_windows = access_windows || jsonb_build_object(?::text, jsonb_build_array(now() - interval '1 hour', now() + interval '1 hour'))
			WHERE tenant_id = ? AND account_id = ?`, first, south, account)
		require.NoError(t, err)
		assert.True(t, admitted(t, db, account, south), "an open window admits")
		assert.NoError(t, identity.VerifyAccessSession(ctx, session), "an open window keeps the session")
	})

	t.Run("lifting a block closes its window", func(t *testing.T) {
		rec := poolSchoolRequest(t, school, south, southLead.ID, manage, http.MethodDelete, fmt.Sprintf("/api/staff-pool/blocks/%d", first), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 1, springerAtSchool(t, db, south, account, int64(record)).Windows)
		assert.False(t, admitted(t, db, account, south), "the lifted block admits no more")

		var westBlock int64
		require.NoError(t, db.NewRaw(`SELECT min(id) FROM workforce.staff_pool_blocks WHERE school_id = ? AND lifted_at IS NULL`, west).Scan(t.Context(), &westBlock))
		rec = traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("/traeger/staff-pool/blocks/%d", westBlock), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 1, springerAtSchool(t, db, west, account, int64(record)).Windows, "the Personalverwaltung's lift closes the window at the school")
	})

	t.Run("another role at the school admits without a window", func(t *testing.T) {
		grant := func(name string) {
			_, err := db.ExecContext(t.Context(), `INSERT INTO auth.account_roles (account_id, role_id, tenant_id)
				SELECT ?, id, ? FROM auth.roles WHERE name = ? AND tenant_id IS NULL`, account, west, name)
			require.NoError(t, err)
		}
		require.False(t, admitted(t, db, account, west), "every window of the school lies ahead")
		grant("guardian")
		assert.False(t, admitted(t, db, account, west), "a parent role gives no staff access at the school")
		grant("user")
		assert.True(t, admitted(t, db, account, west), "an invitation's role admits however the mapping came")
	})
}
