package operator

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeBillingReport answers the billing routes without a database; the
// capture and the store are covered by the compose tests.
type fakeBillingReport struct {
	counts      []organizationtenancy.BillingKeyDateCount
	listErr     error
	setDays     []int
	setResult   organizationtenancy.BillingKeyDay
	seedCalls   []time.Time
	seedWritten int
	seedErr     error
	overrides   []organizationtenancy.BillingKeyDayOverride
	setTargets  []organizationtenancy.BillingKeyDayTarget
	setOverride []*int
}

func (f *fakeBillingReport) BillingKeyDay(context.Context) (organizationtenancy.BillingKeyDay, error) {
	result := f.setResult
	result.Overrides = f.overrides
	return result, nil
}

// SetBillingKeyDay records the change. For an own day it knows the Träger
// 4 and the school 9; any other target is unknown, as at the owner.
func (f *fakeBillingReport) SetBillingKeyDay(_ context.Context, change organizationtenancy.BillingKeyDayChange, _ int64) (organizationtenancy.BillingKeyDay, error) {
	if change.Day != nil && (*change.Day < 1 || *change.Day > 28) {
		return organizationtenancy.BillingKeyDay{}, organizationtenancy.ErrInvalidBillingKeyDay
	}
	if change.Target == nil {
		f.setDays = append(f.setDays, *change.Day)
		return organizationtenancy.BillingKeyDay{Day: *change.Day, NextKeyDate: "2026-10-10"}, nil
	}
	target := *change.Target
	f.setTargets = append(f.setTargets, target)
	f.setOverride = append(f.setOverride, change.Day)
	switch {
	case target.School && target.ID != 9:
		return organizationtenancy.BillingKeyDay{}, organizationtenancy.ErrSchoolNotFound
	case !target.School && target.ID != 4:
		return organizationtenancy.BillingKeyDay{}, organizationtenancy.ErrOrganizationNotFound
	}
	return organizationtenancy.BillingKeyDay{Day: 15, NextKeyDate: "2026-11-15", Overrides: f.overrides}, nil
}

func (f *fakeBillingReport) ListBillingKeyDateCounts(context.Context) ([]organizationtenancy.BillingKeyDateCount, error) {
	return f.counts, f.listErr
}

func (f *fakeBillingReport) RecordDueBillingKeyDates(context.Context, time.Time) (int, error) {
	return 0, nil
}

func (f *fakeBillingReport) SeedBillingKeyDateCounts(_ context.Context, now time.Time) (int, error) {
	f.seedCalls = append(f.seedCalls, now)
	return f.seedWritten, f.seedErr
}

func billingCount(period, keyDate, school string) organizationtenancy.BillingKeyDateCount {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		panic(err)
	}
	return organizationtenancy.BillingKeyDateCount{
		SchoolID: 7, SchoolName: school, OrganizationName: "Träger Nord",
		Period: period, KeyDate: keyDate, ActiveStudents: 120, ActiveTerminals: 3,
		RecordedAt: time.Date(2026, time.August, 15, 6, 5, 0, 0, berlin),
	}
}

// billingClock pins the resource's clock to a fixed instant.
func billingClock() time.Time { return time.Date(2026, time.November, 2, 9, 0, 0, 0, time.UTC) }

func TestBillingResourceRequiresAClock(t *testing.T) {
	t.Parallel()
	assert.PanicsWithValue(t, "organization tenancy operator: billing clock is required", func() {
		NewBillingResource(&fakeBillingReport{}, nil, nil, nil)
	})
}

func TestBillingExportWritesAGermanSpreadsheetCSV(t *testing.T) {
	t.Parallel()
	report := &fakeBillingReport{counts: []organizationtenancy.BillingKeyDateCount{
		billingCount("2026-08-01", "2026-08-15", "=HYPERLINK(\"x\")"),
		billingCount("2026-07-01", "2026-07-15", "OGS Juli"),
	}}
	resource := NewBillingResource(report, nil, nil, billingClock)

	recorder := httptest.NewRecorder()
	resource.ExportKeyDateCounts(recorder, httptest.NewRequest(http.MethodGet, "/billing/key-date-counts/export?month=2026-08", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "text/csv; charset=utf-8", recorder.Header().Get("Content-Type"))
	assert.Equal(t, `attachment; filename="stichtagszahlen-2026-08.csv"`, recorder.Header().Get("Content-Disposition"))
	body := recorder.Body.String()
	require.True(t, strings.HasPrefix(body, "\xEF\xBB\xBF"), "Excel needs the BOM to read umlauts")
	lines := strings.Split(strings.TrimSpace(strings.TrimPrefix(body, "\xEF\xBB\xBF")), "\n")
	require.Len(t, lines, 2, "only the requested month")
	assert.Equal(t, "Monat;Stichtag;Träger;Schule;Schul-ID;Aktive Kinder;Aktive Terminals;Erfasst am", lines[0])
	assert.Equal(t, `08/2026;15.08.2026;Träger Nord;"'=HYPERLINK(""x"")";7;120;3;15.08.2026 06:05`, lines[1])
}

func TestBillingExportWithoutMonthContainsEveryMonth(t *testing.T) {
	t.Parallel()
	report := &fakeBillingReport{counts: []organizationtenancy.BillingKeyDateCount{
		billingCount("2026-08-01", "2026-08-15", "OGS August"),
		billingCount("2026-07-01", "2026-07-15", "OGS Juli"),
	}}
	recorder := httptest.NewRecorder()
	NewBillingResource(report, nil, nil, billingClock).ExportKeyDateCounts(recorder, httptest.NewRequest(http.MethodGet, "/billing/key-date-counts/export", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, `attachment; filename="stichtagszahlen.csv"`, recorder.Header().Get("Content-Disposition"))
	assert.Contains(t, recorder.Body.String(), "OGS August")
	assert.Contains(t, recorder.Body.String(), "OGS Juli")
}

func TestBillingExportRejectsAMalformedMonth(t *testing.T) {
	t.Parallel()
	for _, month := range []string{"2026-13", "2026-8", "08-2026", "x"} {
		recorder := httptest.NewRecorder()
		NewBillingResource(&fakeBillingReport{}, nil, nil, billingClock).ExportKeyDateCounts(recorder,
			httptest.NewRequest(http.MethodGet, "/billing/key-date-counts/export?month="+month, nil))
		assert.Equal(t, http.StatusBadRequest, recorder.Code, month)
	}
}

func TestBillingListHidesInternalErrors(t *testing.T) {
	t.Parallel()
	recorder := httptest.NewRecorder()
	report := &fakeBillingReport{listErr: errors.New("pq: relation does not exist")}
	NewBillingResource(report, nil, nil, billingClock).ListKeyDateCounts(recorder, httptest.NewRequest(http.MethodGet, "/billing/key-date-counts", nil))

	assert.Equal(t, http.StatusInternalServerError, recorder.Code)
	assert.NotContains(t, recorder.Body.String(), "relation")
}

func TestBillingListWritesSchoolIDsAsStrings(t *testing.T) {
	t.Parallel()
	const schoolID = int64(9_007_199_254_740_993)
	recorder := httptest.NewRecorder()
	report := &fakeBillingReport{counts: []organizationtenancy.BillingKeyDateCount{
		{SchoolID: schoolID},
	}}

	NewBillingResource(report, nil, nil, billingClock).ListKeyDateCounts(recorder, httptest.NewRequest(http.MethodGet, "/billing/key-date-counts", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"school_id":"9007199254740993"`)
}

func TestBillingKeyDayUpdateValidatesTheBody(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		body   string
		status int
		code   string
	}{
		{"missing key day", `{}`, http.StatusBadRequest, common.CodeGeneralInput},
		{"day outside 1..28", `{"key_day":31}`, http.StatusBadRequest, common.CodeBillingInvalidKeyDay},
		{"valid day", `{"key_day":10}`, http.StatusOK, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			report := &fakeBillingReport{}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPut, "/billing/key-day", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			NewBillingResource(report, nil, nil, billingClock).UpdateKeyDay(recorder, request)
			assert.Equal(t, tc.status, recorder.Code, recorder.Body.String())
			if tc.code != "" {
				// #2519: the operator portal shows the reason by code.
				assert.Contains(t, recorder.Body.String(), `"code":"`+tc.code+`"`)
			}
			if tc.status == http.StatusOK {
				assert.Equal(t, []int{10}, report.setDays)
				assert.Contains(t, recorder.Body.String(), `"key_day":10`)
			}
		})
	}
}

func TestBillingSeedCaptureAcceptsOnlyTheLocalSeeder(t *testing.T) {
	t.Parallel()

	t.Run("captures on a local development request", func(t *testing.T) {
		t.Parallel()
		report := &fakeBillingReport{seedWritten: 3}
		request := httptest.NewRequest(http.MethodPost, "/billing/key-date-counts/seed", nil)
		request.Host = "localhost:8080"
		request.Header.Set("X-Phoenix-Seed-Token", "true")
		recorder := httptest.NewRecorder()

		capturedAt := time.Date(2026, time.November, 2, 9, 0, 0, 0, time.UTC)
		NewBillingResource(report, nil, func(*http.Request) bool { return true }, func() time.Time { return capturedAt }).SeedKeyDateCounts(recorder, request)

		require.Equal(t, http.StatusCreated, recorder.Code, recorder.Body.String())
		require.Len(t, report.seedCalls, 1)
		assert.False(t, report.seedCalls[0].IsZero())
		assert.Equal(t, capturedAt, report.seedCalls[0])
		assert.Contains(t, recorder.Body.String(), `"written":3`)
	})

	t.Run("refuses a production request", func(t *testing.T) {
		t.Parallel()
		report := &fakeBillingReport{}
		request := httptest.NewRequest(http.MethodPost, "/billing/key-date-counts/seed", nil)
		request.Host = "localhost:8080"
		request.Header.Set("X-Phoenix-Seed-Token", "true")
		recorder := httptest.NewRecorder()

		NewBillingResource(report, nil, func(*http.Request) bool { return false }, billingClock).SeedKeyDateCounts(recorder, request)

		assert.Equal(t, http.StatusForbidden, recorder.Code)
		assert.Empty(t, report.seedCalls)
	})
}

func TestBillingKeyDayListsTheOwnDaysOfBothScopesWithStringIDs(t *testing.T) {
	t.Parallel()
	var organization, school int64 = 4, 9
	report := &fakeBillingReport{
		setResult: organizationtenancy.BillingKeyDay{Day: 15, NextKeyDate: "2026-11-15"},
		overrides: []organizationtenancy.BillingKeyDayOverride{
			{OrganizationID: &organization, TraegerID: organization, Name: "Träger Nord", Day: 5, NextKeyDate: "2026-12-05"},
			{SchoolID: &school, TraegerID: organization, Name: "OGS Am Bach", OrganizationName: "Träger Nord", Day: 20, NextKeyDate: "2026-11-20"},
		},
	}
	recorder := httptest.NewRecorder()
	NewBillingResource(report, nil, nil, billingClock).GetKeyDay(recorder, httptest.NewRequest(http.MethodGet, "/billing/key-day", nil))

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	body := recorder.Body.String()
	assert.Contains(t, body, `"key_day":15`)
	assert.Contains(t, body, `{"scope":"organization","id":"4","organization_id":"4","name":"Träger Nord","organization_name":"","key_day":5,"next_key_date":"2026-12-05"`)
	assert.Contains(t, body, `{"scope":"school","id":"9","organization_id":"4","name":"OGS Am Bach","organization_name":"Träger Nord","key_day":20,"next_key_date":"2026-11-20"`)
}

func TestBillingKeyDayWithoutOwnDaysListsNone(t *testing.T) {
	t.Parallel()
	recorder := httptest.NewRecorder()
	NewBillingResource(&fakeBillingReport{}, nil, nil, billingClock).GetKeyDay(recorder, httptest.NewRequest(http.MethodGet, "/billing/key-day", nil))
	assert.Contains(t, recorder.Body.String(), `"overrides":[]`, "an empty list, never null")
}

func TestBillingKeyDayOverrideValidatesBodyAndTarget(t *testing.T) {
	t.Parallel()
	ten := 10
	cases := []struct {
		name   string
		method string
		id     string
		school bool
		body   string
		status int
		code   string
		day    *int
	}{
		{"missing key day never resets", http.MethodPut, "4", false, `{}`, http.StatusBadRequest, common.CodeGeneralInput, nil},
		{"text is no day", http.MethodPut, "4", false, `{"key_day":"zehn"}`, http.StatusBadRequest, common.CodeGeneralInput, nil},
		{"day outside 1..28", http.MethodPut, "9", true, `{"key_day":29}`, http.StatusBadRequest, common.CodeBillingInvalidKeyDay, nil},
		{"unknown Träger", http.MethodPut, "5", false, `{"key_day":10}`, http.StatusNotFound, common.CodeProvisioningOrganizationNotFound, nil},
		{"unknown school", http.MethodDelete, "8", true, ``, http.StatusNotFound, common.CodeProvisioningSchoolNotFound, nil},
		{"Träger gets a day", http.MethodPut, "4", false, `{"key_day":10}`, http.StatusOK, "", &ten},
		{"delete resets the school", http.MethodDelete, "9", true, ``, http.StatusOK, "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			report := &fakeBillingReport{}
			resource := NewBillingResource(report, nil, nil, billingClock)
			router := chi.NewRouter()
			router.Put("/organizations/{organizationId}", resource.SetOrganizationKeyDay)
			router.Delete("/organizations/{organizationId}", resource.ResetOrganizationKeyDay)
			router.Put("/schools/{schoolId}", resource.SetSchoolKeyDay)
			router.Delete("/schools/{schoolId}", resource.ResetSchoolKeyDay)
			segment := "/organizations/"
			if tc.school {
				segment = "/schools/"
			}
			request := httptest.NewRequest(tc.method, segment+tc.id, strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			assert.Equal(t, tc.status, recorder.Code, recorder.Body.String())
			if tc.code != "" {
				assert.Contains(t, recorder.Body.String(), `"code":"`+tc.code+`"`)
			}
			if tc.status == http.StatusOK {
				require.Len(t, report.setTargets, 1)
				assert.Equal(t, tc.school, report.setTargets[0].School)
				assert.Equal(t, tc.day, report.setOverride[0], "PUT sets the day, DELETE resets it")
			}
			if tc.code == common.CodeGeneralInput {
				assert.Empty(t, report.setTargets, "a refused body reaches the owner never")
			}
		})
	}
}
