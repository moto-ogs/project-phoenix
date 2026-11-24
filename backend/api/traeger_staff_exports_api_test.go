// Router-level test for the exports of the Personalverwaltung (#4712, ADR
// 0089 section 11, ADR 0250): the DATEV payroll file over all schools books
// each kind of contract with its own Lohnarten, so a part-time contract and
// an Übungsleiter contract of one person stay apart; it waits for a missing
// Personalnummer. The time export lists one row per person, day and
// Einsatzort. No role without the right and no other Träger reaches the
// data, and every read is in the access log of each school.
package api

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

var updateTraegerExportGolden = flag.Bool("update-traeger-export-golden", false, "rewrite the golden files of the Träger exports")

type payrollReportBody struct {
	Contracts     int  `json:"contracts"`
	People        int  `json:"people"`
	Schools       int  `json:"schools"`
	LineCount     int  `json:"line_count"`
	Ready         bool `json:"ready"`
	MissingClient bool `json:"missing_client"`
	NoWageType    bool `json:"no_wage_type"`
	Kinds         []struct {
		Kind      string `json:"kind"`
		Contracts int    `json:"contracts"`
		Lines     int    `json:"lines"`
	} `json:"kinds"`
	WithoutNumber []struct {
		LastName string `json:"last_name"`
	} `json:"without_number"`
	Unconfigured []workforce.TraegerPayrollGap `json:"unconfigured"`
	OpenSchools  []string                      `json:"open_schools"`
}

type timeReportBody struct {
	People        int `json:"people"`
	Schools       int `json:"schools"`
	Rows          int `json:"rows"`
	WithoutNumber []struct {
		LastName string `json:"last_name"`
	} `json:"without_number"`
}

func TestTraegerStaffExportsBookEveryKindOverAllSchools(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, portal, _, _, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)
	ctx := context.Background()

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	jonas := testpkg.CreateTestStaffForTenant(t, db, north, "Jonas", "Keller")
	// October in UTC: Mira works a morning in the north and two blocks with
	// a gap of 30 minutes in the south, Jonas a morning in the north and is
	// on holiday for two days.
	for _, session := range []struct {
		school, staff int64
		day, in, out  string
	}{
		{north, miraNorth.ID, "2026-10-05", "2026-10-05T06:00:00Z", "2026-10-05T10:00:00Z"},
		{south, miraSouth.ID, "2026-10-06", "2026-10-06T12:00:00Z", "2026-10-06T13:00:00Z"},
		{south, miraSouth.ID, "2026-10-06", "2026-10-06T13:30:00Z", "2026-10-06T14:30:00Z"},
		{north, jonas.ID, "2026-10-07", "2026-10-07T05:00:00Z", "2026-10-07T07:00:00Z"},
	} {
		_, err := db.ExecContext(ctx, `INSERT INTO active.work_sessions (tenant_id, staff_id, date, check_in_time, check_out_time, created_by)
			VALUES (?, ?, ?, ?, ?, ?)`, session.school, session.staff, session.day, session.in, session.out, session.staff)
		require.NoError(t, err)
	}
	// The contract mirrors its Soll from the running month on; October
	// keeps the schedule the school had: two hours a day for Jonas.
	_, err := db.ExecContext(ctx, `INSERT INTO config.staff_work_schedules (tenant_id, staff_id, week_index, rotation_length, day_of_week, target_minutes, valid_from)
		SELECT ?, ?, 0, 1, day, 120, DATE '2026-09-01' FROM generate_series(0, 4) AS day`, north, jonas.ID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO active.staff_absences (tenant_id, staff_id, absence_type, date_start, date_end, status, created_by, requested_at)
		VALUES (?, ?, ?, '2026-10-12', '2026-10-13', 'approved', ?, NOW())`, north, jonas.ID, workforce.AbsenceTypeVacation, jonas.ID)
	require.NoError(t, err)

	mira := linkStaffRecord(t, router, office, map[int64]int64{north: miraNorth.ID, south: miraSouth.ID})
	jonasRecord := linkStaffRecord(t, router, office, map[int64]int64{north: jonas.ID})
	setPersonnelNumber(t, router, office, mira, "00417")
	// Mira has no Soll, so each worked minute is a plus.
	addContract(t, router, office, mira, "part_time", north, miraNorth.ID, 0)
	addContract(t, router, office, mira, workforce.TraegerContractKindUebungsleiter, south, miraSouth.ID, 0)
	addContract(t, router, office, jonasRecord, "minijob", north, jonas.ID, 120)

	payroll := "/traeger/staff-exports/payroll?year=2026&month=10&format=" + workforce.TraegerPayrollFormatLodas

	t.Run("without Lohnarten the file names what is missing", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, payroll, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[payrollReportBody](t, rec)
		assert.False(t, body.Ready)
		assert.True(t, body.NoWageType)
		assert.True(t, body.MissingClient)
		assert.Equal(t, 2, body.Contracts, "the contracts of Mira; Jonas waits for his Personalnummer")
		require.Len(t, body.WithoutNumber, 1)
		assert.Equal(t, "Keller", body.WithoutNumber[0].LastName)
		rec = traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll/export?year=2026&month=10&format=datev_lodas", nil)
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_payroll_not_ready")
	})

	setTraegerPayrollValues(t, db, office.organization, map[string]string{
		configModels.KeyTraegerPayrollConsultantNumber:                                           "29098",
		configModels.KeyTraegerPayrollClientNumber:                                               "55003",
		configModels.TraegerPayrollWageTypeKey(workforce.TraegerPayrollRegular, "part_time"):     "100",
		configModels.TraegerPayrollWageTypeKey(workforce.TraegerPayrollRegular, "minijob"):       "200",
		configModels.TraegerPayrollWageTypeKey(workforce.TraegerPayrollRegular, "uebungsleiter"): "300",
		configModels.TraegerPayrollWageTypeKey(workforce.TraegerPayrollVacation, "minijob"):      "210",
		configModels.TraegerPayrollUnitKey(workforce.TraegerPayrollVacation):                     workforce.TraegerPayrollUnitDays,
	})

	t.Run("a person without Personalnummer stops the file", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, payroll, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[payrollReportBody](t, rec)
		assert.False(t, body.Ready)
		assert.False(t, body.MissingClient)
		assert.False(t, body.NoWageType)
		require.Len(t, body.WithoutNumber, 1)
	})

	t.Run("the time report names a person without Personalnummer and logs the access", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/times?year=2026&month=10", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[timeReportBody](t, rec)
		require.Len(t, body.WithoutNumber, 1)
		assert.Equal(t, "Keller", body.WithoutNumber[0].LastName)
		var logged bool
		require.NoError(t, db.NewRaw(`SELECT EXISTS (SELECT 1 FROM audit.data_access_log WHERE tenant_id = ? AND actor_role = 'traeger'
			AND metadata->>'view' = ? AND metadata->'staff_ids' @> to_jsonb(?::bigint))`, north, workforce.TraegerStaffViewTimeReport, jonas.ID).Scan(ctx, &logged))
		assert.True(t, logged, "the report names Jonas, so his school logs the access")
	})

	setPersonnelNumber(t, router, office, jonasRecord, "00523")

	t.Run("the report counts every kind and names the values without Lohnart", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, payroll, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[payrollReportBody](t, rec)
		assert.True(t, body.Ready)
		assert.Equal(t, 3, body.Contracts)
		assert.Equal(t, 2, body.People)
		assert.Equal(t, 2, body.Schools)
		assert.Equal(t, 4, body.LineCount)
		require.Len(t, body.Kinds, 3)
		assert.Equal(t, "part_time", body.Kinds[0].Kind)
		assert.Equal(t, "minijob", body.Kinds[1].Kind)
		assert.Equal(t, 2, body.Kinds[1].Lines, "Regelarbeit and Urlaub")
		assert.Equal(t, "uebungsleiter", body.Kinds[2].Kind)
		// Without a Soll every worked minute is a plus, and no Lohnart books it.
		assert.Contains(t, body.Unconfigured, workforce.TraegerPayrollGap{Category: workforce.TraegerPayrollPlus, Kind: "part_time"})
		assert.ElementsMatch(t, []string{"Träger Personal OGS Nord", "Träger Personal OGS Süd"}, body.OpenSchools)
	})

	t.Run("the files match their golden files", func(t *testing.T) {
		for _, file := range []struct{ format, golden, contentType string }{
			{workforce.TraegerPayrollFormatLodas, "traeger_payroll_lodas.golden", "text/plain; charset=windows-1252"},
			{workforce.TraegerPayrollFormatLug, "traeger_payroll_lug.golden", "text/plain; charset=windows-1252"},
		} {
			rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll/export?year=2026&month=10&format="+file.format, nil)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.Equal(t, file.contentType, rec.Header().Get("Content-Type"))
			assert.Contains(t, rec.Header().Get("Content-Disposition"), "lohnexport_"+file.format+"_2026-10.txt")
			assertTraegerExportGolden(t, file.golden, rec.Body.Bytes())
		}
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/times/export?year=2026&month=10", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
		assertTraegerExportGolden(t, "traeger_time_export.golden", rec.Body.Bytes())
	})

	t.Run("the time report counts people, schools and rows", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/times?year=2026&month=10", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[timeReportBody](t, rec)
		assert.Equal(t, 2, body.People)
		assert.Equal(t, 2, body.Schools)
		assert.Equal(t, 5, body.Rows, "two days of Mira, one worked and two absent days of Jonas")
		assert.Empty(t, body.WithoutNumber)
	})

	t.Run("a person who left after the month stays in the file", func(t *testing.T) {
		_, err := db.ExecContext(ctx, `UPDATE users.staff_school_memberships SET deleted_at = NOW() WHERE id = ?`, jonas.ID)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := db.ExecContext(context.Background(), `UPDATE users.staff_school_memberships SET deleted_at = NULL WHERE id = ?`, jonas.ID)
			require.NoError(t, err)
		})
		rec := traegerJSON(t, router, office.token, http.MethodGet, payroll, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[payrollReportBody](t, rec)
		assert.Equal(t, 3, body.Contracts)
		assert.Equal(t, 4, body.LineCount, "the minijob of Jonas still books Regelarbeit and Urlaub")
	})

	t.Run("a month in the future or an unknown format is refused", func(t *testing.T) {
		assert.Equal(t, http.StatusBadRequest, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll?year=2026&month=12&format=datev_lodas", nil).Code)
		assert.Equal(t, http.StatusBadRequest, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/payroll?year=2026&month=10&format=csv", nil).Code)
		assert.Equal(t, http.StatusBadRequest, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-exports/times?year=x&month=10", nil).Code)
	})

	t.Run("the report stays flat in its query budget", func(t *testing.T) {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, payroll, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		querybudgets.AssertQueryBudget(t, "api.traeger.staff_payroll_export", counter.Measurement(counter.Selects("")))
	})

	t.Run("no role without the right and no other Träger reaches the data", func(t *testing.T) {
		readOnly := newTraegerOffice(t, db, portal, "Träger Lesen", identityaccess.TraegerRoleReadOnly)
		for _, path := range []string{payroll, "/traeger/staff-exports/payroll/export?year=2026&month=10&format=datev_lug",
			"/traeger/staff-exports/times?year=2026&month=10", "/traeger/staff-exports/times/export?year=2026&month=10"} {
			assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, readOnly.token, http.MethodGet, path, nil).Code, path)
		}
		other := newTraegerOffice(t, db, portal, "Träger Anders", identityaccess.TraegerRolePersonnel)
		assertStaffRefusal(t, traegerJSON(t, router, other.token, http.MethodGet, payroll, nil), http.StatusConflict, "workforce.traeger_staff_not_released")
		staffRelease(t, db, other.organization)
		rec := traegerJSON(t, router, other.token, http.MethodGet, payroll, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Zero(t, decode[payrollReportBody](t, rec).Contracts)
		rec = traegerJSON(t, router, other.token, http.MethodGet, "/traeger/staff-exports/times?year=2026&month=10", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Zero(t, decode[timeReportBody](t, rec).Rows)
	})

	t.Run("every read and file is in the access log of each school", func(t *testing.T) {
		for _, view := range []string{
			workforce.TraegerStaffViewPayrollReport, workforce.TraegerStaffViewPayrollExport,
			workforce.TraegerStaffViewTimeReport, workforce.TraegerStaffViewTimeExport,
		} {
			var tenants []int64
			require.NoError(t, db.NewRaw(`SELECT DISTINCT tenant_id FROM audit.data_access_log WHERE actor_role = 'traeger'
				AND metadata->>'view' = ? AND (metadata->>'organization_id')::bigint = ? ORDER BY tenant_id`, view, office.organization).Scan(ctx, &tenants))
			assert.ElementsMatch(t, []int64{north, south}, tenants, view)
		}
	})
}

func linkStaffRecord(t *testing.T, router http.Handler, office traegerOffice, members map[int64]int64) int64 {
	t.Helper()
	var list []map[string]string
	for school, staff := range members {
		list = append(list, map[string]string{"school_id": fmt.Sprint(school), "staff_id": fmt.Sprint(staff)})
	}
	rec := traegerLink(t, router, office.token, map[string]any{"members": list})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return int64(decode[staffRecordBody](t, rec).ID)
}

func setPersonnelNumber(t *testing.T, router http.Handler, office traegerOffice, recordID int64, number string) {
	t.Helper()
	rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/personnel-number", recordID), map[string]any{"personnel_number": number})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func addContract(t *testing.T, router http.Handler, office traegerOffice, recordID int64, kind string, school, staff int64, daily int) {
	t.Helper()
	rec := traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/contracts", recordID), map[string]any{
		"kind": kind, "starts_on": "2026-08-01",
		"sites": []map[string]any{{"school_id": fmt.Sprint(school), "staff_id": fmt.Sprint(staff), "weekday_minutes": []int{daily, daily, daily, daily, daily}}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
}

// setTraegerPayrollValues stores Träger values as the settings page does.
func setTraegerPayrollValues(t *testing.T, db *bun.DB, organization int64, values map[string]string) {
	t.Helper()
	for key, value := range values {
		_, err := db.ExecContext(context.Background(), `INSERT INTO config.traeger_setting_values (organization_id, setting_key, value)
			VALUES (?, ?, to_jsonb(?::text))`, organization, key, value)
		require.NoError(t, err)
	}
}

func assertTraegerExportGolden(t *testing.T, name string, got []byte) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if *updateTraegerExportGolden {
		require.NoError(t, os.WriteFile(path, got, 0o600))
	}
	want, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, string(want), string(got), name)
}
