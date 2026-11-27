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

// TestTraegerOpeningChangesFollowTheTraegerPolicy pins the row security of
// the Träger's opening changes (#8202): a Träger transaction sees and writes
// only its own rows, a school transaction reads only the rows naming it while
// it belongs to the row's Träger (ADR 0194) and writes none, and only
// undeleted schools of the row's Träger can be named.
func TestTraegerOpeningChangesFollowTheTraegerPolicy(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	newTraeger := func(name string) (int64, int64, int64) {
		slug := fmt.Sprintf("traeger-oeffnung-%d", testpkg.UniqueTestTenantID(t))
		organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: name, Slug: slug}).ID
		testpkg.OwnTraegerOpeningChanges(t, db, organization)
		return organization, testpkg.CreateTestSchoolInOrganization(t, db, organization, name+" OGS A"),
			testpkg.CreateTestSchoolInOrganization(t, db, organization, name+" OGS B")
	}
	own, named, unnamed := newTraeger("Träger Öffnung Eigen")
	foreign, foreignSchool, _ := newTraeger("Träger Öffnung Fremd")
	const insert = `INSERT INTO schedule.traeger_opening_changes (organization_id, start_date, end_date, opens_at, closes_at, reason, school_ids)
		VALUES (?, '2027-05-14', '2027-05-14', '07:30', '12:00', ?, ?::bigint[])`
	ids := func(values ...int64) string {
		text := "{"
		for i, value := range values {
			if i > 0 {
				text += ","
			}
			text += fmt.Sprint(value)
		}
		return text + "}"
	}

	var change int64
	require.NoError(t, db.NewRaw(insert+` RETURNING id`, own, "Zeugnisausgabe", ids(named)).Scan(ctx, &change))
	_, err := db.ExecContext(ctx, insert, own, "Fremd", ids(foreignSchool))
	assert.ErrorContains(t, err, "is not a school of Träger", "a foreign school cannot be named")
	_, err = db.ExecContext(ctx, insert, own, "Doppelt", ids(named, named))
	assert.ErrorContains(t, err, "named twice", "a school is named once")
	_, err = db.ExecContext(ctx, `UPDATE schedule.traeger_opening_changes SET closes_at = '07:00' WHERE id = ?`, change)
	assert.ErrorContains(t, err, "chk_traeger_opening_changes_hours", "the closing time follows the opening time")

	asRequestRole := func(setting, value string, fn func(bun.Tx) error) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `SET LOCAL ROLE phoenix_tenant`); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `SELECT set_config(?, ?, true)`, setting, value); err != nil {
				return err
			}
			return fn(tx)
		})
	}
	count := func(setting, value string) int {
		var visible int
		require.NoError(t, asRequestRole(setting, value, func(tx bun.Tx) error {
			return tx.NewRaw(`SELECT COUNT(*) FROM schedule.traeger_opening_changes WHERE organization_id = ?`, own).Scan(ctx, &visible)
		}))
		return visible
	}
	assert.Equal(t, 1, count("app.current_org_id", fmt.Sprint(own)), "the Träger sees its opening change")
	assert.Zero(t, count("app.current_org_id", fmt.Sprint(foreign)), "another Träger sees nothing")
	assert.Equal(t, 1, count("app.current_tenant_id", fmt.Sprint(named)), "the named school reads the opening change")
	assert.Zero(t, count("app.current_tenant_id", fmt.Sprint(unnamed)), "a school of the Träger that is not named reads nothing")
	assert.Zero(t, count("app.current_tenant_id", fmt.Sprint(foreignSchool)), "a school of another Träger reads nothing")

	err = asRequestRole("app.current_tenant_id", fmt.Sprint(named), func(tx bun.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE schedule.traeger_opening_changes SET reason = 'Schule' WHERE id = ?`, change)
		if err != nil {
			return err
		}
		if rows, err := result.RowsAffected(); err != nil || rows != 0 {
			return fmt.Errorf("the school changed %d rows: %w", rows, err)
		}
		return nil
	})
	assert.NoError(t, err, "a named school changes no row of its Träger")
	err = asRequestRole("app.current_tenant_id", fmt.Sprint(named), func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, insert, own, "Schule", ids(named))
		return err
	})
	assert.Equal(t, "42501", testpkg.PostgresSQLState(err), "a school cannot write an opening change of its Träger")
	err = asRequestRole("app.current_org_id", fmt.Sprint(foreign), func(tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, insert, own, "Fremd", ids(named))
		return err
	})
	assert.Equal(t, "42501", testpkg.PostgresSQLState(err), "a Träger cannot write an opening change for another Träger")
	_, err = db.ExecContext(ctx, `UPDATE platform.schools SET organization_id = ? WHERE id = ?`, foreign, named)
	require.NoError(t, err)
	assert.Zero(t, count("app.current_tenant_id", fmt.Sprint(named)), "a transferred school no longer reads the former Träger's opening changes")
}
