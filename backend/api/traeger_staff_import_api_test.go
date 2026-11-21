// Router-level tests for the Personal-Import of the Träger (#4724, ADR 0089
// section 5): a new Träger takes its staff over from a CSV file with a
// preview and a list of errors before anything is stored; the personnel
// number is the only key, so a repeated import creates no duplicate; a row
// that contradicts its record changes nothing; a role without the right
// gets 403 and no Träger reaches another Träger's records; every read of a
// record with an Einsatzort is in that school's access log.
package api

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

const (
	staffImportPath        = "/traeger/staff-record-imports/"
	staffImportPreviewPath = "/traeger/staff-record-imports/preview"
	staffImportIBAN        = "DE89370400440532013000"
)

type staffImportBody struct {
	Headers []string `json:"headers"`
	Mapping struct {
		Columns map[string]string `json:"columns"`
	} `json:"mapping"`
	Unmapped    []string                    `json:"unmapped"`
	Fingerprint string                      `json:"fingerprint"`
	Applied     bool                        `json:"applied"`
	Counts      workforce.StaffImportCounts `json:"counts"`
	Rows        []workforce.StaffImportRow  `json:"rows"`
}

// staffImport previews the file and, with apply, takes it over with the
// fingerprint of that preview, as the office does.
func staffImport(t *testing.T, router http.Handler, token string, content string, apply bool) (*httptest.ResponseRecorder, staffImportBody) {
	t.Helper()
	rec := importForm(t, router, token, staffImportPreviewPath, "personal.csv", []byte(content), nil)
	if rec.Code != http.StatusOK || !apply {
		return rec, decodeIfOK(t, rec)
	}
	preview := decode[staffImportBody](t, rec)
	rec = importForm(t, router, token, staffImportPath, "personal.csv", []byte(content), map[string]string{"fingerprint": preview.Fingerprint})
	return rec, decodeIfOK(t, rec)
}

func decodeIfOK(t *testing.T, rec *httptest.ResponseRecorder) staffImportBody {
	t.Helper()
	if rec.Code >= http.StatusBadRequest {
		return staffImportBody{}
	}
	return decode[staffImportBody](t, rec)
}

func staffImportStatuses(body staffImportBody) map[int]string {
	statuses := map[int]string{}
	for _, row := range body.Rows {
		statuses[row.Line] = row.Status
	}
	return statuses
}

// TestTraegerStaffImportTakesOverStaffWithoutDuplicates walks the acceptance
// of #4724 end to end.
func TestTraegerStaffImportTakesOverStaffWithoutDuplicates(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, portal, _, _, office := newTraegerStaffFixture(t, db)
	north := office.schools[0]
	file := "Personalnummer;Vorname;Nachname;Geburtsdatum;IBAN;Steuer-ID\n" +
		"70031;Mira;Sommer;02.04.1990;" + staffImportIBAN + ";12345678901\n" +
		"70032;Jonas;Keller;;;\n" +
		";Lea;Brandt;31.12.2099;DE00;\n" +
		"70040;Ole;Wendt;;;\n" +
		"70040;Ole;Wendt-Berg;;;\n"

	t.Run("without the release nothing is read", func(t *testing.T) {
		rec, _ := staffImport(t, router, office.token, file, false)
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_not_released")
	})
	staffRelease(t, db, office.organization)

	t.Run("the preview maps the columns and names every problem before anything is stored", func(t *testing.T) {
		rec, preview := staffImport(t, router, office.token, file, false)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "Personalnummer", preview.Mapping.Columns["personnel_number"])
		assert.Equal(t, "Steuer-ID", preview.Mapping.Columns["tax_id"])
		assert.Empty(t, preview.Unmapped)
		assert.Equal(t, map[int]string{2: "new", 3: "new", 4: "invalid", 5: "conflict", 6: "conflict"}, staffImportStatuses(preview))
		assert.Equal(t, []workforce.StaffImportProblem{
			{Field: "personnel_number", Code: "missing"}, {Field: "birthday", Code: "future"}, {Field: "iban", Code: "invalid"},
		}, preview.Rows[2].Problems, "the error list names the field and the reason")
		assert.Equal(t, "•••• 3000", preview.Rows[0].IBANMasked, "a bank value leaves only masked")
		assert.NotContains(t, rec.Body.String(), staffImportIBAN)
		assert.NotContains(t, rec.Body.String(), "12345678901")
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_records WHERE organization_id = ?`, office.organization))
	})

	t.Run("an import needs the confirmed preview", func(t *testing.T) {
		rec := importForm(t, router, office.token, staffImportPath, "personal.csv", []byte(file), nil)
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_import_changed")
	})

	var mira int64
	t.Run("the import creates a record per new row with its line in the trail", func(t *testing.T) {
		rec, result := staffImport(t, router, office.token, file, true)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.True(t, result.Applied)
		assert.Equal(t, 2, result.Counts.Imported)
		assert.Equal(t, 3, result.Counts.Invalid+result.Counts.Conflict, "invalid and contradicting rows stay out")
		mira = result.Rows[0].RecordID.Int64()
		require.NotZero(t, mira)
		rec = traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", mira), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		record := decode[staffRecordBody](t, rec)
		assert.Equal(t, "Sommer", record.LastName)
		require.NotNil(t, record.PersonnelNumber)
		assert.Equal(t, "70031", *record.PersonnelNumber)
		require.NotNil(t, record.Financial.IBAN)
		assert.Equal(t, "•••• 3000", *record.Financial.IBAN)
		require.NotEmpty(t, record.Changes)
		assert.Equal(t, "imported", record.Changes[0].Kind)
		assert.Equal(t, "Zeile 2: personal.csv", record.Changes[0].Value)
		rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/financial/reveal", mira), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		financial := decode[workforce.TraegerStaffFinancial](t, rec)
		require.NotNil(t, financial.TaxID)
		assert.Equal(t, "12345678901", *financial.TaxID, "the values are sealed to the record and open again")
	})

	t.Run("a repeated import creates no duplicate", func(t *testing.T) {
		rec, result := staffImport(t, router, office.token, file, true)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.Zero(t, result.Counts.Imported)
		assert.Equal(t, 2, result.Counts.Duplicate)
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_records WHERE organization_id = ?`, office.organization))
	})

	t.Run("a number without its leading zeros finds its record", func(t *testing.T) {
		rec, result := staffImport(t, router, office.token, "Personalnummer;Vorname;Nachname\n070031;Mira;Sommer\n", false)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, map[int]string{2: "duplicate"}, staffImportStatuses(result), "a spreadsheet adds or drops leading zeros")
		assert.Equal(t, ident.ID(mira), result.Rows[0].RecordID)
	})

	t.Run("a row fills empty bank values of its record and never changes a contradicted one", func(t *testing.T) {
		completing := "Personalnummer;Vorname;Nachname;IBAN\n70032;Jonas;Keller;" + staffImportIBAN + "\n70031;Mira;Sommer-Berg;" + staffImportIBAN + "\n"
		rec, result := staffImport(t, router, office.token, completing, false)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, map[int]string{2: "complete", 3: "conflict"}, staffImportStatuses(result))
		assert.Equal(t, []string{"iban"}, result.Rows[0].Completes)
		assert.Equal(t, []workforce.StaffImportProblem{{Field: "last_name", Code: "differs"}}, result.Rows[1].Problems,
			"a wrong number must not carry values to another person")
		rec, result = staffImport(t, router, office.token, completing, true)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.Equal(t, 1, result.Counts.Imported)
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_records
			WHERE organization_id = ? AND personnel_number = '70032' AND iban_masked = '•••• 3000'`, office.organization))
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM workforce.staff_records
			WHERE organization_id = ? AND personnel_number = '70031' AND last_name = 'Sommer'`, office.organization))
	})

	t.Run("the overview proposes the school's person with the same number for the imported record", func(t *testing.T) {
		person := testpkg.CreateTestStaffForTenant(t, db, north, "Mira", "Sommer")
		staffSetPersonnelNumber(t, db, north, person.ID, "70031")
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-records/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var proposed bool
		for _, suggestion := range decode[staffOverviewBody](t, rec).Suggestions {
			if suggestion.RecordID != nil && int64(*suggestion.RecordID) == mira && suggestion.Reason == workforce.TraegerStaffMatchPersonnelNumber {
				proposed = len(suggestion.Members) == 1 && int64(suggestion.Members[0].StaffID) == person.ID
			}
		}
		assert.True(t, proposed, "the import links nobody by itself; the office confirms the proposal")
		rec = traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
			"staff_record_id": mira, "members": []map[string]int64{{"school_id": north, "staff_id": person.ID}},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		before := staffAccessEntries(t, db, office.organization, "traeger_staff_records")[north]
		rec, _ = staffImport(t, router, office.token, file, false)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, before+1, staffAccessEntries(t, db, office.organization, "traeger_staff_records")[north],
			"a preview that reads a record with an Einsatzort is in that school's access log")
	})

	t.Run("the log lists the imports and names the colleague who imported", func(t *testing.T) {
		colleague := staffImportColleague(t, db, portal, office.organization, "Ines Lindner")
		rec, _ := staffImport(t, router, colleague, "Personalnummer;Vorname;Nachname\n70050;Tom;Lenz\n", true)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		rec = traegerJSON(t, router, office.token, http.MethodGet, staffImportPath, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		entries := decode[[]workforce.StaffImportEntry](t, rec)
		require.Len(t, entries, 3)
		assert.False(t, entries[0].ByYou)
		assert.Equal(t, "Ines Lindner", entries[0].AccountName, "the Personalverwaltung may not read the Träger-Büro; the log names the colleague")
		assert.Equal(t, [2]int{1, 0}, [2]int{entries[0].Created, entries[0].Completed})
		assert.Equal(t, "personal.csv", entries[1].File)
		assert.True(t, entries[1].ByYou)
		assert.Empty(t, entries[1].AccountName, "the reader's own import needs no name")
		assert.Equal(t, [2]int{0, 1}, [2]int{entries[1].Created, entries[1].Completed}, "the newer own import filled one record")
		assert.Equal(t, [2]int{2, 0}, [2]int{entries[2].Created, entries[2].Completed})
	})

	t.Run("no role without the right and no other Träger reaches the records", func(t *testing.T) {
		overviewOnly := newTraegerOffice(t, db, portal, "Träger Import Übersicht", identityaccess.TraegerRoleReadOnly)
		rec, _ := staffImport(t, router, overviewOnly.token, file, false)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		rec, _ = staffImport(t, router, overviewOnly.token, file, true)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		rec = traegerJSON(t, router, overviewOnly.token, http.MethodGet, staffImportPath, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		other := newTraegerOffice(t, db, portal, "Träger Import Fremd", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec, result := staffImport(t, router, other.token, file, false)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "new", result.Rows[0].Status, "the numbers of one Träger are unknown to another")
		rec = traegerJSON(t, router, other.token, http.MethodGet, staffImportPath, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decode[[]workforce.StaffImportEntry](t, rec))
	})

	t.Run("a file that is no CSV is refused", func(t *testing.T) {
		rec := importForm(t, router, office.token, staffImportPreviewPath, "personal.csv", []byte{0x00, 0x01, 0x02}, nil)
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_staff_import_file_invalid")
		rec = importForm(t, router, office.token, staffImportPreviewPath, "personal.xlsx", []byte(file), nil)
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_staff_import_file_invalid")
		rec = importForm(t, router, office.token, staffImportPreviewPath, "personal.csv", []byte(file), map[string]string{
			"mapping": `{"columns":{"personnel_number":"Nummer","first_name":"Vorname","last_name":"Nachname"}}`,
		})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_staff_import_mapping_invalid")
	})
}

// staffImportColleague signs in a second person of the Personalverwaltung
// of the Träger, with the name the person carries there.
func staffImportColleague(t *testing.T, db *bun.DB, portal *traegerPortalHandler, organization int64, name string) string {
	t.Helper()
	password := testpkg.NewTestPassword()
	account := traegerAccount(t, db, password)
	testpkg.CreateTestTraegerMember(t, db, organization, account.ID, identityaccess.TraegerRolePersonnel)
	_, err := db.ExecContext(context.Background(), `UPDATE platform.organization_accounts SET display_name = ?
		WHERE organization_id = ? AND account_id = ?`, name, organization, account.ID)
	require.NoError(t, err)
	code, answer := traegerSignIn(t, portal, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	return answer.AccessToken
}

// TestTraegerStaffImportLogQueryBudgetIsFlat pins the statements of the
// import log for any number of imports.
func TestTraegerStaffImportLogQueryBudgetIsFlat(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	staffRelease(t, db, office.organization)
	measure := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, staffImportPath, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	importRows := func(numbers ...string) {
		var file strings.Builder
		file.WriteString("Personalnummer;Vorname;Nachname\n")
		for _, number := range numbers {
			file.WriteString(number + ";Kraft;Nummer " + number + "\n")
		}
		rec, _ := staffImport(t, router, office.token, file.String(), true)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	}
	importRows("1")
	first := measure()
	importRows("2", "3")
	importRows("4", "5", "6")
	assert.Len(t, measure().Statements, len(first.Statements), "the log reads the same statements for any number of imports")
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_record_imports", first)
}

// TestTraegerStaffImportWritesInBulk proves the import writes set-based:
// one new row and five new rows take the same number of statements.
func TestTraegerStaffImportWritesInBulk(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	staffRelease(t, db, office.organization)
	apply := func(numbers ...string) int {
		var file strings.Builder
		file.WriteString("Personalnummer;Vorname;Nachname;IBAN\n")
		for _, number := range numbers {
			file.WriteString(number + ";Kraft;Nummer " + number + ";" + staffImportIBAN + "\n")
		}
		preview := importForm(t, router, office.token, staffImportPreviewPath, "personal.csv", []byte(file.String()), nil)
		require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
		counter := testpkg.CaptureQueriesForContext(t, db)
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, err := form.CreateFormFile("file", "personal.csv")
		require.NoError(t, err)
		_, err = part.Write([]byte(file.String()))
		require.NoError(t, err)
		require.NoError(t, form.WriteField("fingerprint", decode[staffImportBody](t, preview).Fingerprint))
		require.NoError(t, form.Close())
		req := httptest.NewRequest(http.MethodPost, staffImportPath, &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		require.Equal(t, len(numbers), decode[staffImportBody](t, rec).Counts.Imported)
		return counter.Total()
	}
	// The first import finds no record and skips reading their links; the
	// comparison starts with records in place.
	apply("1")
	one := apply("2")
	assert.Equal(t, one, apply("3", "4", "5", "6", "7"), "statements do not grow with the rows of the file")
}
