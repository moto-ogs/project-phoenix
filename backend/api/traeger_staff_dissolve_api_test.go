package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// staffSealSchoolValue seals a bank or tax value for a school's row as the
// school would.
func staffSealSchoolValue(t *testing.T, field string, schoolID, staffID int64, value string) []byte {
	t.Helper()
	cipher, err := BankDataCipher(viper.GetString("bank_data_keys"), "")
	require.NoError(t, err)
	sealed, err := cipher.Seal([]byte(value), []byte("users.staff_financial_data."+field+"|"+strconv.FormatInt(schoolID, 10)+"|"+strconv.FormatInt(staffID, 10)))
	require.NoError(t, err)
	return sealed
}

// staffOpenSchoolValue opens a value of a school's row.
func staffOpenSchoolValue(t *testing.T, field string, schoolID, staffID int64, sealed []byte) string {
	t.Helper()
	cipher, err := BankDataCipher(viper.GetString("bank_data_keys"), "")
	require.NoError(t, err)
	plain, err := cipher.Open(sealed, []byte("users.staff_financial_data."+field+"|"+strconv.FormatInt(schoolID, 10)+"|"+strconv.FormatInt(staffID, 10)))
	require.NoError(t, err)
	return string(plain)
}

// staffSchoolBankRow is the stored bank row of one employment.
type staffSchoolBankRow struct {
	IBANMasked  *string `bun:"iban_masked"`
	TaxIDSealed []byte  `bun:"tax_id_sealed"`
}

func staffSchoolBank(t *testing.T, db *bun.DB, staffID int64) staffSchoolBankRow {
	t.Helper()
	var row staffSchoolBankRow
	require.NoError(t, db.NewRaw(`SELECT iban_masked, tax_id_sealed FROM users.staff_financial_data WHERE staff_id = ?`, staffID).Scan(context.Background(), &row))
	return row
}

// When the Träger dissolves a record, per field the newer entry wins
// (#8029): a row the link held back keeps the school's values except where
// the Personalverwaltung changed the field afterwards; a row from before the
// link loses every field to the record. Each change at a school stands in
// its master data audit.
func TestTraegerStaffDissolveKeepsTheNewerValuePerField(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	north, south := office.schools[0], office.schools[1]
	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	staffSetIBAN(t, db, north, miraNorth.ID, "DE89370400440532013000")
	staffRelease(t, db, office.organization)

	rec := traegerLink(t, router, office.token, map[string]any{"members": []map[string]string{
		{"school_id": fmt.Sprint(north), "staff_id": fmt.Sprint(miraNorth.ID)}, {"school_id": fmt.Sprint(south), "staff_id": fmt.Sprint(miraSouth.ID)},
	}})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	record := decode[staffRecordBody](t, rec)

	// South holds a row stamped after the link, as a hold leaves it, with
	// its own IBAN and tax ID.
	_, err := db.ExecContext(context.Background(), `INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked, tax_id_sealed) VALUES (?, ?, ?, '•••• 2051', ?)`,
		south, miraSouth.ID, staffSealSchoolValue(t, "iban", south, miraSouth.ID, "DE02120300000000202051"), staffSealSchoolValue(t, "tax_id", south, miraSouth.ID, "12345678901"))
	require.NoError(t, err)
	// The Personalverwaltung then changes the IBAN only.
	rec = traegerUpdateFinancial(t, router, office.token, record.ID, map[string]any{"iban": "DE75512108001245126199"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// North keeps a row from before the link, one a failed hand-over left
	// and no catch-up reached since.
	_, err = db.ExecContext(context.Background(), `INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked, tax_id_sealed) VALUES (?, ?, ?, '•••• 4711', ?)`,
		north, miraNorth.ID, staffSealSchoolValue(t, "iban", north, miraNorth.ID, "DE12500105170648494711"), staffSealSchoolValue(t, "tax_id", north, miraNorth.ID, "55555555555"))
	require.NoError(t, err)
	_, err = db.ExecContext(context.Background(), `UPDATE workforce.staff_record_links SET linked_at = linked_at + interval '1 day' WHERE school_id = ? AND membership_id = ?`, north, miraNorth.ID)
	require.NoError(t, err)

	rec = traegerJSON(t, router, office.token, http.MethodDelete, fmt.Sprintf("/traeger/staff-records/%d", record.ID), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	southRow := staffSchoolBank(t, db, miraSouth.ID)
	assert.Equal(t, "•••• 6199", *southRow.IBANMasked, "the IBAN changed after the hold comes from the record")
	assert.Equal(t, "12345678901", staffOpenSchoolValue(t, "tax_id", south, miraSouth.ID, southRow.TaxIDSealed), "the tax ID nobody changed since stays the school's")
	northRow := staffSchoolBank(t, db, miraNorth.ID)
	assert.Equal(t, "•••• 6199", *northRow.IBANMasked, "a row from before the link takes the record's IBAN")
	assert.Empty(t, northRow.TaxIDSealed, "and its empty tax ID")

	returned := `SELECT COUNT(*) FROM audit.staff_master_data_changes WHERE tenant_id = ? AND staff_id = ? AND note = 'Personalakte des Trägers aufgelöst, Werte an die Schule zurückgegeben'`
	assert.Equal(t, 1, staffSchoolValue(t, db, returned, south, miraSouth.ID), "south logs its one changed field")
	assert.Equal(t, 2, staffSchoolValue(t, db, returned, north, miraNorth.ID), "north logs IBAN and tax ID")
}
