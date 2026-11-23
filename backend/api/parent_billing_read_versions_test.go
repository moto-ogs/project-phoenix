// Test helpers that read the version a save of the Elternabrechnung sends
// back (ADR 0311). A test reads the token from the API like the office's
// form does; it never builds one.
package api

import (
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// readTraegerData reads a Träger route and decodes its data.
func readTraegerData[T any](t *testing.T, router http.Handler, token, path string) T {
	t.Helper()
	rec := traegerJSON(t, router, token, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeSchoolPortalData[T](t, rec.Body.Bytes())
}

// withVersion is a copy of body that sends version as the read state.
func withVersion(body map[string]any, version string) map[string]any {
	sent := maps.Clone(body)
	if sent == nil {
		sent = map[string]any{}
	}
	sent["expected_version"] = version
	return sent
}

// termsVersion is the version of the terms of a service.
func termsVersion(t *testing.T, router http.Handler, token, service string) string {
	t.Helper()
	read := readTraegerData[struct {
		Terms []struct {
			Service string `json:"service"`
			Version string `json:"version"`
		} `json:"terms"`
	}](t, router, token, billingTermsPath)
	for _, terms := range read.Terms {
		if terms.Service == service {
			return terms.Version
		}
	}
	return ""
}

// creditorVersion is the version of the Träger's SEPA creditor.
func creditorVersion(t *testing.T, router http.Handler, token string) string {
	t.Helper()
	return readTraegerData[struct {
		Version string `json:"version"`
	}](t, router, token, sepaCreditorPath).Version
}

// putSollstellung saves the Sollstellung mapping on the version just read.
func putSollstellung(t *testing.T, router http.Handler, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	read := readTraegerData[struct {
		Sollstellung struct {
			Version string `json:"version"`
		} `json:"sollstellung"`
	}](t, router, token, financeExportsPath+"/settings")
	return traegerJSON(t, router, token, http.MethodPut, financeExportsPath+"/settings/sollstellung", withVersion(body, read.Sollstellung.Version))
}

// mealPricesVersion is the version of the Mensa prices of a school.
func mealPricesVersion(t *testing.T, router http.Handler, token string, school int64) string {
	t.Helper()
	return readTraegerData[struct {
		Versions map[string]string `json:"versions"`
	}](t, router, token, careMealTariffsPath).Versions[strconv.FormatInt(school, 10)]
}

// putMealPrice sets a Mensa price on the prices of its school just read.
func putMealPrice(t *testing.T, router http.Handler, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	school, err := strconv.ParseInt(fmt.Sprint(body["school_id"]), 10, 64)
	require.NoError(t, err)
	return traegerJSON(t, router, token, http.MethodPut, careMealTariffsPath, withVersion(body, mealPricesVersion(t, router, token, school)))
}

// deleteMealPrice removes a Mensa price from the prices of its school just
// read.
func deleteMealPrice(t *testing.T, router http.Handler, token string, school int64, validFrom string) *httptest.ResponseRecorder {
	t.Helper()
	return traegerJSON(t, router, token, http.MethodDelete, fmt.Sprintf("%s/%d/%s?expected_version=%s", careMealTariffsPath, school, validFrom,
		mealPricesVersion(t, router, token, school)), nil)
}

// familyChildrenVersion is the version of the numbers of the family of a
// contract.
func familyChildrenVersion(t *testing.T, router http.Handler, token string, contractID int64) string {
	t.Helper()
	type contract struct {
		ContractID ident.ID `json:"contract_id"`
	}
	read := readTraegerData[struct {
		Families []struct {
			ContractID ident.ID   `json:"contract_id"`
			Children   []contract `json:"children"`
			Version    string     `json:"version"`
		} `json:"families"`
	}](t, router, token, familyChildrenPath)
	for _, family := range read.Families {
		if family.ContractID == ident.ID(contractID) ||
			slices.ContainsFunc(family.Children, func(child contract) bool { return child.ContractID == ident.ID(contractID) }) {
			return family.Version
		}
	}
	return ""
}

// confirmFamily confirms the number of the family of the body's contract on
// the numbers just read.
func confirmFamily(t *testing.T, router http.Handler, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	contractID, err := strconv.ParseInt(fmt.Sprint(body["contract_id"]), 10, 64)
	require.NoError(t, err)
	return traegerJSON(t, router, token, http.MethodPut, familyChildrenPath, withVersion(body, familyChildrenVersion(t, router, token, contractID)))
}

// putRunDueDates sets the due dates of a monthly ("care") or holiday run on
// the dates just read.
func putRunDueDates(t *testing.T, router http.Handler, token, kind string, runID int64, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	path := careRunPath(runID, "")
	if kind == "holiday" {
		path = billingRunPath(runID, "")
	}
	read := readTraegerData[struct {
		DueDatesVersion string `json:"due_dates_version"`
	}](t, router, token, path)
	return putRunDueDatesFrom(t, router, token, kind, runID, read.DueDatesVersion, body)
}

// putRunDueDatesFrom sets the due dates of a run on the version an answer
// the test already holds named; another read of the run would stand in its
// trail.
func putRunDueDatesFrom(t *testing.T, router http.Handler, token, kind string, runID int64, version string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	return traegerJSON(t, router, token, http.MethodPut, runDueDatesPathOf(kind, runID), withVersion(body, version))
}

// itemVersion is the version of the entry id in a list a route answers;
// list picks the entries with their IDs and versions.
func itemVersion(id int64, entries []versionedEntry) string {
	for _, entry := range entries {
		if entry.ID == ident.ID(id) {
			return entry.Version
		}
	}
	return ""
}

// versionedEntry is an entry of a list with its read-state token.
type versionedEntry struct {
	ID      ident.ID `json:"id"`
	Version string   `json:"version"`
}

// careRuleVersion is the version of a care rule.
func careRuleVersion(t *testing.T, router http.Handler, token string, ruleID int64) string {
	t.Helper()
	return itemVersion(ruleID, readTraegerData[struct {
		Rules []versionedEntry `json:"rules"`
	}](t, router, token, careRulesPath).Rules)
}

// contributionRuleVersion is the version of a holiday contribution rule.
func contributionRuleVersion(t *testing.T, router http.Handler, token string, ruleID int64) string {
	t.Helper()
	return itemVersion(ruleID, readTraegerData[[]versionedEntry](t, router, token, contributionRulesPath))
}

// costBearerVersion is the version of a cost bearer.
func costBearerVersion(t *testing.T, router http.Handler, token string, bearerID int64) string {
	t.Helper()
	return itemVersion(bearerID, readTraegerData[[]versionedEntry](t, router, token, costBearersPath))
}

// evidenceVersion is the version of an evidence.
func evidenceVersion(t *testing.T, router http.Handler, token string, evidenceID int64) string {
	t.Helper()
	read := readTraegerData[struct {
		Contracts []struct {
			Evidences []versionedEntry `json:"evidences"`
		} `json:"contracts"`
	}](t, router, token, careEvidencesPath)
	for _, contract := range read.Contracts {
		if version := itemVersion(evidenceID, contract.Evidences); version != "" {
			return version
		}
	}
	return ""
}

// costShareVersion is the version of a cost bearer share.
func costShareVersion(t *testing.T, router http.Handler, token string, shareID int64) string {
	t.Helper()
	read := readTraegerData[struct {
		Contracts []struct {
			Shares []versionedEntry `json:"shares"`
		} `json:"contracts"`
	}](t, router, token, careCostSharesPath)
	for _, contract := range read.Contracts {
		if version := itemVersion(shareID, contract.Shares); version != "" {
			return version
		}
	}
	return ""
}
