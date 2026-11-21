// Router-level test for „Person einstellen“ (#7206, ADR 0089 sections 1 and
// 3): the Personalverwaltung hires a person the schools do not know yet. One
// request creates the Personalstamm and the Arbeitsvertrag at the Träger and,
// at every Einsatzort, the person and the employment in that school's tenant
// transaction. A refused request leaves nothing behind; a person who may
// exist already is asked about first; no role without the right hires. A
// hire that fails at a later school says what it left behind.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

const staffHirePath = "/traeger/staff-records/hire"

// hiredPerson is what a school keeps of a hired person, read as the school
// reads it.
type hiredPerson struct {
	StaffID         int64   `bun:"staff_id"`
	FirstName       string  `bun:"first_name"`
	Birthday        *string `bun:"birthday"`
	AccountID       *int64  `bun:"account_id"`
	PersonnelNumber *string `bun:"personnel_number"`
	EmploymentType  *string `bun:"employment_type"`
	Email           *string `bun:"email"`
	Phone           *string `bun:"phone"`
	EntryDate       *string `bun:"entry_date"`
}

func hiredPeople(t *testing.T, db *bun.DB, schoolID int64, lastName string) []hiredPerson {
	t.Helper()
	var people []hiredPerson
	require.NoError(t, db.NewRaw(`SELECT m.id AS staff_id, p.first_name, p.birthday::text, p.account_id, e.personnel_number, e.employment_type,
			d.email, d.phone, d.entry_date::text
		FROM users.persons p
		JOIN users.staff_school_memberships m ON m.person_id = p.id AND m.tenant_id = p.tenant_id
		LEFT JOIN users.staff_employment_profiles e ON e.membership_id = m.id AND e.tenant_id = m.tenant_id
		LEFT JOIN users.staff_master_data d ON d.staff_id = m.id AND d.tenant_id = m.tenant_id
		WHERE p.tenant_id = ? AND p.last_name = ? ORDER BY m.id`, schoolID, lastName).Scan(context.Background(), &people))
	return people
}

func hireBody(lastName string, sites ...map[string]any) map[string]any {
	return map[string]any{
		"first_name": "Lena", "last_name": lastName, "birthday": "1990-04-12",
		"contract": map[string]any{"kind": "part_time", "starts_on": "2026-12-01"},
		"sites":    sites,
	}
}

func hireSite(schoolID int64, minutes ...int) map[string]any {
	return map[string]any{"school_id": schoolID, "weekday_minutes": minutes}
}

func TestTraegerStaffHireCreatesRecordContractAndEmployments(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, portal, _, _, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north, south := office.schools[0], office.schools[1]

	t.Run("without the release nobody is hired", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, hireBody("Vorfreigabe", hireSite(north, 240, 240, 240, 240, 240)))
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_not_released")
		assert.Empty(t, hiredPeople(t, db, north, "Vorfreigabe"))
	})
	staffRelease(t, db, office.organization)

	t.Run("one request creates the record, the contract and the employment at every Einsatzort", func(t *testing.T) {
		body := hireBody("Brandt", hireSite(north, 300, 300, 300, 300, 0), hireSite(south, 0, 0, 0, 0, 240))
		body["personnel_number"], body["email"], body["phone"] = "81001", " lena.brandt@example.org ", "0231 555 01"
		rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		record := decode[staffRecordBody](t, rec)
		assert.Equal(t, "Lena", record.FirstName)
		assert.Equal(t, "Brandt", record.LastName)
		require.NotNil(t, record.PersonnelNumber)
		assert.Equal(t, "81001", *record.PersonnelNumber)
		require.Len(t, record.Employments, 2)

		staffIDs := map[int64]int64{}
		for _, school := range []int64{north, south} {
			people := hiredPeople(t, db, school, "Brandt")
			require.Len(t, people, 1, "each Einsatzort gets one person and one employment")
			person := people[0]
			staffIDs[school] = person.StaffID
			assert.Equal(t, "Lena", person.FirstName)
			assert.Equal(t, new("1990-04-12"), person.Birthday)
			assert.Nil(t, person.AccountID, "access stays with the school")
			assert.Equal(t, new("81001"), person.PersonnelNumber, "the school reads the Träger's number")
			assert.Equal(t, new("part_time"), person.EmploymentType)
			assert.Equal(t, new("lena.brandt@example.org"), person.Email, "the school needs the address to invite the person")
			assert.Equal(t, new("0231 555 01"), person.Phone)
			assert.Equal(t, new("2026-12-01"), person.EntryDate)
		}
		for _, employment := range record.Employments {
			assert.Equal(t, staffIDs[int64(employment.SchoolID)], int64(employment.StaffID))
			assert.True(t, employment.Active)
		}

		contracts := decode[contractRecordBody](t, rec).Contracts
		require.Len(t, contracts, 1)
		assert.Equal(t, "part_time", contracts[0].Kind)
		assert.Equal(t, "2026-12-01", contracts[0].StartsOn)
		require.Len(t, contracts[0].Sites, 2)
		assert.Equal(t, []scheduleVersion{{ValidFrom: "2026-12-01", Minutes: []int{300, 300, 300, 300, 0}}}, schoolSchedule(t, db, north, staffIDs[north]),
			"the Soll reaches the time tracking of the school")
		assert.Equal(t, []scheduleVersion{{ValidFrom: "2026-12-01", Minutes: []int{0, 0, 0, 0, 240}}}, schoolSchedule(t, db, south, staffIDs[south]))

		kinds := map[string]int{}
		for _, change := range record.Changes {
			kinds[change.Kind+":"+change.Field]++
		}
		assert.Equal(t, map[string]int{"linked:school": 2, "added:contract": 1}, kinds, "the trail names both Einsatzorte and the contract")

		overview := decode[staffOverviewBody](t, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-records/", nil))
		assert.Len(t, overview.Records, 1)
		assert.Empty(t, overview.Suggestions, "a hired person is no open proposal")
	})

	t.Run("a refused request names its field and creates nobody", func(t *testing.T) {
		for name, tc := range map[string]struct {
			change func(map[string]any)
			status int
			code   string
			field  string
		}{
			"a last name is required":  {func(b map[string]any) { b["last_name"] = "  " }, http.StatusBadRequest, "workforce.traeger_staff_hire_invalid", "last_name"},
			"the birthday is a day":    {func(b map[string]any) { b["birthday"] = "12.04.1990" }, http.StatusBadRequest, "workforce.traeger_staff_hire_invalid", "birthday"},
			"the birthday is required": {func(b map[string]any) { delete(b, "birthday") }, http.StatusBadRequest, "workforce.traeger_staff_hire_invalid", "birthday"},
			"the address is an address": {func(b map[string]any) { b["email"] = "lena at example" }, http.StatusBadRequest,
				"workforce.traeger_staff_hire_invalid", "email"},
			"an Einsatzort is required": {func(b map[string]any) { b["sites"] = []map[string]any{} }, http.StatusBadRequest, "workforce.traeger_staff_hire_invalid", "sites"},
			"an Einsatzort is named once": {func(b map[string]any) {
				b["sites"] = []map[string]any{hireSite(north, 60, 60, 60, 60, 60), hireSite(north, 60, 60, 60, 60, 60)}
			}, http.StatusBadRequest, "workforce.traeger_staff_hire_invalid", "sites"},
			"the number has digits only": {func(b map[string]any) { b["personnel_number"] = "A-17" }, http.StatusBadRequest, "workforce.personnel_number_invalid", "personnel_number"},
			"the contract has a known kind": {func(b map[string]any) { b["contract"] = map[string]any{"kind": "freelance", "starts_on": "2026-12-01"} },
				http.StatusBadRequest, "workforce.traeger_contract_invalid", "kind"},
			"the contract ends after it starts": {func(b map[string]any) {
				b["contract"] = map[string]any{"kind": "minijob", "starts_on": "2026-12-01", "ends_on": "2026-11-01"}
			}, http.StatusBadRequest, "workforce.traeger_contract_invalid", "ends_on"},
			"a day has at most twelve hours": {func(b map[string]any) { b["sites"] = []map[string]any{hireSite(north, 900, 0, 0, 0, 0)} },
				http.StatusBadRequest, "workforce.traeger_contract_invalid", "sites"},
			"the number of another record is taken": {func(b map[string]any) { b["personnel_number"] = "81001" }, http.StatusConflict, "workforce.personnel_number_taken", ""},
		} {
			body := hireBody("Abgelehnt", hireSite(north, 240, 240, 240, 240, 240))
			tc.change(body)
			rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body)
			assertStaffRefusal(t, rec, tc.status, tc.code)
			if tc.field != "" {
				assert.Contains(t, rec.Body.String(), `"field":"`+tc.field+`"`, name)
			}
		}
		assert.Empty(t, hiredPeople(t, db, north, "Abgelehnt"), "a refused request creates no person")
		assert.Empty(t, hiredPeople(t, db, north, "  "))
	})

	t.Run("a school of another Träger is no Einsatzort", func(t *testing.T) {
		foreign := newTraegerOffice(t, db, portal, "Träger Fremd", identityaccess.TraegerRolePersonnel)
		rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, hireBody("Fremd", hireSite(foreign.schools[0], 240, 240, 240, 240, 240)))
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_staff_hire_invalid")
		assert.Empty(t, hiredPeople(t, db, foreign.schools[0], "Fremd"))
	})

	t.Run("a number an employment of the school holds is taken", func(t *testing.T) {
		other := testpkg.CreateTestStaffForTenant(t, db, south, "Jonas", "Keller")
		staffSetPersonnelNumber(t, db, south, other.ID, "81002")
		body := hireBody("Nummer", hireSite(south, 240, 240, 240, 240, 240))
		body["personnel_number"] = "81002"
		assertStaffRefusal(t, traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body), http.StatusConflict, "workforce.personnel_number_taken")
		assert.Empty(t, hiredPeople(t, db, south, "Nummer"))
	})

	t.Run("a person who may exist already is asked about first", func(t *testing.T) {
		// The record of Lena Brandt exists; the same name and birthday again.
		again := hireBody("Brandt", hireSite(north, 240, 240, 240, 240, 240))
		rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, again)
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_hire_duplicate")
		assert.Contains(t, rec.Body.String(), `"record"`)
		assert.Len(t, hiredPeople(t, db, north, "Brandt"), 1, "nobody is created before the answer")

		// A person of a school without a record, with the same name and birthday.
		existing := testpkg.CreateTestStaffForTenant(t, db, south, "Lena", "Okafor")
		_, err := db.ExecContext(context.Background(), `UPDATE users.persons SET birthday = DATE '1990-04-12' WHERE id = ?`, existing.PersonID)
		require.NoError(t, err)
		checks := func() int {
			return staffSchoolValue(t, db, `SELECT COUNT(*) FROM audit.data_access_log
				WHERE tenant_id = ? AND actor_role = 'traeger' AND metadata->>'view' = 'staff_hire_check'`, south)
		}
		require.Zero(t, checks())
		body := hireBody("okafor", hireSite(south, 240, 240, 240, 240, 240))
		rec = traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body)
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_hire_duplicate")
		assert.Contains(t, rec.Body.String(), `"school"`)
		assert.Contains(t, rec.Body.String(), "Träger Personal OGS Süd")
		assert.Equal(t, 1, checks(), "the school's access log names the person the check showed")

		// The Personalverwaltung confirms: these are two people.
		body["confirm_duplicate"] = true
		rec = traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.Len(t, hiredPeople(t, db, south, "okafor"), 1)
		assert.Equal(t, 1, checks(), "a confirmed hire shows nobody of the check and logs no further entry")
	})

	t.Run("the same name without a birthday or the same address is asked about too", func(t *testing.T) {
		// #7378: school staff often has no birthday, and a person under
		// „Ohne Akte“ may carry another spelling of the name but the address.
		ctx := context.Background()
		nameOnly := testpkg.CreateTestStaffForTenant(t, db, north, "Mira", "Yilmaz")
		byMasterData := testpkg.CreateTestStaffForTenant(t, db, south, "Mira", "Yilmaz-Berg")
		_, err := db.ExecContext(ctx, `INSERT INTO users.staff_master_data (tenant_id, staff_id, email) VALUES (?, ?, 'Mira.Y@Example.org')`, south, byMasterData.ID)
		require.NoError(t, err)
		byAccount, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, south, "Miriam", "Berg")
		testpkg.EnsureAccountTenant(t, db, account.ID, south)
		byInvitation := testpkg.CreateTestStaffForTenant(t, db, north, "M.", "Yilmaz")
		testpkg.InsertTestInvitationToken(t, db, &testpkg.InvitationTokenFixture{
			TenantID: north, Email: "invited." + account.Email, Token: "hire-check-" + strconv.FormatInt(byInvitation.ID, 10),
			RoleID: testpkg.GetOrCreateTestRole(t, db, "user").ID, ExpiresAt: today.Add(72 * time.Hour), PersonID: &byInvitation.PersonID,
		})
		body := func(email string) map[string]any {
			b := hireBody("Yilmaz", hireSite(north, 240, 240, 240, 240, 240))
			b["first_name"], b["email"] = "Mira", email
			return b
		}
		refusalOf := func(email string) map[int64][]any {
			rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body(email))
			assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_hire_duplicate")
			var refusal contractRefusal
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal), rec.Body.String())
			reasons := map[int64][]any{}
			for _, raw := range refusal.Details["matches"].([]any) {
				match := raw.(map[string]any)
				if match["kind"] == "school" {
					reasons[int64(match["staff_id"].(float64))] = match["reasons"].([]any)
				}
			}
			return reasons
		}

		assert.Equal(t, map[int64][]any{nameOnly.ID: {"name"}, byMasterData.ID: {"email"}}, refusalOf(" MIRA.y@example.org "),
			"the same name without a birthday, and the address in the school's master data, are asked about")
		assert.Equal(t, map[int64][]any{nameOnly.ID: {"name"}, byAccount.ID: {"email"}}, refusalOf(account.Email),
			"the address a person signs in with is asked about")
		assert.Equal(t, map[int64][]any{nameOnly.ID: {"name"}, byInvitation.ID: {"email"}}, refusalOf("invited."+account.Email),
			"the address a person is invited at is asked about")

		// A person with a record whose Einsatzort reaches the address is the
		// record's match: Lena Brandt was hired with this address above.
		rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body("lena.brandt@example.org"))
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_hire_duplicate")
		var refusal contractRefusal
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal), rec.Body.String())
		var records []map[string]any
		for _, raw := range refusal.Details["matches"].([]any) {
			if match := raw.(map[string]any); match["kind"] == "record" {
				records = append(records, match)
			}
		}
		require.Len(t, records, 1, rec.Body.String())
		assert.Equal(t, "Brandt", records[0]["last_name"])
		assert.Equal(t, []any{"email"}, records[0]["reasons"], "the record of a person the address reaches is asked about")
		brandt := hiredPeople(t, db, north, "Brandt")[0].StaffID
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM audit.data_access_log
			WHERE tenant_id = ? AND actor_role = 'traeger' AND metadata->>'view' = 'staff_hire_check'
			AND metadata->'staff_ids' @> to_jsonb(ARRAY[?::bigint])`, north, brandt),
			"the school whose master data gave the reason logs the access")

		_, err = db.ExecContext(ctx, `UPDATE users.persons SET birthday = DATE '1991-01-01' WHERE id = ?`, nameOnly.PersonID)
		require.NoError(t, err)
		rec = traegerJSON(t, router, office.token, http.MethodPost, staffHirePath, body("mira.neu@example.org"))
		require.Equal(t, http.StatusCreated, rec.Code, "a different birthday tells two people apart: %s", rec.Body.String())
	})

	t.Run("no role without the right and no session of a school hires", func(t *testing.T) {
		overviewOnly := newTraegerOffice(t, db, portal, "Träger Übersicht Einstellung", identityaccess.TraegerRoleReadOnly)
		staffRelease(t, db, overviewOnly.organization)
		rec := traegerJSON(t, router, overviewOnly.token, http.MethodPost, staffHirePath, hireBody("Ohnerecht", hireSite(overviewOnly.schools[0], 240, 240, 240, 240, 240)))
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		assert.Empty(t, hiredPeople(t, db, overviewOnly.schools[0], "Ohnerecht"))
		rec = traegerJSON(t, router, "", http.MethodPost, staffHirePath, hireBody("Ohnesitzung", hireSite(north, 240, 240, 240, 240, 240)))
		assert.Equal(t, http.StatusUnauthorized, rec.Code, rec.Body.String())
	})
}

// TestTraegerStaffHireNamesWhatAFailedHireLeftBehind fails the second
// Einsatzort of a hire. The first school keeps its person, because no
// transaction spans two schools (ADR 0105): the answer names that school,
// so the Personalverwaltung completes the hire under „Ohne Akte“ instead of
// hiring the person a second time.
func TestTraegerStaffHireNamesWhatAFailedHireLeftBehind(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, _, _, _, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)
	_, err := db.ExecContext(context.Background(), `CREATE FUNCTION users.reject_hire_master_data() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'the second Einsatzort is unavailable'; END $$;
		CREATE TRIGGER reject_hire_master_data BEFORE INSERT ON users.staff_master_data
			FOR EACH ROW WHEN (NEW.tenant_id = `+strconv.FormatInt(south, 10)+`) EXECUTE FUNCTION users.reject_hire_master_data()`)
	require.NoError(t, err)

	rec := traegerJSON(t, router, office.token, http.MethodPost, staffHirePath,
		hireBody("Halb", hireSite(north, 240, 240, 240, 240, 240), hireSite(south, 240, 240, 240, 240, 240)))
	assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_hire_incomplete")
	var refusal contractRefusal
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal), rec.Body.String())
	assert.Equal(t, []any{"Träger Personal OGS Nord"}, refusal.Details["schools"], "the answer names the school that keeps the person")
	assert.NotContains(t, refusal.Details, "staff_record_id", "no record was saved")
	assert.Len(t, hiredPeople(t, db, north, "Halb"), 1, "the first school keeps its person")
	assert.Empty(t, hiredPeople(t, db, south, "Halb"), "the failed school rolled its person back")
	overview := decode[staffOverviewBody](t, traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-records/", nil))
	assert.Empty(t, overview.Records)
	require.Len(t, overview.Suggestions, 1, "the person stands under „Ohne Akte“")
	assert.Equal(t, "Halb", overview.Suggestions[0].Members[0].LastName)
}
