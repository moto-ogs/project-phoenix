package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sequenceUpdateWithoutInsertSQL lists the runtime roles that may move a
// sequence (UPDATE, so setval) although they cannot insert into the table
// that owns it. Such a right serves no write of the role; setval can make
// the next write collide with a kept row (#4845).
const sequenceUpdateWithoutInsertSQL = `
SELECT seq.relnamespace::regnamespace::text || '.' || seq.relname || ' ' || role.rolname
FROM pg_class AS seq
JOIN pg_depend AS dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
JOIN pg_class AS tab ON tab.oid = dep.refobjid
JOIN pg_roles AS role ON role.rolname IN ('phoenix_admin', 'phoenix_tenant', 'phoenix_auth')
WHERE seq.relkind = 'S'
  AND has_sequence_privilege(role.oid, seq.oid, 'UPDATE')
  AND NOT has_table_privilege(role.oid, tab.oid, 'INSERT')
ORDER BY 1`

// The billing figures and the PWA usage are written by SECURITY DEFINER
// functions, so no runtime role holds a right on their sequences (#7210).
func TestWriterOwnedSequencesHaveNoRuntimeRights(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	acls := func() []string {
		var rows []string
		require.NoError(t, db.NewRaw(`SELECT relnamespace::regnamespace::text || '.' || relname || ' ' || coalesce(relacl::text, '')
			FROM unnest(ARRAY['platform.billing_key_date_counts_id_seq', 'iot.pwa_standalone_usage_id_seq']::regclass[]) AS seq
			JOIN pg_class ON pg_class.oid = seq ORDER BY 1`).Scan(ctx, &rows))
		return rows
	}
	revoked := []string{
		"iot.pwa_standalone_usage_id_seq {postgres=rwU/postgres}",
		"platform.billing_key_date_counts_id_seq {postgres=rwU/postgres}",
	}
	assert.Equal(t, revoked, acls())

	var movable []string
	require.NoError(t, db.NewRaw(sequenceUpdateWithoutInsertSQL).Scan(ctx, &movable))
	assert.Empty(t, movable, "a runtime role can move a sequence it never writes through")

	require.NoError(t, billingCountSequenceGrantsDown(ctx, db))
	assert.Equal(t, []string{
		"iot.pwa_standalone_usage_id_seq {postgres=rwU/postgres,phoenix_admin=rwU/postgres,phoenix_tenant=U/postgres}",
		"platform.billing_key_date_counts_id_seq {postgres=rwU/postgres,phoenix_admin=rwU/postgres}",
	}, acls())
	require.NoError(t, billingCountSequenceGrantsUp(ctx, db))
	assert.Equal(t, revoked, acls())

	// The operator still captures through the writer, which draws the ID.
	conn, err := db.Conn(ctx)
	require.NoError(t, err)
	defer func() { _ = conn.Close() }()
	_, err = conn.ExecContext(ctx, `SET ROLE phoenix_admin`)
	require.NoError(t, err)
	defer func() { _, _ = conn.ExecContext(ctx, `RESET ROLE`) }()
	var inserted int64
	require.NoError(t, conn.NewRaw(`SELECT platform.capture_billing_key_date_counts(ARRAY[?]::bigint[], ARRAY['2026-10-01'], ARRAY['2026-10-15'],
		ARRAY['Schule'], ARRAY['Träger'], ARRAY[3], ARRAY[1])`, testpkg.Tenant(t)).Scan(ctx, &inserted))
	assert.EqualValues(t, 1, inserted)
	_, err = conn.ExecContext(ctx, `SELECT setval('platform.billing_key_date_counts_id_seq', 1)`)
	require.Error(t, err, "the operator cannot move the sequence")
}
