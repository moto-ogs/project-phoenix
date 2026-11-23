// Router-level tests of the read state of the Elternabrechnung's forms
// (ADR 0311, #7904): a change sends the version of what the office read; a
// version of an older state, and none, is refused with
// general.changed_since_read and writes nothing; the current version saves.
package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// readStateForm is one form of the office: version reads the version the
// form starts from, save sends a change from a version; every call changes
// another value, so a stale save would overwrite the save before it.
type readStateForm struct {
	name    string
	version func() string
	save    func(version string) *httptest.ResponseRecorder
}

func TestParentBillingFormsSaveOnlyOnTheReadState(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Formulare gelesener Stand")
	router, token := f.traeger, f.office.token
	school := f.office.schools[0]
	contract := careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	run := f.startRun(t, careMonth)
	bearer := f.costBearer(t, "Jugendamt Musterkreis")

	created := func(path string, body map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		rec := traegerJSON(t, router, token, http.MethodPost, path, body)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		return rec
	}
	holidayRule := int64(decodeSchoolPortalData[contributionRuleBody](t, created(contributionRulesPath, siblingHalf()).Body.Bytes()).ID)
	level := int64(f.saveRule(t, careRule("income_level", "Stufe 1", []int64{school}, map[string]any{"discount_basis_points": 5000})).Rules[0].ID)
	evidence := evidenceOf(t, decodeSchoolPortalData[careEvidenceSetBody](t,
		created(careEvidencesPath, careEvidence(contract, "income_level", &level)).Body.Bytes()), contract)
	f.saveCostShare(t, careCostShare(contract, "youth_office", bearer, map[string]any{"share_basis_points": 5000}))
	share := readTraegerData[struct {
		Contracts []struct {
			Shares []versionedEntry `json:"shares"`
		} `json:"contracts"`
	}](t, router, token, careCostSharesPath).Contracts[0].Shares[0].ID

	put := func(path string, body map[string]any) func(string) *httptest.ResponseRecorder {
		return func(version string) *httptest.ResponseRecorder {
			return traegerJSON(t, router, token, http.MethodPut, path, withVersion(body, version))
		}
	}
	calls := 0
	next := func() int { calls++; return calls }
	sollMapping := func(header string) map[string]any {
		return map[string]any{"columns": []map[string]any{{"field": "invoice_number", "header": header}}, "delimiter": ";",
			"decimal_separator": ",", "date_format": "dd.mm.yyyy", "encoding": "utf-8", "header_row": true, "file_name_pattern": "soll-{NR}.csv"}
	}
	forms := []readStateForm{
		{"holiday rule", func() string { return contributionRuleVersion(t, router, token, holidayRule) },
			func(v string) *httptest.ResponseRecorder {
				body := siblingHalf()
				body["discount_basis_points"] = 1000 + next()
				return put(fmt.Sprintf("%s/%d", contributionRulesPath, holidayRule), body)(v)
			}},
		{"care rule", func() string { return careRuleVersion(t, router, token, level) },
			func(v string) *httptest.ResponseRecorder {
				return put(fmt.Sprintf("%s/%d", careRulesPath, level),
					careRule("income_level", "Stufe 1", []int64{school}, map[string]any{"discount_basis_points": 1000 + next()}))(v)
			}},
		{"evidence", func() string { return evidenceVersion(t, router, token, evidence) },
			func(v string) *httptest.ResponseRecorder {
				body := careEvidence(contract, "income_level", &level)
				body["evidence"] = "Bescheid " + strconv.Itoa(next())
				return put(fmt.Sprintf("%s/%d", careEvidencesPath, evidence), body)(v)
			}},
		{"cost share", func() string { return costShareVersion(t, router, token, int64(share)) },
			func(v string) *httptest.ResponseRecorder {
				return put(fmt.Sprintf("%s/%d", careCostSharesPath, share),
					careCostShare(contract, "youth_office", bearer, map[string]any{"share_basis_points": 1000 + next()}))(v)
			}},
		{"cost bearer", func() string { return costBearerVersion(t, router, token, bearer) },
			func(v string) *httptest.ResponseRecorder {
				return put(costBearerPath(bearer), map[string]any{"name": "Jugendamt " + strconv.Itoa(next()), "active": true})(v)
			}},
		{"service terms", func() string { return termsVersion(t, router, token, "care") },
			func(v string) *httptest.ResponseRecorder {
				return put(billingTermsPath+"/care", map[string]any{"payment_method": "transfer", "due_days": next() % 100})(v)
			}},
		{"run due dates", func() string {
			return readTraegerData[struct {
				DueDatesVersion string `json:"due_dates_version"`
			}](t, router, token, careRunPath(int64(run.ID), "")).DueDatesVersion
		}, func(v string) *httptest.ResponseRecorder {
			return put(runDueDatesPathOf("care", int64(run.ID)), dueDates(fmt.Sprintf("2030-02-%02d", 1+next()%27), "2030-02-20"))(v)
		}},
		{"Sollstellung", func() string {
			return readTraegerData[struct {
				Sollstellung struct {
					Version string `json:"version"`
				} `json:"sollstellung"`
			}](t, router, token, financeExportsPath+"/settings").Sollstellung.Version
		}, func(v string) *httptest.ResponseRecorder {
			return put(financeExportsPath+"/settings/sollstellung", sollMapping("Beleg "+strconv.Itoa(next())))(v)
		}},
		{"SEPA creditor", func() string { return creditorVersion(t, router, token) },
			func(v string) *httptest.ResponseRecorder {
				return put(sepaCreditorPath, map[string]any{"creditor_id": "", "prenotification_days": 1 + next()%29, "missing_mandate": "transfer"})(v)
			}},
		{"Mensa price", func() string { return mealPricesVersion(t, router, token, school) },
			func(v string) *httptest.ResponseRecorder {
				return put(careMealTariffsPath, mealPrice(school, "2029-11-01", "per_meal", int64(400+next())))(v)
			}},
		{"family children", func() string { return familyChildrenVersion(t, router, token, contract) },
			func(v string) *httptest.ResponseRecorder {
				return put(familyChildrenPath, familyChildren(contract, 2+next()%8, "2026-09-01"))(v)
			}},
	}
	for _, form := range forms {
		read := form.version()
		require.NotEmpty(t, read, "%s: the read carries a version", form.name)
		rec := form.save(read)
		require.Equal(t, http.StatusOK, rec.Code, "%s: the version read saves: %s", form.name, rec.Body.String())
		saved := form.version()
		require.NotEqual(t, read, saved, "%s: a save moves the version", form.name)

		for stale, version := range map[string]string{"the version before the save": read, "no version": ""} {
			rec := form.save(version)
			require.Equal(t, http.StatusConflict, rec.Code, "%s, %s: %s", form.name, stale, rec.Body.String())
			code, _ := registrationRefusalOf(t, rec)
			assert.Equal(t, "general.changed_since_read", code, "%s, %s", form.name, stale)
			assert.Equal(t, saved, form.version(), "%s, %s: a refused save writes nothing", form.name, stale)
		}
		rec = form.save(saved)
		assert.Equal(t, http.StatusOK, rec.Code, "%s: the current version saves: %s", form.name, rec.Body.String())
	}

	// A removal of a Mensa price names the prices it was read from too.
	version := mealPricesVersion(t, router, token, school)
	require.Equal(t, http.StatusOK, putMealPrice(t, router, token, mealPrice(school, "2029-12-01", "flat", 5000)).Code)
	rec := traegerJSON(t, router, token, http.MethodDelete,
		fmt.Sprintf("%s/%d/2029-12-01?expected_version=%s", careMealTariffsPath, school, version), nil)
	require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
	require.Equal(t, http.StatusOK, deleteMealPrice(t, router, token, school, "2029-12-01").Code)
}
