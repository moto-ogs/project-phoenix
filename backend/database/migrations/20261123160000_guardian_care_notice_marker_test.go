package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestGuardianCareNoticeMarkerKeepsItsShape pins 20261123160000 (#7760): the
// access row of a guardian carries an optional instant of the care notice,
// and the request role, which writes it in the bulk invitation, may set it
// under the row-level security of the table.
func TestGuardianCareNoticeMarkerKeepsItsShape(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()

	var dataType, nullable string
	require.NoError(t, db.NewRaw(`SELECT data_type, is_nullable FROM information_schema.columns
		WHERE table_schema = 'auth' AND table_name = 'guardian_student_access' AND column_name = 'care_notice_sent_at'`).
		Scan(ctx, &dataType, &nullable))
	assert.Equal(t, "timestamp with time zone", dataType)
	assert.Equal(t, "YES", nullable, "no notice yet reads as NULL")

	var updatable bool
	require.NoError(t, db.NewRaw(`SELECT has_column_privilege('phoenix_tenant', 'auth.guardian_student_access', 'care_notice_sent_at', 'UPDATE')`).
		Scan(ctx, &updatable))
	assert.True(t, updatable, "the request role stamps the notice")
}
