package owners

import (
	"testing"
	"time"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestUnobservedSchoolMembershipStampsTeacherRetirementOnItsClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	teacher := testpkg.CreateTestTeacher(t, db, "Retired", "Membership")
	now := time.Date(2030, time.May, 21, 9, 0, 0, 0, time.UTC)
	membership, err := NewSchoolMembership(testpkg.NewDatabase(t, db), func() time.Time { return now })
	require.NoError(t, err)
	require.NoError(t, membership.DeleteTeacher(ctx, teacher.ID))

	var retiredAt time.Time
	require.NoError(t, db.NewRaw(`SELECT deleted_at FROM users.teachers
		WHERE tenant_id = ? AND id = ?`, testpkg.Tenant(t), teacher.ID).Scan(ctx, &retiredAt))
	require.True(t, retiredAt.Equal(now), "the retirement stamp uses the injected owner clock")
}
