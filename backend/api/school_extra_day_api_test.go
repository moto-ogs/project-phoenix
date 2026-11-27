// Router-level tests of the extra care days a school plans for itself
// (#4817, ADR 0329): the school writes a row of its Träger, hosted by the
// school alone, and the Träger-Büro reads it among its own days.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type schoolExtraDayBody struct {
	extraDayPeriodBody
	Status            string  `json:"status"`
	Version           string  `json:"version"`
	CreatedBySchoolID *wireID `json:"created_by_school_id"`
}

// schoolExtraDayRouter mounts the school's extra days at
// /api/holiday-extra-days over the fixture's database and days without care.
func schoolExtraDayRouter(t *testing.T, f holidayRegistrationFixture, days owners.HolidayTestSchoolCalendar) http.Handler {
	t.Helper()
	organizations, err := owners.NewOrganizationTenancy(testpkg.NewDatabase(t, f.db))
	require.NoError(t, err)
	unit := testpkg.TenantRuntime(t, f.db)
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(tenant.WithUnitOfWork(r.Context(), unit)))
		})
	})
	router.Mount("/api/holiday-extra-days", NewSchoolExtraDayHTTP(organizations, days, holidayFixtureNow).Router(ProtectedTenantRoutes))
	return testpkg.SessionVerifier(router)
}

// schoolPlanner signs a staff member of the school in with perms.
func schoolPlanner(t *testing.T, f holidayRegistrationFixture, schoolID int64, perms ...string) string {
	t.Helper()
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, f.db, schoolID, "Petra", "Planung")
	return testpkg.MintTestJWT(t, sessiontoken.AppClaims{
		ID: int(account.ID), Sub: account.Email, Username: "planung", FirstName: "Petra", LastName: "Planung",
		Roles: []string{"admin"}, TenantID: schoolID, Permissions: perms,
	})
}

func schoolExtraDayJSON(t *testing.T, router http.Handler, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequest(method, "/api/holiday-extra-days"+path, &payload)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// A school plans an extra day for itself, changes it and opens the
// registration. The day is a row of its Träger: the Träger-Büro reads it
// with the school that planned it, and parents register through its link.
func TestSchoolPlansAnExtraCareDayForItself(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Schule", identityaccess.TraegerRoleAdministration)
	school := schoolExtraDayRouter(t, f, nil)
	planner := schoolPlanner(t, f, office.schools[0], permissions.SchedulesUpdate)

	rec := schoolExtraDayJSON(t, school, planner, http.MethodGet, "/", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, decodeSchoolPortalData[[]schoolExtraDayBody](t, rec.Body.Bytes()))

	// The body names the kind of a holiday period; the school route plans an
	// extra day whatever it says.
	body := extraDay(extraDayBridge, true, 0, office.schools[0])
	body["kind"] = enrollment.HolidayPeriodKindHoliday
	rec = schoolExtraDayJSON(t, school, planner, http.MethodPost, "/", body)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeSchoolPortalData[schoolExtraDayBody](t, rec.Body.Bytes())
	assert.Equal(t, enrollment.HolidayPeriodKindExtraDay, created.Kind)
	assert.Equal(t, enrollment.HolidayPeriodDraft, created.Status)
	require.NotNil(t, created.CreatedBySchoolID)
	assert.Equal(t, office.schools[0], int64(*created.CreatedBySchoolID))
	require.Len(t, created.Weeks, 1)
	assert.Equal(t, office.schools[0], int64(created.Weeks[0].HostSchoolID))

	// The school moves the day to a price per day while it is a draft.
	paid := extraDay(extraDayBridge, false, 1800, office.schools[0])
	paid["expected_version"] = created.Version
	paid["weeks"].([]map[string]any)[0]["id"] = fmt.Sprint(created.Weeks[0].ID)
	paid["weeks"].([]map[string]any)[0]["time_models"].([]map[string]any)[0]["id"] = fmt.Sprint(created.Weeks[0].TimeModels[0].ID)
	rec = schoolExtraDayJSON(t, school, planner, http.MethodPut, fmt.Sprintf("/%d", created.ID), paid)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	updated := decodeSchoolPortalData[schoolExtraDayBody](t, rec.Body.Bytes())
	assert.False(t, updated.IncludedInFee)
	assert.Equal(t, 1800, updated.Weeks[0].TimeModels[0].PriceCents)

	rec = schoolExtraDayJSON(t, school, planner, http.MethodPost, fmt.Sprintf("/%d/publish", created.ID), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	published := decodeSchoolPortalData[schoolExtraDayBody](t, rec.Body.Bytes())
	assert.Equal(t, enrollment.HolidayPeriodPublished, published.Status)

	rec = schoolExtraDayJSON(t, school, planner, http.MethodGet, "/", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	listed := decodeSchoolPortalData[[]schoolExtraDayBody](t, rec.Body.Bytes())
	require.Len(t, listed, 1)
	assert.Equal(t, created.ID, listed[0].ID)

	// Parents register through the link of the day.
	rec = publicJSON(t, f.public, http.MethodGet, registrationPath(published.PublicToken), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	offer := decodeSchoolPortalData[extraDayOfferBody](t, rec.Body.Bytes())
	assert.Equal(t, enrollment.HolidayPeriodKindExtraDay, offer.Kind)
	require.Len(t, offer.Weeks, 1)

	// The Träger-Büro reads the day among its own, with the school that
	// planned it.
	rec = traegerJSON(t, f.traeger, office.token, http.MethodGet, holidayPeriodPath(int64(created.ID)), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	seen := decodeSchoolPortalData[schoolExtraDayBody](t, rec.Body.Bytes())
	require.NotNil(t, seen.CreatedBySchoolID)
	assert.Equal(t, office.schools[0], int64(*seen.CreatedBySchoolID))
}

// The school and its Träger come from the session. A school plans for no
// other school, reads no day of the Träger-Büro or of another school, and a
// session without the planning right plans nothing.
func TestSchoolExtraCareDayStaysWithItsSchool(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Grenze", identityaccess.TraegerRoleAdministration)
	foreign := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Fremd", identityaccess.TraegerRoleAdministration)
	school := schoolExtraDayRouter(t, f, nil)
	north := schoolPlanner(t, f, office.schools[0], permissions.SchedulesUpdate)
	south := schoolPlanner(t, f, office.schools[1], permissions.SchedulesUpdate)
	stranger := schoolPlanner(t, f, foreign.schools[0], permissions.SchedulesUpdate)

	// No right, no day: reading the school's calendar is not planning it.
	reader := schoolPlanner(t, f, office.schools[0], permissions.SchedulesRead, permissions.ConfigRead)
	rec := schoolExtraDayJSON(t, school, reader, http.MethodPost, "/", extraDay(extraDayBridge, true, 0, office.schools[0]))
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	rec = schoolExtraDayJSON(t, school, reader, http.MethodGet, "/", nil)
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())

	// A sibling school of the same Träger and a school of another Träger are
	// both refused as hosts.
	rec = schoolExtraDayJSON(t, school, north, http.MethodPost, "/", extraDay(extraDayBridge, true, 0, office.schools[1]))
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	rec = schoolExtraDayJSON(t, school, north, http.MethodPost, "/", extraDay(extraDayBridge, true, 0, office.schools[0], office.schools[1]))
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	rec = schoolExtraDayJSON(t, school, north, http.MethodPost, "/", extraDay(extraDayBridge, true, 0, foreign.schools[0]))
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())

	rec = schoolExtraDayJSON(t, school, north, http.MethodPost, "/", extraDay(extraDayBridge, true, 0, office.schools[0]))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	own := decodeSchoolPortalData[schoolExtraDayBody](t, rec.Body.Bytes())

	// The day of the Träger-Büro at the same school is the Büro's.
	rec = traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", extraDay(extraDayMonday, true, 0, office.schools[0]))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	officeDay := decodeSchoolPortalData[schoolExtraDayBody](t, rec.Body.Bytes())
	assert.Nil(t, officeDay.CreatedBySchoolID)

	for name, token := range map[string]string{"sibling school": south, "school of another Träger": stranger} {
		rec = schoolExtraDayJSON(t, school, token, http.MethodGet, fmt.Sprintf("/%d", own.ID), nil)
		assert.Equal(t, http.StatusNotFound, rec.Code, "%s: %s", name, rec.Body.String())
		rec = schoolExtraDayJSON(t, school, token, http.MethodPost, fmt.Sprintf("/%d/publish", own.ID), nil)
		assert.Equal(t, http.StatusNotFound, rec.Code, "%s: %s", name, rec.Body.String())
		change := extraDay(extraDayBridge, true, 0, office.schools[1])
		change["expected_version"] = own.Version
		rec = schoolExtraDayJSON(t, school, token, http.MethodPut, fmt.Sprintf("/%d", own.ID), change)
		assert.Equal(t, http.StatusNotFound, rec.Code, "%s: %s", name, rec.Body.String())
		rec = schoolExtraDayJSON(t, school, token, http.MethodGet, "/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decodeSchoolPortalData[[]schoolExtraDayBody](t, rec.Body.Bytes()), name)
	}
	rec = schoolExtraDayJSON(t, school, north, http.MethodGet, fmt.Sprintf("/%d", officeDay.ID), nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	rec = schoolExtraDayJSON(t, school, north, http.MethodPost, fmt.Sprintf("/%d/publish", officeDay.ID), nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	rec = schoolExtraDayJSON(t, school, north, http.MethodGet, "/", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	days := decodeSchoolPortalData[[]schoolExtraDayBody](t, rec.Body.Bytes())
	require.Len(t, days, 1, "the school lists the days it planned itself")
	assert.Equal(t, own.ID, days[0].ID)

	// A school cannot move its day to another school.
	moved := extraDay(extraDayBridge, true, 0, office.schools[1])
	moved["expected_version"] = own.Version
	rec = schoolExtraDayJSON(t, school, north, http.MethodPut, fmt.Sprintf("/%d", own.ID), moved)
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
}

// A statutory holiday has no care: the school plans no extra day on it.
func TestSchoolExtraCareDayOnAStatutoryHolidayIsRefused(t *testing.T) {
	t.Parallel()
	days := owners.HolidayTestSchoolCalendar{
		{Date: calendar.NewDate(2099, 5, 21), Kind: enrollment.HolidayNoCareHoliday, Name: "Christi Himmelfahrt"},
	}
	f := newHolidayRegistrationFixtureWithDays(t, days)
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Schulfeiertag", identityaccess.TraegerRoleAdministration)
	school := schoolExtraDayRouter(t, f, days)
	planner := schoolPlanner(t, f, office.schools[0], permissions.SchedulesUpdate)

	rec := schoolExtraDayJSON(t, school, planner, http.MethodPost, "/", extraDay(extraDayAscension, true, 0, office.schools[0]))
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Equal(t, "enrollment.holiday_week_no_care_day", decodeHolidayError(t, rec.Body.Bytes()).Code)
}
