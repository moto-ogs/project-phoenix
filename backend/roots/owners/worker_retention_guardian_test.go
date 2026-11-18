package owners

import (
	"context"
	"testing"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// childlessGuardian dates a contact on the People Directory clock.
// Identity & Access dates invitation expiry on the database clock (ADR 0285).
func (s retentionSuite) childlessGuardian(t *testing.T, tenantID int64, email string, daysAgo int) int64 {
	t.Helper()
	return s.insertID(t, `INSERT INTO users.guardian_profiles (tenant_id, first_name, last_name, email, childless_since)
		VALUES (?, 'Ohne', 'Kind', ?, ROOT_NOW - make_interval(days => ?)) RETURNING id`, tenantID, email, daysAgo)
}

// The nightly run deletes a parent contact 90 days after its last child went
// (#4043), with its phone numbers, payment data and spent invitations. A
// contact with an open invitation, a younger one, one with a child and one
// of another school stay.
func TestNightlyRetentionDeletesParentContactsWithoutAChild(t *testing.T) {
	t.Parallel()
	suite := newRetentionSuite(t)
	school := testpkg.Tenant(t)
	otherSchool, _ := testpkg.CreateTestTenant(t, suite.admin)
	inviter := testpkg.CreateTestAccount(t, suite.admin, "guardian-retention-inviter")
	databaseNow := testpkg.DatabaseNow(t, suite.admin)

	expired := suite.childlessGuardian(t, school, "retention-expired@example.com", 91)
	phone := suite.insertID(t, `INSERT INTO users.guardian_phone_numbers (tenant_id, guardian_profile_id, phone_number)
		VALUES (?, ?, '0123 456') RETURNING id`, school, expired)
	payment := suite.insertID(t, `INSERT INTO users.guardian_financial_data (tenant_id, guardian_profile_id, iban_sealed, iban_masked)
		VALUES (?, ?, '\x01', '•••• 2051') RETURNING id`, school, expired)
	spent := suite.insertID(t, `INSERT INTO auth.guardian_invitations (tenant_id, token, guardian_profile_id, created_by, expires_at)
		VALUES (?, encode(sha256('retention-spent'::bytea), 'hex'), ?, ?, ?) RETURNING id`, school, expired, inviter.ID, databaseNow.Add(-time.Hour))
	invited := suite.childlessGuardian(t, school, "retention-invited@example.com", 91)
	suite.insertID(t, `INSERT INTO auth.guardian_invitations (tenant_id, token, guardian_profile_id, created_by, expires_at)
		VALUES (?, encode(sha256('retention-open'::bytea), 'hex'), ?, ?, ?) RETURNING id`, school, invited, inviter.ID, databaseNow.Add(48*time.Hour))
	recent := suite.childlessGuardian(t, school, "retention-recent@example.com", 89)
	linked := testpkg.CreateTestGuardianProfileForTenant(t, suite.admin, school, "Mit", "Kind", "retention-linked")
	child := testpkg.CreateTestStudentForTenant(t, suite.admin, school, "Bleibt", "Kind", "1a")
	testpkg.CreateTestStudentGuardianLinkForTenant(t, suite.admin, school, child.ID, linked.ID, "primary_guardian")
	elsewhere := suite.childlessGuardian(t, otherSchool, "retention-elsewhere@example.com", 91)

	suite.run(t, school)

	assert.False(t, suite.exists(t, "users.guardian_profiles", expired), "a contact 91 days without a child is deleted")
	assert.False(t, suite.exists(t, "users.guardian_phone_numbers", phone))
	assert.False(t, suite.exists(t, "users.guardian_financial_data", payment))
	assert.False(t, suite.exists(t, "auth.guardian_invitations", spent))
	assert.True(t, suite.exists(t, "users.guardian_profiles", invited), "an open invitation keeps its contact")
	assert.True(t, suite.exists(t, "users.guardian_profiles", recent), "a contact 89 days without a child stays")
	assert.True(t, suite.exists(t, "users.guardian_profiles", linked.ID), "a contact with a child stays")
	assert.True(t, suite.exists(t, "users.guardian_profiles", elsewhere), "the run of one school never touches another")
	assert.Equal(t, []int{1}, suite.loggedDeletions(t, school, auditModels.DeletionTypeGuardianRetention))
	assert.Empty(t, suite.loggedDeletions(t, otherSchool, auditModels.DeletionTypeGuardianRetention))
}

// The retention keeps a contact for an invitation exactly as long as
// Identity & Access, which judged the expiry on the database clock, calls
// it open (#7295). The expiries lie on pinned database days far from the
// Go clock in both directions: a link issued on a database clock behind Go
// is still valid, and one that ran out on a database clock ahead of Go has
// expired. Judging ExpiresAt on the Go clock deleted the first contact,
// with the valid link, and kept the second.
func TestGuardianRetentionJudgesOpenInvitationsAsIdentityDelivers(t *testing.T) {
	t.Parallel()
	behind := time.Date(2000, time.March, 6, 10, 30, 0, 0, time.UTC)
	ahead := time.Date(2100, time.March, 6, 10, 30, 0, 0, time.UTC)
	identity := stubGuardianInvitationReader{
		{ID: 1, GuardianProfileID: 10, ExpiresAt: behind.Add(48 * time.Hour), Expired: false},
		{ID: 2, GuardianProfileID: 20, ExpiresAt: ahead.Add(-time.Hour), Expired: true},
	}

	invited, err := openGuardianInvitations(identity)(context.Background(), []int64{10, 20})

	require.NoError(t, err)
	assert.Equal(t, map[int64]bool{10: true}, invited,
		"the still-valid link keeps its contact, the expired one does not")
}
