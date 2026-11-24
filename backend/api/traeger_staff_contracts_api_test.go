// Router-level test for the Arbeitsverträge of the Personalstamm (#4706,
// ADR 0089 section 1): the Personalverwaltung enters a contract with its
// validity and the Soll Monday to Friday per Einsatzort, changes the Soll
// from a day on and enters the Ferien-Soll of holiday weeks. The Soll
// reaches the time tracking of each school from its first open day on; a
// closed month stays as counted; the school reads the Soll and changes none
// of it; no role without the right and no other Träger reaches a contract.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type contractRecordBody struct {
	Contracts []struct {
		ID       wireID  `json:"id"`
		Kind     string  `json:"kind"`
		StartsOn string  `json:"starts_on"`
		EndsOn   *string `json:"ends_on"`
		Version  string  `json:"version"`
		Sites    []struct {
			SchoolID       wireID `json:"school_id"`
			SchoolName     string `json:"school_name"`
			ChangeableFrom string `json:"changeable_from"`
			Soll           []struct {
				ValidFrom      string `json:"valid_from"`
				WeekdayMinutes []int  `json:"weekday_minutes"`
			} `json:"soll"`
		} `json:"sites"`
		HolidayWeeks []struct {
			SchoolID  wireID `json:"school_id"`
			WeekStart string `json:"week_start"`
		} `json:"holiday_weeks"`
	} `json:"contracts"`
	Changes []struct {
		Kind  string `json:"kind"`
		Field string `json:"field"`
		Value string `json:"value"`
	} `json:"changes"`
}

type contractRefusal struct {
	Code    string         `json:"code"`
	Details map[string]any `json:"details"`
}

// scheduleVersion is one stored school schedule version, read as the
// time tracking reads it.
type scheduleVersion struct {
	ValidFrom  string  `bun:"valid_from"`
	ValidUntil *string `bun:"valid_until"`
	Minutes    []int   `bun:"minutes,array"`
}

func schoolSchedule(t *testing.T, db *bun.DB, schoolID, staffID int64) []scheduleVersion {
	t.Helper()
	var versions []scheduleVersion
	require.NoError(t, db.NewRaw(`SELECT valid_from::text, valid_until::text, array_agg(target_minutes ORDER BY day_of_week) AS minutes
		FROM config.staff_work_schedules WHERE tenant_id = ? AND staff_id = ? AND (valid_until IS NULL OR valid_until > valid_from)
		GROUP BY valid_from, valid_until ORDER BY valid_from`, schoolID, staffID).Scan(context.Background(), &versions))
	return versions
}

func TestTraegerStaffContractsCarryTheSollIntoEachSchool(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, portal, admin, unit, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	ctx := context.Background()
	// North counted the Soll of October already, with a schedule of its own.
	_, err := db.ExecContext(ctx, `INSERT INTO config.staff_work_schedules (tenant_id, staff_id, week_index, rotation_length, day_of_week, target_minutes, valid_from)
		SELECT ?, ?, 0, 1, day, 480, DATE '2026-09-01' FROM generate_series(0, 4) AS day`, north, miraNorth.ID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO active.staff_month_balance_snapshots (tenant_id, staff_id, year, month, closing_balance_minutes, carry_in_minutes,
		target_minutes, actual_minutes, credited_minutes, adjustment_minutes, closed_by) VALUES (?, ?, 2026, 10, 0, 0, 0, 0, 0, 0, ?)`, north, miraNorth.ID, miraNorth.ID)
	require.NoError(t, err)
	// South keeps a Sonderarbeitszeit of its own before Christmas.
	_, err = db.ExecContext(ctx, `INSERT INTO config.staff_target_overrides (tenant_id, staff_id, start_date, end_date, weekday_minutes)
		VALUES (?, ?, DATE '2026-12-21', DATE '2026-12-23', '{0,0,0,0,0}')`, south, miraSouth.ID)
	require.NoError(t, err)

	rec := traegerLink(t, router, office.token, map[string]any{
		"members": []map[string]string{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID)}, {"school_id": fmt.Sprint(south), "staff_id": fmt.Sprint(miraSouth.ID)}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	recordID := decode[staffRecordBody](t, rec).ID
	contracts := fmt.Sprintf("/traeger/staff-records/%d/contracts", recordID)
	var contractID int64

	t.Run("a contract carries its Soll into each school from the first open day on", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, contracts, map[string]any{
			"kind": "part_time", "starts_on": "2026-08-01",
			"sites": []map[string]any{
				{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID), "weekday_minutes": []int{300, 300, 300, 300, 0}},
				{"school_id": fmt.Sprint(south), "staff_id": fmt.Sprint(miraSouth.ID), "weekday_minutes": []int{0, 0, 0, 0, 240}},
			},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		body := decode[contractRecordBody](t, rec)
		require.Len(t, body.Contracts, 1)
		contractID = int64(body.Contracts[0].ID)
		require.Len(t, body.Contracts[0].Sites, 2)
		for _, site := range body.Contracts[0].Sites {
			assert.Equal(t, "2026-11-01", site.ChangeableFrom, "October is closed at north, and the current month is November")
		}
		assert.Equal(t, []scheduleVersion{
			{ValidFrom: "2026-09-01", ValidUntil: new("2026-11-01"), Minutes: []int{480, 480, 480, 480, 480}},
			{ValidFrom: "2026-11-01", Minutes: []int{300, 300, 300, 300, 0}},
		}, schoolSchedule(t, db, north, miraNorth.ID), "the closed past keeps the school's Soll, the open month takes the Träger's")
		assert.Equal(t, []scheduleVersion{{ValidFrom: "2026-11-01", Minutes: []int{0, 0, 0, 0, 240}}}, schoolSchedule(t, db, south, miraSouth.ID))
		assert.Equal(t, "added", body.Changes[0].Kind)
		assert.Equal(t, "Teilzeit ab 01.08.2026", body.Changes[0].Value)
	})

	t.Run("a change of the Soll cannot reach into a closed month", func(t *testing.T) {
		rec := traegerContractWrite(t, router, office.token, http.MethodPost, fmt.Sprintf("%s/%d/soll", contracts, contractID), recordID, contractID, map[string]any{
			"valid_from": "2026-10-15",
			"sites":      []map[string]any{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID), "weekday_minutes": []int{480, 480, 480, 480, 480}}},
		})
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		var refusal contractRefusal
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal))
		assert.Equal(t, "workforce.traeger_contract_month_closed", refusal.Code)
		assert.Equal(t, "01.11.2026", refusal.Details["day"])
		assert.Equal(t, "Träger Personal OGS Nord", refusal.Details["school"])
	})

	t.Run("a new Soll from a day on starts a new version", func(t *testing.T) {
		rec := traegerContractWrite(t, router, office.token, http.MethodPost, fmt.Sprintf("%s/%d/soll", contracts, contractID), recordID, contractID, map[string]any{
			"valid_from": "2026-12-01",
			"sites":      []map[string]any{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID), "weekday_minutes": []int{480, 480, 480, 480, 480}}},
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		versions := schoolSchedule(t, db, north, miraNorth.ID)
		require.Len(t, versions, 3)
		assert.Equal(t, scheduleVersion{ValidFrom: "2026-11-01", ValidUntil: new("2026-12-01"), Minutes: []int{300, 300, 300, 300, 0}}, versions[1])
		assert.Equal(t, scheduleVersion{ValidFrom: "2026-12-01", Minutes: []int{480, 480, 480, 480, 480}}, versions[2])
		changes := decode[contractRecordBody](t, rec).Changes
		assert.Equal(t, "ab 01.12.2026: Mo–Fr je 8 Std. (40 Std. pro Woche)", changes[0].Value)
	})

	// ADR 0311: both dialogs save only over the contract they opened on;
	// the answer carries the new version for the next save.
	t.Run("a contract change refuses a contract changed since the dialog read it", func(t *testing.T) {
		stale := traegerContractVersion(t, router, office.token, recordID, contractID)
		rec := traegerContractWrite(t, router, office.token, http.MethodPost, fmt.Sprintf("%s/%d/soll", contracts, contractID), recordID, contractID, map[string]any{
			"valid_from": "2027-01-01",
			"sites":      []map[string]any{{"school_id": south, "staff_id": miraSouth.ID, "weekday_minutes": []int{0, 0, 0, 120, 240}}},
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		answered := decode[contractRecordBody](t, rec).Contracts[0].Version
		assert.Equal(t, traegerContractVersion(t, router, office.token, recordID, contractID), answered, "the answer carries the stored version")
		assert.NotEqual(t, stale, answered)
		schedule := schoolSchedule(t, db, south, miraSouth.ID)
		for _, version := range []string{stale, ""} {
			rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("%s/%d/soll", contracts, contractID), map[string]any{
				"valid_from": "2027-01-01", "expected_version": version,
				"sites": []map[string]any{{"school_id": south, "staff_id": miraSouth.ID, "weekday_minutes": []int{0, 0, 0, 0, 240}}},
			})
			assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
			rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("%s/%d", contracts, contractID), map[string]any{
				"kind": "minijob", "expected_version": version,
			})
			assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
		}
		assert.Equal(t, schedule, schoolSchedule(t, db, south, miraSouth.ID), "the colleague's Soll stays")
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_contracts WHERE id = ? AND kind = 'part_time' AND ends_on IS NULL`, contractID))
		assert.Equal(t, answered, traegerContractVersion(t, router, office.token, recordID, contractID), "a refusal writes nothing")
	})

	t.Run("holiday weeks become Sonderarbeitszeiten, never over the school's own", func(t *testing.T) {
		weeks := fmt.Sprintf("%s/%d/holiday-weeks", contracts, contractID)
		rec := traegerJSON(t, router, office.token, http.MethodPost, weeks, map[string]any{
			"school_id": fmt.Sprint(south), "staff_id": fmt.Sprint(miraSouth.ID), "from_week": "2026-12-21", "to_week": "2026-12-21", "weekday_minutes": []int{240, 240, 240, 0, 0},
		})
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		assert.Equal(t, "workforce.traeger_holiday_week_school_override", refusalOf(t, rec).Code)

		rec = traegerJSON(t, router, office.token, http.MethodPost, weeks, map[string]any{
			"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID), "from_week": "2026-12-21", "to_week": "2026-12-28", "weekday_minutes": []int{360, 360, 360, 0, 0},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.Len(t, decode[contractRecordBody](t, rec).Contracts[0].HolidayWeeks, 2)
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM config.staff_target_overrides
			WHERE tenant_id = ? AND staff_id = ? AND traeger_contract_id = ? AND weekday_minutes = '{360,360,360,0,0}'`, north, miraNorth.ID, contractID))

		// A week added by mistake goes again; the other weeks stay.
		rec = traegerJSON(t, router, office.token, http.MethodPost, weeks, map[string]any{
			"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID), "from_week": "2026-12-14", "to_week": "2026-12-14", "weekday_minutes": []int{120, 0, 0, 0, 0},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		require.Len(t, decode[contractRecordBody](t, rec).Contracts[0].HolidayWeeks, 3)
		rec = traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("%s/%d/2026-12-14", weeks, north), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		kept := decode[contractRecordBody](t, rec).Contracts[0].HolidayWeeks
		require.Len(t, kept, 2)
		assert.NotContains(t, []string{kept[0].WeekStart, kept[1].WeekStart}, "2026-12-14")
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM config.staff_target_overrides
			WHERE tenant_id = ? AND staff_id = ? AND traeger_contract_id = ? AND weekday_minutes = '{120,0,0,0,0}'`, north, miraNorth.ID, contractID))
	})

	t.Run("the school reads the Soll of the Träger and changes none of it", func(t *testing.T) {
		keptIn := func(schoolID, staffID int64) bool {
			school, err := tenant.NewTenantID(schoolID)
			require.NoError(t, err)
			var kept bool
			require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, schoolID), school, func(ctx context.Context) error {
				var err error
				kept, err = admin.StaffSollKeptByTraeger(ctx, staffID)
				return err
			}))
			return kept
		}
		assert.True(t, keptIn(north, miraNorth.ID))
		assert.True(t, keptIn(south, miraSouth.ID))
		other := testpkg.CreateTestStaffForTenant(t, db, north, "Jonas", "Keller")
		assert.False(t, keptIn(north, other.ID), "a person without a contract keeps the school's own Soll")
		assert.False(t, keptIn(south, miraNorth.ID), "a school reads no Soll of another school's employment")
		// The schedule read of the school tells it in the same statement.
		workTime := owners.MustNewWorkforce(testpkg.NewDatabase(t, db))
		school, err := tenant.NewTenantID(north)
		require.NoError(t, err)
		require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, north), school, func(ctx context.Context) error {
			rows, err := workTime.CurrentStaffSchedule(ctx, miraNorth.ID)
			require.NotEmpty(t, rows)
			assert.True(t, rows[0].KeptByTraeger)
			return err
		}))
	})

	t.Run("an end drops the later holiday weeks and ends the Soll", func(t *testing.T) {
		rec := traegerContractWrite(t, router, office.token, http.MethodPut, fmt.Sprintf("%s/%d", contracts, contractID), recordID, contractID, map[string]any{
			"kind": "part_time", "ends_on": "2026-12-31",
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[contractRecordBody](t, rec)
		assert.Equal(t, "2026-12-31", *body.Contracts[0].EndsOn)
		assert.Len(t, body.Contracts[0].HolidayWeeks, 1, "the week of 28.12. runs past the end")
		versions := schoolSchedule(t, db, north, miraNorth.ID)
		assert.Equal(t, new("2027-01-01"), versions[len(versions)-1].ValidUntil)
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM config.staff_target_overrides WHERE tenant_id = ? AND staff_id = ? AND traeger_contract_id IS NOT NULL`,
			north, miraNorth.ID))
	})

	t.Run("the Soll is kept up to the end day of the owner's clock", func(t *testing.T) {
		// ends_on is a day the Personalverwaltung sets, so the school day of
		// the owner's clock decides, not the database clock (#7295): one of
		// the two days lies on the other side of the end from the database's.
		_, err := db.ExecContext(ctx, `INSERT INTO config.staff_work_schedules (tenant_id, staff_id, week_index, rotation_length, day_of_week, target_minutes, valid_from)
			SELECT ?, ?, 0, 1, day, 240, DATE '2027-01-01' FROM generate_series(0, 4) AS day`, north, miraNorth.ID)
		require.NoError(t, err)
		school, err := tenant.NewTenantID(north)
		require.NoError(t, err)
		for day, kept := range map[time.Time]bool{
			time.Date(2026, time.December, 31, 23, 30, 0, 0, calendar.Berlin): true,
			time.Date(2027, time.January, 1, 0, 30, 0, 0, calendar.Berlin):    false,
		} {
			workTime, err := owners.NewWorkforceWithClock(testpkg.NewDatabase(t, db), owners.MustNewSchoolMembership(testpkg.NewDatabase(t, db)), func() time.Time { return day })
			require.NoError(t, err)
			require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, north), school, func(ctx context.Context) error {
				rows, err := workTime.CurrentStaffSchedule(ctx, miraNorth.ID)
				require.NotEmpty(t, rows)
				assert.Equal(t, kept, rows[0].KeptByTraeger, day)
				return err
			}))
		}
	})

	t.Run("a contract that ran is ended, not deleted", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("%s/%d", contracts, contractID), nil)
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		assert.Equal(t, "workforce.traeger_contract_month_closed", refusalOf(t, rec).Code)
	})

	t.Run("no role without the right and no other Träger reaches a contract", func(t *testing.T) {
		readOnly := newTraegerOffice(t, db, portal, "Träger Lesen", identityaccess.TraegerRoleReadOnly)
		rec := traegerJSON(t, router, readOnly.token, http.MethodPost, contracts, map[string]any{"kind": "part_time", "starts_on": "2026-12-01"})
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		other := newTraegerOffice(t, db, portal, "Träger Anders", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec = traegerJSON(t, router, other.token, http.MethodPut, fmt.Sprintf("%s/%d", contracts, contractID), map[string]any{"kind": "minijob"})
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_contracts WHERE id = ? AND kind = 'part_time'`, contractID))
	})

	t.Run("every record view is in the access log of each Einsatzort", func(t *testing.T) {
		entries := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		assert.Positive(t, entries[north])
		assert.Positive(t, entries[south])
	})
}

// TestTraegerStaffContractKeepsTheTemplateAndGivesItBack pins two edges of
// the mirror (ADR 0237): an employment that stands only on a work-time
// template keeps that template's Soll before the contract, and deleting a
// contract that never counted gives the school its own Soll back.
func TestTraegerStaffContractKeepsTheTemplateAndGivesItBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, _, admin, unit, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north := office.schools[0]
	staffRelease(t, db, office.organization)
	lea := testpkg.CreateTestStaffForTenant(t, db, north, "Lea", "Vorlage")
	ctx := context.Background()
	var modelID int64
	require.NoError(t, db.NewRaw(`INSERT INTO config.work_time_models (tenant_id, name, rotation_length, rotation_anchor_date)
		VALUES (?, 'Teilzeit 20', 1, DATE '2026-01-05') RETURNING id`, north).Scan(ctx, &modelID))
	testpkg.OwnTestWorkTimeModel(t, db, modelID)
	_, err := db.ExecContext(ctx, `INSERT INTO config.work_time_model_entries (model_id, week_index, day_of_week, target_minutes)
		SELECT ?, 0, day, 240 FROM generate_series(0, 4) AS day`, modelID)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `UPDATE users.staff_employment_profiles SET work_time_model_id = ? WHERE tenant_id = ? AND membership_id = ?`, modelID, north, lea.ID)
	require.NoError(t, err)

	rec := traegerLink(t, router, office.token, map[string]any{
		"members": []map[string]string{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(lea.ID)}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	contracts := fmt.Sprintf("/traeger/staff-records/%d/contracts", decode[staffRecordBody](t, rec).ID)
	rec = traegerJSON(t, router, office.token, http.MethodPost, contracts, map[string]any{
		"kind": "minijob", "starts_on": "2026-12-01",
		"sites": []map[string]any{{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(lea.ID), "weekday_minutes": []int{120, 0, 120, 0, 120}}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	contractID := decode[contractRecordBody](t, rec).Contracts[0].ID
	assert.Equal(t, []scheduleVersion{
		{ValidFrom: "2000-01-01", ValidUntil: new("2026-12-01"), Minutes: []int{240, 240, 240, 240, 240}},
		{ValidFrom: "2026-12-01", Minutes: []int{120, 0, 120, 0, 120}},
	}, schoolSchedule(t, db, north, lea.ID), "the template keeps counting until the contract starts")

	keptIn := func() bool {
		school, err := tenant.NewTenantID(north)
		require.NoError(t, err)
		var kept bool
		require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, north), school, func(ctx context.Context) error {
			kept, err = admin.StaffSollKeptByTraeger(ctx, lea.ID)
			return err
		}))
		return kept
	}
	assert.True(t, keptIn(), "a contract that starts later already holds the Soll it wrote")

	rec = traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("%s/%d", contracts, contractID), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "unsynced_schools")
	assert.Equal(t, []scheduleVersion{
		{ValidFrom: "2000-01-01", Minutes: []int{240, 240, 240, 240, 240}},
	}, schoolSchedule(t, db, north, lea.ID), "the school gets its own Soll back")
	assert.False(t, keptIn())
}
