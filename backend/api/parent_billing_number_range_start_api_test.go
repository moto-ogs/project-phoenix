// Router-level tests for the start value of a number range (#7358, ADR 0119
// addendum 2026-11-17): the Abrechnung sets the number the next invoice
// gets, so a Träger continues the numbers of the program it used before.
// Numbers never go back, every change stays in the history with the
// account, and the right "Abrechnung" and the Träger boundary hold.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type numberRangeStartBody struct {
	NextNumber   int64  `json:"next_number"`
	Example      string `json:"example"`
	Year         int    `json:"year"`
	SetAt        string `json:"set_at"`
	SetByYou     bool   `json:"set_by_you"`
	SetByAccount bool   `json:"set_by_account"`
	SetByName    string `json:"set_by_name"`
}

type numberRangeBody struct {
	Service    string                 `json:"service"`
	Pattern    string                 `json:"pattern"`
	Example    string                 `json:"example"`
	NextNumber int64                  `json:"next_number"`
	LastNumber int64                  `json:"last_number"`
	Year       int                    `json:"year"`
	Starts     []numberRangeStartBody `json:"starts"`
}

func numberRangeOf(t *testing.T, f reviewFixture, token, service string) numberRangeBody {
	t.Helper()
	rec := traegerJSON(t, f.traeger, token, http.MethodGet, numberRangesPath, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	for _, numberRange := range decodeSchoolPortalData[[]numberRangeBody](t, rec.Body.Bytes()) {
		if numberRange.Service == service {
			return numberRange
		}
	}
	require.Failf(t, "number range missing", "no number range of the service %s", service)
	return numberRangeBody{}
}

func numberRangeStartPath(service string) string {
	return numberRangesPath + "/" + service + "/start"
}

func TestNumberRangeStartContinuesTheNumbersOfAnotherProgram(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Nummernkreis Start")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	colleague := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	require.Equal(t, http.StatusOK, f.act(t, f.siblings, "confirm").Code)

	// Without a pattern there is no counter to start.
	rec := traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 7100})
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	code, _ := registrationRefusalOf(t, rec)
	assert.Equal(t, "parent_billing.number_range_missing", code)

	// A range without a start value counts from 1 as before.
	setNumberRange(t, f, billing, "{N}")
	before := numberRangeOf(t, f, billing, "holiday")
	assert.Equal(t, "1", before.Example)
	assert.EqualValues(t, 1, before.NextNumber)
	assert.Zero(t, before.LastNumber)
	assert.Empty(t, before.Starts)

	for _, invalid := range []int64{0, -5, 100_000_000} {
		rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": invalid})
		require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
		code, fields := registrationRefusalOf(t, rec)
		assert.Equal(t, "parent_billing.number_range_start_invalid", code)
		assert.Equal(t, []string{"next_number"}, fields)
	}
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("lunch"), map[string]any{"next_number": 5})
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())

	// Before the first invoice the start value can still be corrected, also
	// downwards.
	rec = traegerJSON(t, f.traeger, colleague, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 9000})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 7100})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	saved := decodeSchoolPortalData[numberRangeBody](t, rec.Body.Bytes())
	assert.Equal(t, "7100", saved.Example, "the preview shows the first number")
	assert.EqualValues(t, 7100, saved.NextNumber)
	assert.Zero(t, saved.LastNumber)

	// The history names every change with value, time and account.
	started := numberRangeOf(t, f, billing, "holiday")
	assert.Equal(t, "7100", started.Example)
	require.Len(t, started.Starts, 2)
	assert.EqualValues(t, 7100, started.Starts[0].NextNumber, "the newest change comes first")
	assert.Equal(t, "7100", started.Starts[0].Example)
	assert.True(t, started.Starts[0].SetByYou)
	assert.NotEmpty(t, started.Starts[0].SetAt)
	assert.EqualValues(t, 9000, started.Starts[1].NextNumber)
	assert.False(t, started.Starts[1].SetByYou)
	assert.True(t, started.Starts[1].SetByAccount, "the colleague's account still exists")
	seenByColleague := numberRangeOf(t, f, colleague, "holiday")
	assert.False(t, seenByColleague.Starts[0].SetByYou)
	assert.True(t, seenByColleague.Starts[1].SetByYou)
	var accounts int
	require.NoError(t, f.db.NewRaw(`SELECT count(DISTINCT actor_account_id) FROM parent_billing.number_range_starts
		WHERE organization_id = ? AND service = 'holiday' AND year = 0`, f.office.organization).Scan(context.Background(), &accounts))
	assert.Equal(t, 2, accounts, "each change keeps its account")

	// The monthly care keeps its own counter.
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangesPath+"/care", map[string]any{"pattern": "MB-{NNNN}"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	care := numberRangeOf(t, f, billing, "care")
	assert.Equal(t, "MB-0001", care.Example)
	assert.Empty(t, care.Starts)

	// The first released invoice carries the start value.
	run := startBillingRun(t, f, billing, int64(f.period.ID))
	preview := billingRun(t, f, billing, int64(run.ID))
	require.Equal(t, 1, preview.PreviewCount)
	rec = traegerJSON(t, f.traeger, billing, http.MethodPost, billingRunPath(int64(run.ID), "/release"), releaseBody(preview))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	released := billingRun(t, f, billing, int64(run.ID))
	require.Len(t, released.Documents, 1)
	assert.Equal(t, "7100", released.Documents[0].Number)
	issued := numberRangeOf(t, f, billing, "holiday")
	assert.EqualValues(t, 7100, issued.LastNumber)
	assert.EqualValues(t, 7101, issued.NextNumber)
	assert.Equal(t, "7101", issued.Example)

	// Numbers never go back: a value at or below the last issued number is
	// refused and names that number.
	for _, taken := range []int64{7100, 12} {
		rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": taken})
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		var refusal struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal), rec.Body.String())
		assert.Equal(t, "parent_billing.number_range_start_taken", refusal.Code)
		assert.Equal(t, "7100", refusal.Details["last_number"])
	}
	assert.Len(t, numberRangeOf(t, f, billing, "holiday").Starts, 2, "a refused value is not in the history")

	// A larger value moves the counter forward.
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 8000})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	forward := decodeSchoolPortalData[numberRangeBody](t, rec.Body.Bytes())
	assert.Equal(t, "8000", forward.Example)
	assert.EqualValues(t, 7100, forward.LastNumber)
	require.Len(t, forward.Starts, 3)
}

func TestNumberRangeStartNeedsTheBillingRightAndStaysWithItsTraeger(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Nummernkreis Recht")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Nummernkreis Fremd", identityaccess.TraegerRoleBilling)
	setNumberRange(t, f, billing, "FE-{JJJJ}-{NNNN}")

	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 500})
	require.Equal(t, http.StatusForbidden, rec.Code, "without the right Abrechnung: %s", rec.Body.String())
	var starts int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM parent_billing.number_range_starts WHERE organization_id = ?`, f.office.organization).
		Scan(context.Background(), &starts))
	assert.Zero(t, starts, "the refused change wrote nothing")

	// A pattern with a year starts the counter of that year.
	rec = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 500})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	own := decodeSchoolPortalData[numberRangeBody](t, rec.Body.Bytes())
	assert.NotZero(t, own.Year)
	assert.Contains(t, own.Example, "-0500")
	require.Len(t, own.Starts, 1)
	assert.Equal(t, own.Year, own.Starts[0].Year)

	// The history stays when the pattern moves to another counter; a value
	// of the other counter keeps its bare number.
	setNumberRange(t, f, billing, "{N}")
	moved := numberRangeOf(t, f, billing, "holiday")
	assert.Zero(t, moved.Year)
	assert.EqualValues(t, 1, moved.NextNumber, "the counter without a year has no start value")
	require.Len(t, moved.Starts, 1)
	assert.Equal(t, "500", moved.Starts[0].Example)

	// Another Träger sees neither the pattern nor the history and starts
	// its own counter.
	other := numberRangeOf(t, f, foreign.token, "holiday")
	assert.Empty(t, other.Pattern)
	assert.Empty(t, other.Starts)
	assert.Zero(t, other.NextNumber)
}

func TestNumberRangeListQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Budget Nummernkreis")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	colleague := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	list := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, f.db)
		req := httptest.NewRequest(http.MethodGet, numberRangesPath, nil)
		req.Header.Set("Authorization", "Bearer "+billing)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, f.traeger, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	start := func(token string, next int64) {
		rec := traegerJSON(t, f.traeger, token, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": next})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}
	setNumberRange(t, f, billing, "{N}")
	start(colleague, 100)
	one := list()
	for next := int64(200); next <= 500; next += 100 {
		start(colleague, next)
		start(billing, next+50)
	}
	assert.Len(t, list().Statements, len(one.Statements), "the list reads the same statements for any number of start values")
	querybudgets.AssertQueryBudget(t, "api.traeger.number_ranges", one)
}

// TestNumberRangeStartAndReleaseNeverPassEachOther sets a start value while
// the first run of the counter is released. Whichever holds the counter
// first, the start value applies: either the invoice carries it, or the next
// invoice does.
func TestNumberRangeStartAndReleaseNeverPassEachOther(t *testing.T) {
	t.Parallel()
	f := newReviewFixture(t, "Träger Nummernkreis Gleichzeitig")
	billing := traegerColleague(t, f, identityaccess.TraegerRoleBilling)
	require.Equal(t, http.StatusOK, f.act(t, f.siblings, "confirm").Code)
	setNumberRange(t, f, billing, "{N}")
	run := startBillingRun(t, f, billing, int64(f.period.ID))
	preview := billingRun(t, f, billing, int64(run.ID))

	var wait sync.WaitGroup
	var released, started int
	wait.Add(2)
	go func() {
		defer wait.Done()
		released = traegerJSON(t, f.traeger, billing, http.MethodPost, billingRunPath(int64(run.ID), "/release"), releaseBody(preview)).Code
	}()
	go func() {
		defer wait.Done()
		started = traegerJSON(t, f.traeger, billing, http.MethodPut, numberRangeStartPath("holiday"), map[string]any{"next_number": 50}).Code
	}()
	wait.Wait()
	require.Equal(t, http.StatusOK, released)
	require.Equal(t, http.StatusOK, started, "50 is above the one number a release can issue first")

	number := billingRun(t, f, billing, int64(run.ID)).Documents[0].Number
	after := numberRangeOf(t, f, billing, "holiday")
	switch number {
	case "50":
		assert.EqualValues(t, 51, after.NextNumber, "the start value came first and the invoice carries it")
	case "1":
		assert.EqualValues(t, 50, after.NextNumber, "the release came first and the next invoice carries the start value")
	default:
		assert.Failf(t, "unexpected number", "the invoice carries %s", number)
	}
	assert.Len(t, after.Starts, 1)
}
