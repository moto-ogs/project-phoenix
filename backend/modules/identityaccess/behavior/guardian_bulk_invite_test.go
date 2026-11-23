package behavior_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The bulk invitation (#3378) against the real tables: one guardian of two
// siblings gets one invitation and one mail, a pickup-only contact is left
// alone, and a second run does not mail anybody again.
func TestBulkInviteToStudents_InvitesEachGuardianOnce(t *testing.T) {
	t.Parallel()

	outbox := api.NewCapturingOutbox()
	env := setupGuardianInvitationTest(t, func(_ *bun.DB, cfg *api.GuardianInvitationTestConfig) { cfg.Outbox = outbox })

	older := testpkg.CreateTestStudent(t, env.db, "Bulk", "Older", "3a")
	younger := testpkg.CreateTestStudent(t, env.db, "Bulk", "Younger", "1a")
	parent := testpkg.CreateTestGuardianProfileNamed(t, env.db, "Katharina", "Brenner", "bulk-parent")
	grandma := testpkg.CreateTestGuardianProfileNamed(t, env.db, "Oma", "Brenner", "bulk-grandma")
	testpkg.CreateTestStudentGuardianLink(t, env.db, older.ID, parent.ID, guardianRoleLegalGuardian)
	testpkg.CreateTestStudentGuardianLink(t, env.db, younger.ID, parent.ID, guardianRoleLegalGuardian)
	grandmaLink := testpkg.CreateTestStudentGuardianLink(t, env.db, older.ID, grandma.ID, guardianRolePickupOnly)

	ctx := testpkg.Ctx(t)
	req := identityaccess.BulkInviteRequest{StudentIDs: []int64{older.ID, younger.ID}, CreatedBy: env.inviterAccountID(t)}

	preview := req
	preview.DryRun = true
	counted, err := env.service.BulkInviteToStudents(ctx, preview)
	require.NoError(t, err)
	assert.Equal(t, 1, counted.Invited)
	assert.Empty(t, outbox.Requests(), "the preview mails nobody")

	req.ExpectedFingerprint = counted.Fingerprint
	result, err := env.service.BulkInviteToStudents(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Invited)
	assert.Equal(t, 1, result.SkippedRestricted)
	assert.Empty(t, result.Problems)
	require.Len(t, outbox.Requests(), 2, "two children, one guardian, one invitation and one welcome (#3534)")
	assert.Equal(t, emailKindGuardianInvitation, outbox.Requests()[0].Kind)
	assert.Equal(t, "guardian_welcome", outbox.Requests()[1].Kind)
	assert.Equal(t, parent.ID, outbox.Requests()[1].RelatedEntityID)
	assert.False(t, testpkg.StudentGuardianLinkGrantsPortalAccess(t, env.db, grandmaLink.ID), "the pickup-only contact is not upgraded")

	again, err := env.service.BulkInviteToStudents(ctx, previewedBulkInvite(t, env.service, req))
	require.NoError(t, err)
	assert.Zero(t, again.Invited)
	assert.Equal(t, 1, again.SkippedOpen)
	assert.Len(t, outbox.Requests(), 2, "a repeated run does not mail again")

	req.ResendOpen = true
	resent, err := env.service.BulkInviteToStudents(ctx, previewedBulkInvite(t, env.service, req))
	require.NoError(t, err)
	assert.Equal(t, 1, resent.Resent)
	mailed := outbox.Requests()
	require.Len(t, mailed, 3, "a resend mails the link alone, without a second welcome")
	assert.Equal(t, emailKindGuardianInvitation, mailed[2].Kind)
	assert.Equal(t, mailed[0].RelatedEntityID, mailed[2].RelatedEntityID, "the same invitation is mailed again")
}

// #6294: a link that works for nobody does not count as an open invitation.
// A legacy link without a recorded recipient (ended by 1.15.865) and a link
// mailed to an address since corrected both lead to a new link for the
// address on file, also without ResendOpen.
func TestBulkInviteToStudents_DeadLinksGetANewInvitation(t *testing.T) {
	t.Parallel()
	outbox := api.NewCapturingOutbox()
	env := setupGuardianInvitationTest(t, func(_ *bun.DB, cfg *api.GuardianInvitationTestConfig) { cfg.Outbox = outbox })
	creator := env.inviterAccountID(t)
	ctx := testpkg.Ctx(t)

	for _, tc := range []struct {
		name  string
		plant func(t *testing.T, profileID int64)
	}{
		{"legacy link without recipient", func(t *testing.T, profileID int64) {
			legacy := testpkg.InsertTestGuardianInvitation(t, env.db, &testpkg.GuardianInvitation{
				Token: fmt.Sprintf("bulk-legacy-%d", profileID), GuardianProfileID: profileID, CreatedBy: creator,
				ExpiresAt: time.Now().Add(-time.Hour),
			})
			_, err := env.db.NewRaw(`UPDATE auth.guardian_invitations SET email = NULL WHERE id = ?`, legacy.ID).Exec(context.Background())
			require.NoError(t, err)
		}},
		{"address corrected after the link was mailed", func(t *testing.T, profileID int64) {
			_, err := env.service.CreateGuardianInvitation(ctx, identityaccess.GuardianInvitationRequest{GuardianProfileID: profileID, CreatedBy: creator})
			require.NoError(t, err)
			env.changeGuardianEmail(t, profileID, fmt.Sprintf("bulk-corrected-%d@example.test", time.Now().UnixNano()))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			student := testpkg.CreateTestStudent(t, env.db, "Bulk", "Dead", "2c")
			profile := testpkg.CreateTestGuardianProfile(t, env.db, "bulk-dead-link")
			testpkg.CreateTestStudentGuardianLink(t, env.db, student.ID, profile.ID, guardianRoleLegalGuardian)
			tc.plant(t, profile.ID)
			current, err := testpkg.TenantQuery1(t, ctx, env.db, env.repos.GuardianProfile.FindByID, profile.ID)
			require.NoError(t, err)

			result, err := env.service.BulkInviteToStudents(ctx, previewedBulkInvite(t, env.service, identityaccess.BulkInviteRequest{StudentIDs: []int64{student.ID}, CreatedBy: creator}))
			require.NoError(t, err)
			assert.Zero(t, result.SkippedOpen, "a dead link is no open invitation")
			assert.Equal(t, 1, result.Invited)
			token := mailedToken(t, outbox, *current.Email)
			preview, err := env.service.ValidateGuardianInvitation(context.Background(), token)
			require.NoError(t, err, "the new link works for the address on file")
			assert.Equal(t, *current.Email, preview.Email)
		})
	}
}

// bulkInviter is the bulk run the dialog drives.
type bulkInviter interface {
	BulkInviteToStudents(ctx context.Context, req identityaccess.BulkInviteRequest) (*identityaccess.BulkInviteResult, error)
}

// previewedBulkInvite is req as the dialog sends it: with the fingerprint of
// the preview it showed just before (ADR 0311).
func previewedBulkInvite(t *testing.T, service bulkInviter, req identityaccess.BulkInviteRequest) identityaccess.BulkInviteRequest {
	t.Helper()
	preview := req
	preview.DryRun = true
	counted, err := service.BulkInviteToStudents(testpkg.Ctx(t), preview)
	require.NoError(t, err)
	req.ExpectedFingerprint = counted.Fingerprint
	return req
}

// The parent step (#7760, ADR 0309 section 5) against the real tables: a
// guardian with an active account who may see a child in running care gets
// one care notice through the outbox, at the login address of the account
// even when the contact address on the profile differs, the access row
// remembers it, and a second run mails nobody again. A guardian whose
// relationship does not grant parent_portal.access gets nothing, and no
// notice names a child without an approved care period, with an approved
// phase but no booking, or whose booking ended yesterday. Without the option
// nothing is mailed.
func TestBulkInviteToStudents_NotifiesAnAccountHolderOnce(t *testing.T) {
	t.Parallel()

	outbox := api.NewCapturingOutbox()
	env := setupGuardianInvitationTest(t, func(_ *bun.DB, cfg *api.GuardianInvitationTestConfig) { cfg.Outbox = outbox })
	chain := testpkg.CreateTestParentGuardianChain(t, env.db)
	withoutAccess := testpkg.CreateTestParentGuardianChain(t, env.db)
	withoutCare := testpkg.CreateTestParentGuardianChain(t, env.db)
	withoutBooking := testpkg.CreateTestParentGuardianChain(t, env.db)
	bookingEnded := testpkg.CreateTestParentGuardianChain(t, env.db)
	ctx := testpkg.Ctx(t)
	phase := testpkg.CreateTestEnrollmentPhase(t, env.db)
	offering := testpkg.CreateTestCareOffering(t, env.db, phase.ID, "Betreuung")
	// The approved child of each family; the booking decides whether the
	// parents portal lists care today. valid_until is exclusive: a booking
	// ending today ended yesterday.
	for _, family := range []struct {
		chain   testpkg.ParentChain
		booking string
	}{
		{chain, `(NULL, NULL)`},
		{withoutAccess, `(NULL, NULL)`},
		{withoutBooking, ``},
		{bookingEnded, `(CURRENT_DATE - 30, CURRENT_DATE)`},
	} {
		request := testpkg.CreateTestEnrollmentRequestAwaitingGuardian(t, env.db, phase.ID, family.chain.Email, fmt.Sprintf("care-notice-%d", testpkg.UniqueSuffix()))
		var requestChildID int64
		require.NoError(t, env.db.NewRaw(`INSERT INTO enrollment.request_children (tenant_id, request_id, first_name, last_name, date_of_birth, status, created_student_id)
			VALUES (?, ?, 'Felix', 'Schneider', '2018-04-15', 'approved', ?) RETURNING id`, family.chain.TenantID, request.ID, family.chain.StudentID).Scan(ctx, &requestChildID))
		if family.booking == "" {
			continue
		}
		_, err := env.db.NewRaw(`INSERT INTO enrollment.care_offering_bookings (tenant_id, request_child_id, care_offering_id, valid_from, valid_until)
			SELECT ?, ?, ?, b.f::date, b.u::date FROM (VALUES `+family.booking+`) AS b(f, u)`,
			family.chain.TenantID, requestChildID, offering.ID).Exec(ctx)
		require.NoError(t, err)
	}
	_, err := env.db.NewRaw(`UPDATE auth.guardian_student_access a SET permissions = '{"parent_portal.access": false}'::jsonb
		FROM users.student_guardian_relationships r
		WHERE r.id = a.relationship_id AND r.guardian_profile_id = ?`, withoutAccess.GuardianProfileID).Exec(ctx)
	require.NoError(t, err)
	_, err = env.db.NewRaw(`UPDATE users.guardian_profiles SET email = 'tippfehler@example.test' WHERE id = ?`, chain.GuardianProfileID).Exec(ctx)
	require.NoError(t, err)
	req := identityaccess.BulkInviteRequest{
		StudentIDs: []int64{chain.StudentID, withoutAccess.StudentID, withoutCare.StudentID, withoutBooking.StudentID, bookingEnded.StudentID},
		CreatedBy:  env.inviterAccountID(t),
	}

	plain, err := env.service.BulkInviteToStudents(ctx, previewedBulkInvite(t, env.service, req))
	require.NoError(t, err)
	assert.Equal(t, 5, plain.SkippedActive)
	assert.Zero(t, plain.Notified)
	assert.Empty(t, outbox.Requests(), "without the option an account holder gets nothing")

	req.NotifyActive = true
	preview := req
	preview.DryRun = true
	counted, err := env.service.BulkInviteToStudents(ctx, preview)
	require.NoError(t, err)
	assert.Equal(t, 1, counted.Notified)
	assert.Equal(t, 3, counted.WithoutVisibleCare, "no approved period, an approved phase without booking, a booking that ended yesterday")
	assert.Empty(t, outbox.Requests(), "the preview mails nobody")

	req.ExpectedFingerprint = counted.Fingerprint
	result, err := env.service.BulkInviteToStudents(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Notified)
	assert.Equal(t, 4, result.SkippedActive, "no parent_portal.access, no booked care today: only counted")
	assert.Equal(t, 3, result.WithoutVisibleCare, "the result names the children left out too")
	require.Len(t, outbox.Requests(), 1)
	mailed := outbox.Requests()[0]
	assert.Equal(t, identityaccess.MailKindGuardianCareVisible, mailed.Kind)
	assert.Equal(t, chain.GuardianProfileID, mailed.RelatedEntityID)
	assert.Equal(t, []string{"Felix"}, mailed.Payload["child_first_names"])
	assert.Equal(t, chain.Email, mailed.Payload["recipient_email"], "the account's login address, not the edited contact address")
	assert.ElementsMatch(t, []string{"recipient_email", "first_name", "last_name", "child_first_names", "school_name", "portal_url", "logo_url", "locale"},
		mapKeys(mailed.Payload), "the payload carries no account, health or contract data")
	var stamped []int64
	require.NoError(t, env.db.NewRaw(`SELECT r.student_id FROM auth.guardian_student_access a
		JOIN users.student_guardian_relationships r ON r.id = a.relationship_id
		WHERE r.student_id IN (?) AND a.care_notice_sent_at IS NOT NULL`, bun.List(req.StudentIDs)).Scan(ctx, &stamped))
	assert.Equal(t, []int64{chain.StudentID}, stamped, "only the mailed child is remembered")

	again, err := env.service.BulkInviteToStudents(ctx, previewedBulkInvite(t, env.service, req))
	require.NoError(t, err)
	assert.Zero(t, again.Notified)
	assert.Equal(t, 1, again.AlreadyNotified)
	assert.Len(t, outbox.Requests(), 1, "a second run mails nobody again")
}

func mapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
