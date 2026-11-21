package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/encoding/charmap"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

const (
	familyImportPath        = familyChildrenPath + "/imports"
	familyImportPreviewPath = familyImportPath + "/preview"
)

type familyImportBody struct {
	Unmapped    []string       `json:"unmapped"`
	Applied     bool           `json:"applied"`
	Fingerprint string         `json:"fingerprint"`
	Counts      map[string]int `json:"counts"`
	Rows        []struct {
		Line              int     `json:"line"`
		Status            string  `json:"status"`
		ContractID        wireID  `json:"contract_id"`
		Children          *int    `json:"children"`
		ConfirmedChildren *int    `json:"confirmed_children"`
		ValidFrom         *string `json:"valid_from"`
		Problems          []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"problems"`
	} `json:"rows"`
}

// Birkenfeld (#7356): the numbers come from another source than the
// contracts, as a list with the header of OGS Connect in Windows-1252. The
// office adds them for contracts moto has: the preview answers every row,
// the import takes over the confirmed preview only, never overwrites a
// confirmed number and stores each number as confirmed from the first day
// of the contract. The monthly run then bills the sibling price for a
// contract without a mail address and without a second contract.
func TestFamilyChildrenImportAddsTheNumbersOfAFile(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kinderzahl Datei")
	school := f.office.schools[0]
	contract := func(child string) int64 {
		return careContract(t, f.db, f.office.organization, school, child, careReductionStart, sjrServices()...)
	}
	mia, noah, lia, tom, ben, ida, max := contract("Mia"), contract("Noah"), contract("Lia"), contract("Tom"), contract("Ben"), contract("Ida"), contract("Max")
	ctx := context.Background()
	_, err := f.db.ExecContext(ctx, `UPDATE care_contract.contract_parties SET email = '' WHERE contract_id IN (?, ?, ?)`, mia, noah, lia)
	require.NoError(t, err)
	_, err = f.db.ExecContext(ctx, `UPDATE care_contract.contract_parties SET email = 'geschwister@example.org' WHERE contract_id IN (?, ?)`, tom, ben)
	require.NoError(t, err)
	// Ida and Max are siblings with one address.
	_, err = f.db.ExecContext(ctx, `UPDATE care_contract.contract_parties SET email = 'ida.max@example.org' WHERE contract_id IN (?, ?)`, ida, max)
	require.NoError(t, err)
	rec := traegerJSON(t, f.traeger, f.office.token, http.MethodPut, careTariffsPath, carePriceList(school, "2029-09-01", 3200))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	f.saveRule(t, careRule("sibling", "Geschwister mit Familie", []int64{school},
		map[string]any{"sibling_from_child": 2, "discount_basis_points": 5000, "counts_family_children": true}))
	for contractID, children := range map[int64]int{noah: 2, lia: 3} {
		rec = traegerJSON(t, f.traeger, f.office.token, http.MethodPut, familyChildrenPath, familyChildren(contractID, children, "2026-09-01"))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	}

	csv := strings.Join([]string{
		"Vorname;Nachname;Anzahl der Kinder in der Familie unter 18 Jahren",
		"Mia;Beispiel;2",
		"Noah;Beispiel;3",
		"Lia;Beispiel;3",
		"Jürgen;Unbekannt;2",
		"Tom;Beispiel;2",
		"Ben;Beispiel;3",
		"Mia;Beispiel;2",
		"Lia;Beispiel;zwei",
		"Ida;Beispiel;2",
		"Ida;Beispiel;3",
		"Max;Beispiel;3",
	}, "\r\n") + "\r\n"
	content, err := charmap.Windows1252.NewEncoder().Bytes([]byte(csv))
	require.NoError(t, err)

	// moto maps the header of OGS Connect by itself; a Träger with several
	// schools says which one a file without that column is for.
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", content, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"school"}, decodeSchoolPortalData[familyImportBody](t, rec.Body.Bytes()).Unmapped)
	fields := map[string]string{"mapping": fmt.Sprintf(`{"columns":{"child_first_name":"Vorname","child_last_name":"Nachname",
		"children":"Anzahl der Kinder in der Familie unter 18 Jahren"},"school_id":%d}`, school)}
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", content, fields)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decodeSchoolPortalData[familyImportBody](t, rec.Body.Bytes())
	assert.Empty(t, preview.Unmapped)
	require.Len(t, preview.Rows, 11)
	statuses, problems := make([]string, len(preview.Rows)), make([]string, len(preview.Rows))
	for i, row := range preview.Rows {
		statuses[i] = row.Status
		if len(row.Problems) > 0 {
			problems[i] = row.Problems[0].Field + ":" + row.Problems[0].Code
		}
	}
	assert.Equal(t, []string{"ready", "differs", "same", "invalid", "conflict", "conflict", "conflict", "invalid", "conflict", "conflict", "conflict"}, statuses,
		"a child named twice with different numbers takes over none, also not for its sibling")
	assert.Equal(t, []string{"", "", "", "child_last_name:no_contract", "children:rows_differ", "children:rows_differ",
		"child_last_name:repeated", "children:invalid", "children:rows_differ", "child_last_name:repeated", "children:rows_differ"}, problems)
	assert.Equal(t, mia, preview.Rows[0].ContractID)
	require.NotNil(t, preview.Rows[0].ValidFrom)
	assert.Equal(t, careReductionStart, *preview.Rows[0].ValidFrom, "the number counts from the first day of the contract")
	require.NotNil(t, preview.Rows[1].ConfirmedChildren)
	assert.Equal(t, 2, *preview.Rows[1].ConfirmedChildren, "the row names the number the office confirmed")
	assert.Equal(t, map[string]int{"ready": 1, "same": 1, "differs": 1, "conflict": 6, "invalid": 2, "imported": 0}, preview.Counts)
	assert.NotContains(t, rec.Body.String(), "example.org", "the answer names no address")

	rec = importForm(t, f.traeger, f.office.token, familyImportPath, "kinderzahl.csv", content, fields)
	assert.Equal(t, http.StatusConflict, rec.Code, "an import without the confirmed preview is refused: %s", rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.family_children_import_changed")
	fields["fingerprint"] = preview.Fingerprint
	rec = importForm(t, f.traeger, f.office.token, familyImportPath, "kinderzahl.csv", content, fields)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	applied := decodeSchoolPortalData[familyImportBody](t, rec.Body.Bytes())
	assert.True(t, applied.Applied)
	assert.Equal(t, 1, applied.Counts["imported"])
	assert.Equal(t, "imported", applied.Rows[0].Status)

	var stored []struct {
		Family   string  `bun:"family_email"`
		Children int     `bun:"confirmed_children"`
		From     string  `bun:"valid_from"`
		Until    *string `bun:"valid_until"`
		Account  *int64  `bun:"confirmed_by_account_id"`
	}
	require.NoError(t, f.db.NewRaw(`SELECT family_email, confirmed_children, valid_from::text, valid_until::text, confirmed_by_account_id
		FROM parent_billing.family_child_counts WHERE organization_id = ? ORDER BY care_contract_id`, f.office.organization).Scan(ctx, &stored))
	require.Len(t, stored, 3, "Mia's number is new; Noah's and Lia's stay; the siblings that disagree get none")
	assert.Equal(t, fmt.Sprintf("contract:%d", mia), stored[0].Family)
	assert.Equal(t, 2, stored[0].Children)
	assert.Equal(t, careReductionStart, stored[0].From)
	assert.Nil(t, stored[0].Until)
	assert.NotNil(t, stored[0].Account, "the number is confirmed by the account that imported it")
	assert.Equal(t, 2, stored[1].Children, "a confirmed number is never overwritten")
	var trail []string
	require.NoError(t, f.db.NewRaw(`SELECT action || ':' || actor || ':' || children FROM parent_billing.family_child_count_events
		WHERE organization_id = ? AND care_contract_id = ? AND action = 'confirm'`, f.office.organization, mia).Scan(ctx, &trail))
	assert.Equal(t, []string{"confirm:office:2"}, trail, "the import stands in the trail of the contract")

	// A second import of the same file adds nothing.
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", content, fields)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "same", decodeSchoolPortalData[familyImportBody](t, rec.Body.Bytes()).Rows[0].Status)

	run := f.startRun(t, careMonth)
	review := decodeSchoolPortalData[careReductionRunBody](t, traegerJSON(t, f.traeger, f.office.token, http.MethodGet,
		careRunPath(int64(run.ID), ""), nil).Body.Bytes())
	for _, invoice := range review.Invoices {
		if int64(invoice.ContractID) == mia {
			assert.Equal(t, int64(3875), invoice.TotalCents, "Mia is the 2nd child of two: 77,50 € − 50 %")
		}
	}
	assert.Equal(t, 2, review.UncountedFamilies, "both pairs of siblings whose rows disagree still wait for a number")
}

// The import refuses what is no file of numbers, needs the right
// "Abrechnung" and finds no contract of another Träger.
func TestFamilyChildrenImportIsCheckedAndNeedsTheRight(t *testing.T) {
	t.Parallel()
	f := newCareBillingFixture(t, "Träger Kinderzahl Datei Prüfung")
	school := f.office.schools[0]
	careContract(t, f.db, f.office.organization, school, "Mia", careReductionStart, sjrServices()...)
	file := []byte("Vorname;Nachname;Kinderzahl\nMia;Beispiel;2\n")

	rec := importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.pdf", file, nil)
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.family_children_import_file_invalid")
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", []byte{0x00, 0x01, 0x02}, nil)
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", file,
		map[string]string{"mapping": `{"columns":{"child_first_name":"Vorname","child_last_name":"Gibt es nicht","children":"Kinderzahl"}}`})
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "parent_billing.family_children_import_mapping_invalid")
	// A school of another Träger is no school of the file.
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", file,
		map[string]string{"mapping": `{"columns":{"child_first_name":"Vorname","child_last_name":"Nachname","children":"Kinderzahl"},"school_id":999999999}`})
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())

	// A file without a column for the number names the gap and reads no row;
	// importing it is refused.
	unmapped := []byte("Vorname;Nachname;Irgendwas\nMia;Beispiel;2\n")
	rec = importForm(t, f.traeger, f.office.token, familyImportPreviewPath, "kinderzahl.csv", unmapped, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	gap := decodeSchoolPortalData[familyImportBody](t, rec.Body.Bytes())
	assert.Equal(t, []string{"children", "school"}, gap.Unmapped)
	assert.Empty(t, gap.Rows)
	rec = importForm(t, f.traeger, f.office.token, familyImportPath, "kinderzahl.csv", unmapped, nil)
	assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())

	foreign := newTraegerOffice(t, f.db, f.traeger, "Träger Kinderzahl Datei Fremd", identityaccess.TraegerRoleBilling)
	testpkg.OwnTraegerCareContracts(t, f.db, foreign.organization)
	rec = importForm(t, f.traeger, foreign.token, familyImportPreviewPath, "kinderzahl.csv", file, map[string]string{"mapping": fmt.Sprintf(
		`{"columns":{"child_first_name":"Vorname","child_last_name":"Nachname","children":"Kinderzahl"},"school_id":%d}`, foreign.schools[0])})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	other := decodeSchoolPortalData[familyImportBody](t, rec.Body.Bytes())
	require.Len(t, other.Rows, 1)
	assert.Equal(t, "invalid", other.Rows[0].Status, "another Träger finds no contract of the child")
	assert.Zero(t, other.Rows[0].ContractID)

	password := testpkg.NewTestPassword()
	account := traegerAccount(t, f.db, password)
	testpkg.CreateTestTraegerMember(t, f.db, f.office.organization, account.ID, identityaccess.TraegerRoleAdministration)
	code, answer := traegerSignIn(t, f.traeger, account.Email, password, 0)
	require.Equal(t, http.StatusOK, code)
	for _, path := range []string{familyImportPreviewPath, familyImportPath} {
		rec = importForm(t, f.traeger, answer.AccessToken, path, "kinderzahl.csv", file, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, "%s without the right: %s", path, rec.Body.String())
	}
}
