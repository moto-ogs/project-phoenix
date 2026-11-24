// Router-level test for the Vertretungspool of the Träger (#4709, ADR 0089
// section 9, ADR 0252): an Arbeitsvertrag with the Merkmal
// „Vertretungspool“ makes its person a Springer. Every school of the Träger
// sees the Springer with name, status of the Nachweise and blocked times,
// blocks them, and sees which other school holds a block. Two live blocks
// never overlap, also when two schools block at the same moment. The
// Personalverwaltung sees every block and lifts one. A role without the
// right gets 403, no school or Träger reaches another Träger's pool, and
// every read is in the access log.
package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/driver/pgdriver"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type poolWeekBody struct {
	WeekStart string            `json:"week_start"`
	Available bool              `json:"available"`
	Springers []json.RawMessage `json:"springers"`
}

type poolSpringerBody struct {
	RecordID  wireID  `json:"staff_record_id"`
	LastName  string  `json:"last_name"`
	PoolFrom  string  `json:"pool_from"`
	PoolUntil *string `json:"pool_until"`
	Proofs    []struct {
		TypeName string `json:"type_name"`
		Status   string `json:"status"`
	} `json:"proofs"`
	Blocks []struct {
		ID         *wireID `json:"id"`
		SchoolID   wireID  `json:"school_id"`
		SchoolName string  `json:"school_name"`
		Own        bool    `json:"own"`
		Date       string  `json:"date"`
		StartTime  string  `json:"start_time"`
		EndTime    string  `json:"end_time"`
		Lifted     bool    `json:"lifted"`
	} `json:"blocks"`
}

// poolSchoolRequest calls the school's pool as a staff member of schoolID
// with the given permissions.
func poolSchoolRequest(t *testing.T, router http.Handler, schoolID, accountID int64, perms []string, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.ID, claims.TenantID, claims.IsAdmin, claims.Permissions = int(accountID), schoolID, false, perms
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequest(method, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, claims))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func poolSpringers(t *testing.T, rec *httptest.ResponseRecorder) (poolWeekBody, []poolSpringerBody) {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	week := decode[poolWeekBody](t, rec)
	springers := make([]poolSpringerBody, 0, len(week.Springers))
	for _, raw := range week.Springers {
		var springer poolSpringerBody
		require.NoError(t, json.Unmarshal(raw, &springer))
		springers = append(springers, springer)
	}
	return week, springers
}

func TestStaffPoolLetsEverySchoolBlockASpringerOnce(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, portal, _, _, office, schoolRoutes := newTraegerStaffFixtureWith(t, db, func() time.Time { return today }, &StaffPlanningTestRules{})
	school := testpkg.TenantRuntimeMiddleware(t, db)(schoolRoutes)
	north, south := office.schools[0], office.schools[1]
	west := testpkg.CreateTestSchoolInOrganization(t, db, office.organization, "Träger Personal OGS West")
	staffRelease(t, db, office.organization)
	manage := []string{permissions.TimeTrackingManage}

	mira := testpkg.CreateTestStaffForTenant(t, db, north, "Mira", "Springer")
	jonas := testpkg.CreateTestStaffForTenant(t, db, north, "Jonas", "Fest")
	_, southLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, south, "Sina", "Süd")
	_, westLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, west, "Wim", "West")
	record := func(staffID int64, pool bool) int64 {
		rec := traegerLink(t, router, office.token, map[string]any{
			"members": []map[string]string{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(staffID)}},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		id := decode[staffRecordBody](t, rec).ID
		rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/contracts", id), map[string]any{
			"kind": "part_time", "starts_on": "2026-08-01", "pool": pool,
			"sites": []map[string]any{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(staffID), "weekday_minutes": []int{300, 300, 300, 300, 300}}},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.Contains(t, rec.Body.String(), fmt.Sprintf(`"pool":%t`, pool))
		return int64(id)
	}
	springer, fixed := record(mira.ID, true), record(jonas.ID, false)

	week := "/api/staff-pool/?week=2026-11-16"
	block := func(schoolID, accountID int64, recordID int64, date, start, end string) *httptest.ResponseRecorder {
		return poolSchoolRequest(t, school, schoolID, accountID, manage, http.MethodPost, "/api/staff-pool/blocks", map[string]any{
			"staff_record_id": fmt.Sprint(recordID), "date": date, "start_time": start, "end_time": end,
		})
	}

	t.Run("a school sees only the Springer with name, Nachweise and blocks", func(t *testing.T) {
		body, springers := poolSpringers(t, poolSchoolRequest(t, school, south, southLead.ID, manage, http.MethodGet, week, nil))
		assert.True(t, body.Available)
		assert.Equal(t, "2026-11-16", body.WeekStart)
		require.Len(t, springers, 1, "a contract without the Merkmal is no Springer")
		assert.Equal(t, springer, int64(springers[0].RecordID))
		assert.Equal(t, "2026-08-01", springers[0].PoolFrom)
		require.NotEmpty(t, springers[0].Proofs, "the standard Nachweise of the Träger are mandatory")
		for _, proof := range springers[0].Proofs {
			assert.Equal(t, "missing", proof.Status, proof.TypeName)
		}
		var fields map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(body.Springers[0], &fields))
		keys := make([]string, 0, len(fields))
		for key := range fields {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		assert.Equal(t, []string{"blocks", "first_name", "last_name", "pool_from", "pool_until", "proofs", "staff_record_id"}, keys,
			"no birthday, personnel number, contract, Soll or Einsatzort leaves to the school")
	})

	var southBlock int64
	t.Run("two schools never block the same hours", func(t *testing.T) {
		rec := block(south, southLead.ID, springer, "2026-11-19", "08:00", "12:00")
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		created := decode[struct {
			ID  *wireID `json:"id"`
			Own bool    `json:"own"`
		}](t, rec)
		require.NotNil(t, created.ID)
		assert.True(t, created.Own)
		southBlock = int64(*created.ID)

		assertStaffRefusal(t, block(west, westLead.ID, springer, "2026-11-19", "11:00", "14:00"), http.StatusConflict, "workforce.pool_block_taken")
		require.Equal(t, http.StatusCreated, block(west, westLead.ID, springer, "2026-11-19", "12:00", "14:00").Code, "a block may start when another ends")

		_, springers := poolSpringers(t, poolSchoolRequest(t, school, west, westLead.ID, manage, http.MethodGet, week, nil))
		require.Len(t, springers[0].Blocks, 2)
		other, own := springers[0].Blocks[0], springers[0].Blocks[1]
		assert.Nil(t, other.ID, "another school's block carries no id")
		assert.False(t, other.Own)
		assert.Equal(t, "Träger Personal OGS Süd", other.SchoolName)
		assert.Equal(t, [3]string{"2026-11-19", "08:00", "12:00"}, [3]string{other.Date, other.StartTime, other.EndTime})
		assert.True(t, own.Own)
		require.NotNil(t, own.ID)
		assert.Equal(t, http.StatusNotFound, poolSchoolRequest(t, school, west, westLead.ID, manage, http.MethodDelete,
			fmt.Sprintf("/api/staff-pool/blocks/%d", southBlock), nil).Code, "a school lifts only its own blocks")
	})

	t.Run("a block needs a Springer, a day from today and an end after the start", func(t *testing.T) {
		assertStaffRefusal(t, block(south, southLead.ID, fixed, "2026-11-20", "08:00", "12:00"), http.StatusNotFound, "workforce.pool_springer_not_found")
		assertStaffRefusal(t, block(south, southLead.ID, springer, "2026-11-17", "08:00", "12:00"), http.StatusBadRequest, "workforce.pool_block_invalid")
		assertStaffRefusal(t, block(south, southLead.ID, springer, "2026-11-20", "12:00", "08:00"), http.StatusBadRequest, "workforce.pool_block_invalid")
		assertStaffRefusal(t, block(south, southLead.ID, springer, "2026-11-21", "08:00", "12:00"), http.StatusBadRequest, "workforce.pool_block_invalid")
		assertStaffRefusal(t, block(south, southLead.ID, springer, "20.11.2026", "08:00", "12:00"), http.StatusBadRequest, "workforce.pool_block_invalid")
	})

	t.Run("a school cannot block a Springer during a shift at an Einsatzort", func(t *testing.T) {
		_, northLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Nora", "Nord")
		rec := schoolShift(t, school, north, northLead.ID, map[string]any{
			"staff_id": fmt.Sprint(mira.ID), "date": "2026-11-26", "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assertStaffRefusal(t, block(south, southLead.ID, springer, "2026-11-26", "11:00", "13:00"), http.StatusConflict, "workforce.pool_springer_busy")
		require.Equal(t, http.StatusCreated, block(south, southLead.ID, springer, "2026-11-26", "12:00", "13:00").Code,
			"a block may start when the shift ends")
	})

	t.Run("the Personalverwaltung sees every block, lifts one and the school sees it", func(t *testing.T) {
		before := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-pool/?week=2026-11-16", nil)
		_, springers := poolSpringers(t, rec)
		require.Len(t, springers, 1)
		require.Len(t, springers[0].Blocks, 2)
		assert.Equal(t, "Träger Personal OGS Süd", springers[0].Blocks[0].SchoolName)
		after := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		for _, schoolID := range []int64{north, south, west} {
			assert.Equal(t, before[schoolID]+1, after[schoolID], "the Einsatzort and each blocking school log the read: school %d", schoolID)
		}

		// #4718: the week's blocks download as PDF, Excel or CSV, logged at
		// the same schools as an export.
		rec = traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-pool/export?week=2026-11-16", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
		lines := strings.Split(strings.TrimSpace(strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")), "\n")
		require.Len(t, lines, 3, rec.Body.String())
		assert.Equal(t, "Nachname;Vorname;Tag;Beginn;Ende;Schule", strings.TrimSpace(lines[0]))
		assert.Equal(t, "Springer;Mira;19.11.2026;08:00;12:00;Träger Personal OGS Süd", strings.TrimSpace(lines[1]))
		assert.Equal(t, "Springer;Mira;19.11.2026;12:00;14:00;Träger Personal OGS West", strings.TrimSpace(lines[2]))
		assertTraegerListFormats(t, router, office.token, "/traeger/staff-pool/export?week=2026-11-16", "vertretungspool-2026-11-16")
		exported := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		for _, schoolID := range []int64{north, south, west} {
			assert.Equal(t, after[schoolID]+3, exported[schoolID], "CSV, PDF and Excel are logged at school %d", schoolID)
		}
		assert.Equal(t, 3, staffSchoolValue(t, db, `SELECT COUNT(*) FROM audit.data_access_log WHERE tenant_id = ? AND actor_role = 'traeger'
			AND metadata->>'view' = 'staff_pool_export'`, south), "the access log names the download")

		rec = traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("/traeger/staff-pool/blocks/%d", southBlock), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM audit.data_access_log WHERE tenant_id = ? AND actor_role = 'traeger'
			AND metadata->>'view' = 'staff_pool_lift' AND (metadata->>'staff_record_id')::bigint = ?`, south, springer),
			"the school's access log names the lift of its block")
		assertStaffRefusal(t, traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("/traeger/staff-pool/blocks/%d", southBlock), nil),
			http.StatusNotFound, "workforce.pool_block_not_found")
		_, springers = poolSpringers(t, poolSchoolRequest(t, school, south, southLead.ID, manage, http.MethodGet, week, nil))
		require.Len(t, springers[0].Blocks, 2)
		assert.True(t, springers[0].Blocks[0].Own)
		assert.True(t, springers[0].Blocks[0].Lifted, "the school sees that the Personalverwaltung lifted its block")
		require.Equal(t, http.StatusCreated, block(west, westLead.ID, springer, "2026-11-19", "08:00", "12:00").Code, "the lifted hours are free again")
		assert.Positive(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM audit.data_access_log WHERE tenant_id = ? AND resource_type = 'traeger_staff_pool'
			AND actor_account_id = ? AND metadata->'staff_record_ids' @> ?::jsonb`, south, southLead.ID, fmt.Sprintf("[%d]", springer)),
			"every read of the school is in its access log")
	})

	t.Run("no role without the right and no other Träger reaches the pool", func(t *testing.T) {
		assert.Equal(t, http.StatusForbidden, poolSchoolRequest(t, school, south, southLead.ID, []string{permissions.UsersRead}, http.MethodGet, week, nil).Code)
		assert.Equal(t, http.StatusForbidden, poolSchoolRequest(t, school, south, southLead.ID, []string{permissions.UsersRead}, http.MethodPost,
			"/api/staff-pool/blocks", map[string]any{"staff_record_id": fmt.Sprint(springer), "date": "2026-11-20", "start_time": "08:00", "end_time": "09:00"}).Code)
		billing := newTraegerOffice(t, db, portal, "Träger Abrechnung Pool", identityaccess.TraegerRoleBilling)
		assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, billing.token, http.MethodGet, "/traeger/staff-pool/", nil).Code)

		other := newTraegerOffice(t, db, portal, "Anderer Träger Pool", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		_, otherLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, other.schools[0], "Olaf", "Anders")
		body, springers := poolSpringers(t, poolSchoolRequest(t, school, other.schools[0], otherLead.ID, manage, http.MethodGet, week, nil))
		assert.True(t, body.Available)
		assert.Empty(t, springers, "a school sees only the Springer of its own Träger")
		assertStaffRefusal(t, block(other.schools[0], otherLead.ID, springer, "2026-11-20", "08:00", "12:00"), http.StatusNotFound, "workforce.pool_springer_not_found")
		_, springers = poolSpringers(t, traegerJSON(t, router, other.token, http.MethodGet, "/traeger/staff-pool/?week=2026-11-16", nil))
		assert.Empty(t, springers)
		assertStaffRefusal(t, traegerJSON(t, router, other.token, http.MethodDelete, fmt.Sprintf("/traeger/staff-pool/blocks/%d", southBlock+1), nil),
			http.StatusNotFound, "workforce.pool_block_not_found")

		unreleased := newTraegerOffice(t, db, portal, "Träger ohne Freigabe Pool", identityaccess.TraegerRolePersonnel)
		_, plainLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, unreleased.schools[0], "Pia", "Plain")
		body, _ = poolSpringers(t, poolSchoolRequest(t, school, unreleased.schools[0], plainLead.ID, manage, http.MethodGet, week, nil))
		assert.False(t, body.Available, "without „Personal beim Träger“ a school has no pool")
	})

	t.Run("two schools blocking at the same moment: the first wins, the second gets the overlap", func(t *testing.T) {
		ctx := context.Background()
		first, err := db.BeginTx(ctx, &sql.TxOptions{})
		require.NoError(t, err)
		defer func() { _ = first.Rollback() }()
		require.NoError(t, poolBlockInTx(ctx, first, south, southLead.ID, springer))

		second := make(chan error, 1)
		go func() {
			tx, err := db.BeginTx(ctx, &sql.TxOptions{})
			if err != nil {
				second <- err
				return
			}
			defer func() { _ = tx.Rollback() }()
			second <- poolBlockInTx(ctx, tx, west, westLead.ID, springer)
		}()
		select {
		case err := <-second:
			t.Fatalf("the second block must wait for the first transaction, got %v", err)
		case <-time.After(300 * time.Millisecond):
		}
		require.NoError(t, first.Commit())
		err = <-second
		pgErr, ok := errors.AsType[pgdriver.Error](err)
		require.True(t, ok, "the second block fails: %v", err)
		assert.Equal(t, "23P01", pgErr.Field('C'))
		assert.Equal(t, "ex_workforce_staff_pool_blocks_overlap", pgErr.Field('n'))
	})
}

// poolBlockInTx blocks the Springer on 23.11.2026 from 08:00 to 10:00 as
// schoolID, in a transaction of its own.
func poolBlockInTx(ctx context.Context, tx bun.Tx, schoolID, accountID, recordID int64) error {
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_tenant_id', ?, true)`, fmt.Sprint(schoolID)); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `SELECT workforce.pool_block(?, '2026-11-23', '08:00', '10:00', ?)`, recordID, accountID)
	return err
}

// TestStaffPoolWeekQueryBudget pins the statements of both pool views: flat
// in the number of Springer, blocks and Nachweise at a fixed set of schools.
func TestStaffPoolWeekQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, _, _, _, office, schoolRoutes := newTraegerStaffFixtureWith(t, db, func() time.Time { return today }, &StaffPlanningTestRules{})
	school := testpkg.TenantRuntimeMiddleware(t, db)(schoolRoutes)
	staffRelease(t, db, office.organization)
	north, south := office.schools[0], office.schools[1]
	_, southLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, south, "Sina", "Süd")
	springer := func(last, date string) {
		member := testpkg.CreateTestStaffForTenant(t, db, north, "Mira", last)
		rec := traegerLink(t, router, office.token, map[string]any{
			"members": []map[string]string{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(member.ID)}},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		id := decode[staffRecordBody](t, rec).ID
		rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/contracts", id), map[string]any{
			"kind": "minijob", "starts_on": "2026-08-01", "pool": true,
			"sites": []map[string]any{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(member.ID), "weekday_minutes": []int{120, 120, 120, 120, 120}}},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		rec = poolSchoolRequest(t, school, south, southLead.ID, []string{permissions.TimeTrackingManage}, http.MethodPost, "/api/staff-pool/blocks",
			map[string]any{"staff_record_id": fmt.Sprint(id), "date": date, "start_time": "08:00", "end_time": "12:00"})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	}
	measure := func(handler http.Handler, req *http.Request) testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, handler, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	readSchool := func() testpkg.QueryMeasurement {
		claims := testutil.DefaultTestClaims()
		claims.ID, claims.TenantID, claims.IsAdmin, claims.Permissions = int(southLead.ID), south, false, []string{permissions.TimeTrackingManage}
		req := httptest.NewRequest(http.MethodGet, "/api/staff-pool/?week=2026-11-23", nil)
		req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, claims))
		return measure(school, req)
	}
	readTraeger := func() testpkg.QueryMeasurement {
		req := httptest.NewRequest(http.MethodGet, "/traeger/staff-pool/?week=2026-11-23", nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		return measure(router, req)
	}
	exportTraeger := func() testpkg.QueryMeasurement {
		req := httptest.NewRequest(http.MethodGet, "/traeger/staff-pool/export?week=2026-11-23&format=csv", nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		return measure(router, req)
	}
	springer("Eins", "2026-11-23")
	fewSchool, fewTraeger, fewExport := readSchool(), readTraeger(), exportTraeger()
	springer("Zwei", "2026-11-24")
	springer("Drei", "2026-11-25")
	assert.Len(t, readSchool().Statements, len(fewSchool.Statements), "the school's week loads set-based")
	assert.Len(t, readTraeger().Statements, len(fewTraeger.Statements), "the Träger's week loads set-based")
	assert.Len(t, exportTraeger().Statements, len(fewExport.Statements), "the Träger's download loads set-based")
	querybudgets.AssertQueryBudget(t, "api.staff_pool.week", fewSchool)
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_pool_week", fewTraeger)
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_pool_export", fewExport)
}
