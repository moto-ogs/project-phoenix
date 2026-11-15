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

// TestTraegerReportTemplatesStayWithTheirTraeger pins ADR 0242 on
// platform.traeger_report_templates: under the request role a Träger reads,
// writes and deletes only its own templates and a school transaction sees
// none; a name exists once per Träger without case; only the four sections
// and real days of a month (29 February included) are stored.
func TestTraegerReportTemplatesStayWithTheirTraeger(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	newTraeger := func(name string) int64 {
		slug := fmt.Sprintf("traeger-bericht-%d", testpkg.UniqueTestTenantID(t))
		organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: name, Slug: slug}).ID
		testpkg.OwnTraegerMasterData(t, db, organization)
		return organization
	}
	own, foreign := newTraeger("Träger Bericht Eigen"), newTraeger("Träger Bericht Fremd")
	asTraeger := func(organization int64, fn func(bun.Tx) error) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `SET LOCAL ROLE phoenix_tenant`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_org_id', ?, true)`, fmt.Sprint(organization)); err != nil {
				return err
			}
			return fn(tx)
		})
	}
	insert := `INSERT INTO platform.traeger_report_templates (organization_id, name, sections, key_date_month, key_date_day)
		VALUES (?, ?, ?::text[], ?, ?)`
	require.NoError(t, asTraeger(own, func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, insert, own, "Jugendamt", "{children,demand}", 2, 29)
		return err
	}), "the request role adds a template of its Träger, 29 February included")
	assert.Error(t, asTraeger(foreign, func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, insert, own, "Fremd", "{staff}", 1, 1)
		return err
	}), "another Träger adds no template for this one")
	var seen int
	require.NoError(t, asTraeger(foreign, func(tx bun.Tx) error {
		return tx.NewRaw(`SELECT COUNT(*) FROM platform.traeger_report_templates WHERE organization_id = ?`, own).Scan(ctx, &seen)
	}))
	assert.Zero(t, seen, "another Träger sees nothing")
	require.NoError(t, asTraeger(foreign, func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `DELETE FROM platform.traeger_report_templates WHERE organization_id = ?`, own)
		return err
	}))
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM platform.traeger_report_templates WHERE organization_id = ?`, own).Scan(ctx, &seen))
	assert.Equal(t, 1, seen, "another Träger deletes nothing")

	for name, row := range map[string][]any{
		"name twice without case": {own, "JUGENDAMT", "{staff}", 1, 1},
		"unknown section":         {own, "Budget", "{budget}", 1, 1},
		"no section":              {own, "Leer", "{}", 1, 1},
		"31 April":                {own, "April", "{staff}", 4, 31},
		"30 February":             {own, "Februar", "{staff}", 2, 30},
		"untrimmed name":          {own, " Kommune", "{staff}", 1, 1},
	} {
		_, err := db.ExecContext(ctx, insert, row...)
		assert.Error(t, err, name)
	}
	_, err := db.ExecContext(ctx, insert, foreign, "Jugendamt", "{staff}", 1, 1)
	assert.NoError(t, err, "another Träger may use the same name")
}
