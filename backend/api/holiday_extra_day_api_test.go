// Router-level tests of the extra care days of a Träger (#4817): a single
// day outside the holidays, such as a bridge day, planned for one or several
// schools, either included in the monthly contribution or booked at a price
// per day. An extra day is a holiday period of its own kind; registration,
// places and the host school's lists are those of the holidays.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Friday 22 May 2099 is the day after Christi Himmelfahrt (Thursday 21 May
// 2099), a bridge day.
const (
	extraDayAscension = "2099-05-21"
	extraDayBridge    = "2099-05-22"
	extraDaySaturday  = "2099-05-23"
	extraDayMonday    = "2099-05-25"
)

type extraDayPeriodBody struct {
	ID            wireID `json:"id"`
	Kind          string `json:"kind"`
	IncludedInFee bool   `json:"included_in_fee"`
	PublicToken   string `json:"public_token"`
	Weeks         []struct {
		ID           wireID `json:"id"`
		StartsOn     string `json:"starts_on"`
		EndsOn       string `json:"ends_on"`
		HostSchoolID wireID `json:"host_school_id"`
		BookingUnit  string `json:"booking_unit"`
		TimeModels   []struct {
			ID         wireID `json:"id"`
			PriceCents int    `json:"price_cents"`
		} `json:"time_models"`
	} `json:"weeks"`
}

type extraDayOfferBody struct {
	Kind          string `json:"kind"`
	IncludedInFee bool   `json:"included_in_fee"`
	Weeks         []struct {
		ID         wireID `json:"id"`
		StartsOn   string `json:"starts_on"`
		EndsOn     string `json:"ends_on"`
		TimeModels []struct {
			ID         wireID `json:"id"`
			PriceCents int    `json:"price_cents"`
		} `json:"time_models"`
	} `json:"weeks"`
	Schools []struct {
		ID wireID `json:"id"`
	} `json:"schools"`
}

// extraDay is the body of an extra day on date at schools, open for care
// from 08:00 to 16:00 at priceCents.
func extraDay(date string, included bool, priceCents int, schools ...int64) map[string]any {
	weeks := make([]map[string]any, len(schools))
	for i, school := range schools {
		weeks[i] = map[string]any{
			"starts_on": date, "ends_on": date, "host_school_id": fmt.Sprint(school),
			"time_models": []map[string]any{{"name": "Betreuung", "starts_at": "08:00", "ends_at": "16:00", "price_cents": priceCents}},
		}
	}
	return map[string]any{
		"kind": enrollment.HolidayPeriodKindExtraDay, "included_in_fee": included,
		"name": "Brückentag nach Himmelfahrt", "registration_opens_on": "2020-01-01", "registration_closes_on": "2099-05-08",
		"binding": true, "notes": "", "weeks": weeks,
	}
}

func decodeHolidayError(t *testing.T, body []byte) holidayErrorBody {
	t.Helper()
	var problem holidayErrorBody
	require.NoError(t, json.Unmarshal(body, &problem))
	return problem
}

// extraDayBilling signs a person of the office's Träger in who runs the
// billing.
func extraDayBilling(t *testing.T, f holidayRegistrationFixture, office traegerOffice) string {
	t.Helper()
	return traegerColleague(t, reviewFixture{holidayRegistrationFixture: f, office: office}, identityaccess.TraegerRoleBilling)
}

func extraDayRegistration(offer extraDayOfferBody, email, child string) map[string]any {
	return map[string]any{
		"guardian": map[string]any{"first_name": "Eva", "last_name": "Zusatz", "email": email, "phone": "0151 2345678"},
		"children": []map[string]any{{
			"first_name": child, "last_name": "Zusatz", "birth_date": "2017-05-04", "home_school_id": fmt.Sprint(offer.Schools[0].ID),
			"bookings": []map[string]any{{"week_id": fmt.Sprint(offer.Weeks[0].ID), "time_model_id": fmt.Sprint(offer.Weeks[0].TimeModels[0].ID)}},
		}},
		"emergency_contacts": []map[string]any{{"name": "Oma Zusatz", "phone": "05402 1234", "relationship": "Großmutter"}},
		"privacy_consent":    true, "binding_confirmed": true, "custody_confirmed": true, "declaration_name": "Eva Zusatz",
		"consent_version": enrollment.HolidayConsentVersionCurrent, "retention_days": holidayDefaultRetentionDays, "captcha_token": "valid-token",
	}
}

// The Träger-Büro plans one extra day for two of its schools, included in
// the monthly contribution. Parents register through the period's link, the
// child takes its place, and the hosting school reads it on its list of the
// day. Nothing is billed: the day is no billable period.
func TestExtraCareDayIsPlannedForSeveralSchoolsAndBooked(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Brücke", identityaccess.TraegerRoleAdministration)

	rec := traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", extraDay(extraDayBridge, true, 0, office.schools...))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeSchoolPortalData[extraDayPeriodBody](t, rec.Body.Bytes())
	assert.Equal(t, enrollment.HolidayPeriodKindExtraDay, created.Kind)
	assert.True(t, created.IncludedInFee)
	require.Len(t, created.Weeks, 2, "one day per school")
	for _, day := range created.Weeks {
		assert.Equal(t, extraDayBridge, day.StartsOn)
		assert.Equal(t, extraDayBridge, day.EndsOn)
		assert.Equal(t, enrollment.HolidayBookingUnitWeek, day.BookingUnit)
	}

	rec = traegerJSON(t, f.traeger, office.token, http.MethodPost, holidayPeriodPath(int64(created.ID))+"/publish", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	published := decodeSchoolPortalData[extraDayPeriodBody](t, rec.Body.Bytes())

	rec = publicJSON(t, f.public, http.MethodGet, registrationPath(published.PublicToken), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	offer := decodeSchoolPortalData[extraDayOfferBody](t, rec.Body.Bytes())
	assert.Equal(t, enrollment.HolidayPeriodKindExtraDay, offer.Kind, "the form of the parents names the extra day")
	assert.True(t, offer.IncludedInFee)
	require.Len(t, offer.Weeks, 2)
	assert.Zero(t, offer.Weeks[0].TimeModels[0].PriceCents)

	rec = publicJSON(t, f.public, http.MethodPost, registrationPath(published.PublicToken), extraDayRegistration(offer, "eva.zusatz@example.org", "Mia"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	receipt := decodeSchoolPortalData[receiptBody](t, rec.Body.Bytes())
	require.Len(t, receipt.Placements, 1)
	assert.Equal(t, enrollment.HolidayPlacementPlaced, receipt.Placements[0].Placement)

	// The Träger asks its office for the debtor number at a confirmation.
	// An included day is never billed, so it is confirmed without one.
	askForDebtorNumber(t, reviewFixture{holidayRegistrationFixture: f, office: office}, true)
	rec = confirmReadHoliday(t, f.traeger, office.token, int64(created.ID), int64(receipt.ID), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// The hosting school reads the child on the day's list.
	today := &atomic.Value{}
	today.Store(calendar.NewDate(2099, 5, 20))
	host := holidayHostFixture{holidayRegistrationFixture: f, school: newHolidayHostRouter(t, f, today)}
	staff := host.staffOf(t, office.schools[0], permissions.ConfigRead)
	hosted := host.weeks(t, staff)
	require.Len(t, hosted, 1)
	assert.Equal(t, extraDayBridge, hosted[0].StartsOn)
	assert.Equal(t, extraDayBridge, hosted[0].EndsOn)
	assert.Equal(t, 1, hosted[0].Participants)
	list := host.participants(t, staff, int64(hosted[0].ID))
	require.Len(t, list.Participants, 1)
	assert.Equal(t, "Mia", list.Participants[0].FirstName)

	// The office reads the figures of each school in the list and its export.
	rec = traegerJSON(t, f.traeger, office.token, http.MethodGet, holidayPeriodPath(int64(created.ID)), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	counted := decodeSchoolPortalData[struct {
		Weeks []struct {
			Placed int `json:"placed"`
		} `json:"weeks"`
	}](t, rec.Body.Bytes())
	require.Len(t, counted.Weeks, 2)
	assert.Equal(t, []int{1, 0}, []int{counted.Weeks[0].Placed, counted.Weeks[1].Placed}, "Mia has her place at the first school")
	rec = traegerJSON(t, f.traeger, office.token, http.MethodGet, "/traeger/holiday-periods/export?kind=extra_day&format=csv", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "Brückentag nach Himmelfahrt;22.05.2099;Zusatztag Brücke OGS Nord;08:00 bis 16:00 Uhr;08.05.2099;Im Monatsbeitrag enthalten;1;Ohne Grenze;Veröffentlicht")
	assert.Contains(t, rec.Body.String(), "Zusatztag Brücke OGS Süd;08:00 bis 16:00 Uhr;08.05.2099;Im Monatsbeitrag enthalten;0;")
	rec = traegerJSON(t, f.traeger, office.token, http.MethodGet, "/traeger/holiday-periods/export?kind=holiday&format=csv", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "Brückentag", "the list of holiday periods leaves the extra days out")

	// An included day is never billed: the billing run does not offer it.
	billing := extraDayBilling(t, f, office)
	rec = traegerJSON(t, f.traeger, billing, http.MethodGet, "/traeger/billing-runs/periods", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	billable := decodeSchoolPortalData[[]struct {
		ID wireID `json:"id"`
	}](t, rec.Body.Bytes())
	assert.Empty(t, billable, "a day included in the monthly contribution has nothing to bill")
	rec = traegerJSON(t, f.traeger, billing, http.MethodPost, "/traeger/billing-runs/", map[string]any{"holiday_period_id": fmt.Sprint(created.ID)})
	assert.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
}

// An extra day at a price per day is billed like a holiday booking: the
// price is the base position, and the period is billable.
func TestExtraCareDayAtADayPriceIsBillable(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Tagespreis", identityaccess.TraegerRoleAdministration)

	rec := traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", extraDay(extraDayBridge, false, 1800, office.schools[0]))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeSchoolPortalData[extraDayPeriodBody](t, rec.Body.Bytes())
	assert.False(t, created.IncludedInFee)
	assert.Equal(t, 1800, created.Weeks[0].TimeModels[0].PriceCents)
	rec = traegerJSON(t, f.traeger, office.token, http.MethodPost, holidayPeriodPath(int64(created.ID))+"/publish", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	published := decodeSchoolPortalData[extraDayPeriodBody](t, rec.Body.Bytes())

	// A day at a price is billed: where the Träger asks for the debtor
	// number, the confirmation needs it like a holiday registration.
	rec = publicJSON(t, f.public, http.MethodGet, registrationPath(published.PublicToken), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	offer := decodeSchoolPortalData[extraDayOfferBody](t, rec.Body.Bytes())
	assert.Equal(t, 1800, offer.Weeks[0].TimeModels[0].PriceCents)
	rec = publicJSON(t, f.public, http.MethodPost, registrationPath(published.PublicToken), extraDayRegistration(offer, "eva.tagespreis@example.org", "Noah"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	receipt := decodeSchoolPortalData[receiptBody](t, rec.Body.Bytes())
	askForDebtorNumber(t, reviewFixture{holidayRegistrationFixture: f, office: office}, true)
	rec = confirmReadHoliday(t, f.traeger, office.token, int64(created.ID), int64(receipt.ID), nil)
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	rec = confirmReadHoliday(t, f.traeger, office.token, int64(created.ID), int64(receipt.ID), map[string]any{"debtor_number": "104711"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = traegerJSON(t, f.traeger, extraDayBilling(t, f, office), http.MethodGet, "/traeger/billing-runs/periods", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	billable := decodeSchoolPortalData[[]struct {
		ID wireID `json:"id"`
	}](t, rec.Body.Bytes())
	require.Len(t, billable, 1)
	assert.Equal(t, created.ID, billable[0].ID)
}

// An extra day is one weekday, the same for each of its schools; a day
// included in the monthly contribution has no price, and only an extra day
// can be included. The kind of a period never changes.
func TestExtraCareDayKeepsItsShape(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixture(t)
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Form", identityaccess.TraegerRoleAdministration)
	post := func(body map[string]any) (int, holidayErrorBody) {
		rec := traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", body)
		var problem holidayErrorBody
		if rec.Code != http.StatusCreated {
			problem = decodeHolidayError(t, rec.Body.Bytes())
		}
		return rec.Code, problem
	}
	fields := func(problem holidayErrorBody) []string {
		names := make([]string, len(problem.Errors))
		for i, entry := range problem.Errors {
			names[i] = entry.Field
		}
		return names
	}

	severalDays := extraDay(extraDayBridge, true, 0, office.schools[0])
	severalDays["weeks"].([]map[string]any)[0]["ends_on"] = extraDayMonday
	code, problem := post(severalDays)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, fields(problem), "weeks.0.ends_on", "an extra day is a single day")

	code, problem = post(extraDay(extraDaySaturday, true, 0, office.schools[0]))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, fields(problem), "weeks.0.starts_on", "an extra day is a weekday")

	twoDates := extraDay(extraDayBridge, true, 0, office.schools...)
	twoDates["weeks"].([]map[string]any)[1]["starts_on"] = extraDayMonday
	twoDates["weeks"].([]map[string]any)[1]["ends_on"] = extraDayMonday
	code, problem = post(twoDates)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, fields(problem), "weeks.1.starts_on", "the schools of an extra day share its date")

	code, problem = post(extraDay(extraDayBridge, true, 1800, office.schools[0]))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, fields(problem), "weeks.0.time_models.0.price_cents", "an included day has no price")

	holidays := extraDay(extraDayBridge, true, 0, office.schools[0])
	holidays["kind"] = enrollment.HolidayPeriodKindHoliday
	code, problem = post(holidays)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, fields(problem), "included_in_fee", "only an extra day is included in the monthly contribution")

	unknown := extraDay(extraDayBridge, false, 0, office.schools[0])
	unknown["kind"] = "trip"
	code, problem = post(unknown)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, fields(problem), "kind")

	rec := traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", extraDay(extraDayBridge, false, 1800, office.schools[0]))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeSchoolPortalData[extraDayPeriodBody](t, rec.Body.Bytes())
	changed := extraDay(extraDayBridge, false, 1800, office.schools[0])
	changed["kind"] = enrollment.HolidayPeriodKindHoliday
	changed["weeks"].([]map[string]any)[0]["id"] = fmt.Sprint(created.Weeks[0].ID)
	changed["weeks"].([]map[string]any)[0]["time_models"].([]map[string]any)[0]["id"] = fmt.Sprint(created.Weeks[0].TimeModels[0].ID)
	rec = putHolidayPeriod(t, f.traeger, office.token, holidayPeriodPath(int64(created.ID)), changed)
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, fields(decodeHolidayError(t, rec.Body.Bytes())), "kind", "the kind of a period never changes")
}

// A statutory holiday of the federal state has no care: an extra day cannot
// be planned on it (#4817).
func TestExtraCareDayOnAStatutoryHolidayIsRefused(t *testing.T) {
	t.Parallel()
	f := newHolidayRegistrationFixtureWithDays(t, owners.HolidayTestSchoolCalendar{
		{Date: calendar.NewDate(2099, 5, 21), Kind: enrollment.HolidayNoCareHoliday, Name: "Christi Himmelfahrt"},
	})
	office := newTraegerOffice(t, f.db, f.traeger, "Zusatztag Feiertag", identityaccess.TraegerRoleAdministration)

	rec := traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", extraDay(extraDayAscension, true, 0, office.schools[0]))
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	assert.Equal(t, "enrollment.holiday_week_no_care_day", decodeHolidayError(t, rec.Body.Bytes()).Code)

	rec = traegerJSON(t, f.traeger, office.token, http.MethodPost, "/traeger/holiday-periods/", extraDay(extraDayBridge, true, 0, office.schools[0]))
	assert.Equal(t, http.StatusCreated, rec.Code, "the bridge day after the holiday can be planned: %s", rec.Body.String())
}
