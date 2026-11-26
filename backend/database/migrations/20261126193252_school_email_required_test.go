package migrations

import (
	"context"
	"fmt"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// A school without a contact address stops the migration with its ID, the
// soft-deleted one included, and nothing is filled in. Once every school has
// an address, the column rejects a missing and a blank one; the down
// migration takes both rules back (#7434).
func TestSchoolEmailRequiredStopsOnSchoolsWithoutAddress(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	require.NoError(t, schoolEmailRequiredDown(ctx, db))

	insertSchool := func(slug string, email any, deleted bool) (int64, error) {
		var id int64
		err := db.NewRaw(`INSERT INTO platform.schools (organization_id, name, slug, subdomain, email, deleted_at)
			VALUES (1, ?, ?, ?, ?, CASE WHEN ? THEN NOW() END) RETURNING id`, slug, slug, slug, email, deleted).Scan(ctx, &id)
		return id, err
	}
	deletedWithout, err := insertSchool("ohne-adresse-geloescht", nil, true)
	require.NoError(t, err)
	blank, err := insertSchool("leere-adresse", "  ", false)
	require.NoError(t, err)

	err = schoolEmailRequiredUp(ctx, db)
	require.Error(t, err)
	assert.Contains(t, err.Error(), fmt.Sprintf("2 school(s) have no contact address (IDs {%d,%d})", deletedWithout, blank))
	assert.Equal(t, 2, countSchoolsWithoutEmail(ctx, t, db), "the migration fills in nothing")

	_, err = db.NewRaw(`UPDATE platform.schools SET email = 'kontakt@' || subdomain || '.example.test' WHERE id IN (?, ?)`,
		deletedWithout, blank).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, schoolEmailRequiredUp(ctx, db))

	_, err = insertSchool("ohne-adresse", nil, false)
	require.ErrorContains(t, err, "null value in column \"email\"")
	_, err = insertSchool("leer", "   ", false)
	require.ErrorContains(t, err, "schools_email_not_blank")

	require.NoError(t, schoolEmailRequiredDown(ctx, db))
	_, err = insertSchool("wieder-ohne-adresse", nil, false)
	require.NoError(t, err, "the down migration allows a school without address again")
}

func countSchoolsWithoutEmail(ctx context.Context, t *testing.T, db *bun.DB) int {
	t.Helper()
	var n int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.schools WHERE email IS NULL OR btrim(email) = ''`).Scan(ctx, &n))
	return n
}
