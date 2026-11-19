package behavior_test

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The gender a school enters on the invitation reaches the Stammdaten on
// acceptance through the audited person section, exactly as an edit would;
// without one, acceptance writes no master data. A master-data reset runs
// first, so it never clears the gender again.
func TestInvitationGenderReachesTheStammdaten(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		gender *string
		resume bool
	}{
		{name: "new staff member", gender: testpkg.StrPtr("female")},
		{name: "no gender"},
		{name: "after master-data reset", gender: testpkg.StrPtr("diverse"), resume: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			testpkg.OwnTenant(t)
			db := testpkg.SetupTestDB(t)
			ctx := testpkg.Ctx(t)
			module, err := api.NewAuthTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), api.WithAuthTestMailer(testpkg.NewCapturingMailer()))
			require.NoError(t, err)
			role := testpkg.CreateTestRole(t, db, "invited-gender")
			creator := testpkg.CreateTestAccount(t, db, "gender-inviter")
			request := identityaccess.SchoolInvitationRequest{
				Email: inviteeAddress("gender"), RoleID: role.ID, CreatedBy: creator.ID, ActorPermissions: []string{usersManagePermission},
				FirstName: testpkg.StrPtr("Gerda"), LastName: testpkg.StrPtr("Gender"), Gender: tc.gender,
			}
			var formerStaffID int64
			if tc.resume {
				former, account := testpkg.CreateTestStaffWithAccount(t, db, "Gerda", "Gender")
				formerStaffID = former.ID
				for _, statement := range []string{
					`INSERT INTO users.staff_master_data (tenant_id, staff_id, gender, address_city) VALUES (?, ?, 'male', 'Köln')`,
					`UPDATE users.staff_school_memberships SET deleted_at = now() WHERE tenant_id = ? AND id = ?`,
				} {
					_, err = db.ExecContext(ctx, statement, testpkg.Tenant(t), former.ID)
					require.NoError(t, err)
				}
				_, err = db.ExecContext(ctx, `UPDATE auth.accounts SET active = FALSE WHERE id = ?`, account.ID)
				require.NoError(t, err)
				_, err = db.ExecContext(ctx, `UPDATE auth.account_tenants SET status = 'inactive', deactivated_at = now() WHERE account_id = ? AND tenant_id = ?`, account.ID, testpkg.Tenant(t))
				require.NoError(t, err)
				request.Email, request.EmploymentAction, request.ResetMasterData = account.Email, identityaccess.EmploymentActionResume, true
			}
			invitation, err := module.Invitation.CreateSchoolInvitation(ctx, request)
			require.NoError(t, err)
			require.Equal(t, tc.gender, invitation.Gender)
			pending, err := module.Invitation.ListPendingSchoolInvitations(ctx)
			require.NoError(t, err)
			require.Len(t, pending, 1)
			require.Equal(t, tc.gender, pending[0].Gender, "the stored invitation keeps the gender")

			account, err := module.Invitation.AcceptSchoolInvitation(context.Background(), invitation.Token, identityaccess.InvitationRegistration{Password: invitationPassword, ConfirmPassword: invitationPassword})
			require.NoError(t, err)
			if !tc.resume {
				testpkg.OwnTestAccount(t, db, account.ID)
			}
			staffID := acceptedStaffID(t, db, account.ID)
			if tc.resume {
				require.Equal(t, formerStaffID, staffID)
			}
			var stored []struct {
				Gender      *string
				AddressCity *string
			}
			require.NoError(t, db.NewRaw(`SELECT gender, address_city FROM users.staff_master_data WHERE staff_id = ?`, staffID).Scan(ctx, &stored))
			var audits []struct {
				Section  string
				OldValue string
				NewValue string
				Note     string
			}
			require.NoError(t, db.NewRaw(`SELECT section, coalesce(old_value, '') AS old_value, coalesce(new_value, '') AS new_value, coalesce(note, '') AS note FROM audit.staff_master_data_changes WHERE staff_id = ? AND field_name = 'gender' ORDER BY id`, staffID).Scan(ctx, &audits))
			var nameAudits int
			require.NoError(t, db.NewRaw(`SELECT count(*) FROM audit.staff_master_data_changes WHERE staff_id = ? AND field_name IN ('first_name', 'last_name', 'birthday')`, staffID).Scan(ctx, &nameAudits))
			require.Zero(t, nameAudits, "setting the gender leaves names and birthday alone")
			if tc.gender == nil {
				require.Empty(t, stored, "no gender, no master data")
				require.Empty(t, audits)
				return
			}
			require.Len(t, stored, 1)
			require.Equal(t, *tc.gender, *stored[0].Gender)
			if tc.resume {
				require.Nil(t, stored[0].AddressCity, "the reset still clears the rest of the master data")
				// The reset clears the old gender, then the invitation sets the new one.
				require.Len(t, audits, 2)
				require.Equal(t, "male", audits[0].OldValue)
				require.Empty(t, audits[0].NewValue)
			} else {
				require.Len(t, audits, 1)
			}
			last := audits[len(audits)-1]
			require.Equal(t, "person", last.Section)
			require.Empty(t, last.OldValue)
			require.Equal(t, *tc.gender, last.NewValue)
			require.Contains(t, last.Note, "Einladung")
		})
	}
}

func acceptedStaffID(t *testing.T, db *bun.DB, accountID int64) int64 {
	t.Helper()
	var staffID int64
	require.NoError(t, db.NewRaw(`SELECT m.id FROM users.staff_school_memberships m JOIN users.persons p ON p.id = m.person_id WHERE p.account_id = ? AND m.tenant_id = ? AND m.deleted_at IS NULL`, accountID, testpkg.Tenant(t)).Scan(testpkg.Ctx(t), &staffID))
	return staffID
}
