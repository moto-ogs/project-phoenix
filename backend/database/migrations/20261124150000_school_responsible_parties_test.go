package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestSchoolResponsiblePartiesStayWithTheirTraeger pins ADR 0318 on
// platform.school_responsible_parties: under the request role a Träger
// reads, writes and deletes only its own bodies and a school transaction
// sees none; a school has at most one Schulträger and one Gemeinde; a body
// has a name and a German address, and a bank account names its holder.
func TestSchoolResponsiblePartiesStayWithTheirTraeger(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	newTraeger := func(name string) int64 {
		slug := fmt.Sprintf("traeger-stelle-%d", testpkg.UniqueTestTenantID(t))
		organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: name, Slug: slug}).ID
		testpkg.OwnTraegerMasterData(t, db, organization)
		return organization
	}
	own, foreign := newTraeger("Träger Stelle Eigen"), newTraeger("Träger Stelle Fremd")
	school := testpkg.UniqueTestTenantID(t)
	as := func(setting string, id int64, fn func(bun.Tx) error) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `SET LOCAL ROLE phoenix_tenant`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `SELECT set_config(?, ?, true)`, setting, fmt.Sprint(id)); err != nil {
				return err
			}
			return fn(tx)
		})
	}
	asTraeger := func(organization int64, fn func(bun.Tx) error) error {
		return as("app.current_org_id", organization, fn)
	}
	insert := `INSERT INTO platform.school_responsible_parties
		(organization_id, school_id, kind, name, street, postal_code, city, account_holder, iban)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	require.NoError(t, asTraeger(own, func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, insert, own, school, "gemeinde", "Gemeinde Hardt", "Rathausplatz 1", "41749", "Viersen", "Gemeinde Hardt", "DE02120300000000202051")
		return err
	}), "the request role stores a body of its Träger")
	assert.Error(t, asTraeger(foreign, func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, insert, own, school, "schultraeger", "Fremd", "Markt 2", "47798", "Krefeld", "", "")
		return err
	}), "another Träger stores no body for this one")
	count := func(tx bun.IDB) (seen int) {
		require.NoError(t, tx.NewRaw(`SELECT COUNT(*) FROM platform.school_responsible_parties WHERE organization_id = ?`, own).Scan(ctx, &seen))
		return seen
	}
	require.NoError(t, asTraeger(foreign, func(tx bun.Tx) error {
		assert.Zero(t, count(tx), "another Träger sees nothing")
		_, err := tx.ExecContext(ctx, `DELETE FROM platform.school_responsible_parties WHERE organization_id = ?`, own)
		return err
	}))
	require.NoError(t, as("app.current_tenant_id", school, func(tx bun.Tx) error {
		assert.Zero(t, count(tx), "the school's own transaction sees no body: bank accounts stay in the Träger-Büro")
		return nil
	}))
	assert.Equal(t, 1, count(db), "another Träger deletes nothing")

	for name, row := range map[string][]any{
		"a second Gemeinde of the school": {own, school, "gemeinde", "Gemeinde Zwei", "Markt 1", "41749", "Viersen", "", ""},
		"the Träger is no body here":      {own, school, "traeger", "Träger", "Markt 1", "41749", "Viersen", "", ""},
		"no name":                         {own, school, "schultraeger", "", "Markt 1", "41749", "Viersen", "", ""},
		"no street":                       {own, school, "schultraeger", "Stadt", "", "41749", "Viersen", "", ""},
		"a postal code of four digits":    {own, school, "schultraeger", "Stadt", "Markt 1", "4174", "Viersen", "", ""},
		"an account without its holder":   {own, school, "schultraeger", "Stadt", "Markt 1", "41749", "Viersen", "", "DE02120300000000202051"},
		"a holder without an account":     {own, school, "schultraeger", "Stadt", "Markt 1", "41749", "Viersen", "Stadt", ""},
	} {
		_, err := db.ExecContext(ctx, insert, row...)
		assert.Error(t, err, name)
	}
	_, err := db.ExecContext(ctx, insert, own, school, "schultraeger", "Stadt Viersen", "Bahnhofstraße 23", "41747", "Viersen", "", "")
	assert.NoError(t, err, "the school has one Schulträger beside its Gemeinde")
}
