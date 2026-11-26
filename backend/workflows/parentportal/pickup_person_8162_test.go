package parentportal_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// #8162: a family names who collects the child on one day, a contact of the
// child or a one-time person by name, in its signed one-day request. The OGS
// approval writes the day's pickup person, which keeps the requesting
// guardian.

// dayPickupPersonOf is the child's pickup person of the day, nil for none.
func dayPickupPersonOf(t *testing.T, f pickupPermissionFixture, ctx context.Context, studentID int64, day calendar.Date) *careplan.PickupPerson {
	t.Helper()
	pickups, err := owners.CarePlanRequestRecords(f.care).ListDayPickups(ctx, day, day, []int64{studentID})
	require.NoError(t, err)
	for _, pickup := range pickups {
		if pickup.StudentID == studentID && pickup.Person != nil {
			return pickup.Person
		}
	}
	return nil
}

func signedOneTimePerson(t *testing.T, f pickupPermissionFixture, chain testpkg.ParentChain, day calendar.Date, name string) *parentService.PickupSignatureInput {
	t.Helper()
	return signedPickupSignature(t, f, chain, parentService.PickupSignatureStatementInput{
		Kind: parentService.PickupSignatureStatementDay, PersonName: name, Date: day,
	})
}

func TestDayPickupPerson_OneTimePersonByName(t *testing.T) {
	t.Parallel()

	f := buildPickupPermissionService(t)
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	contactID := linkContactOnlyGuardian(t, f.db, chain.StudentID, "oma-8162-name")
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	submit := func(submission parentService.PickupChangeSubmission) (*carerequests.Request, error) {
		submission.Date, submission.Reason = pickupPermissionDay, "Tante holt ab"
		return f.svc.SubmitPickupChange(ctx, chain.AccountID, chain.StudentID, submission)
	}

	_, err := submit(parentService.PickupChangeSubmission{PickupPersonName: "Tante Frieda"})
	require.ErrorIs(t, err, parentService.ErrPickupSignatureRequired, "a one-time person needs the signed declaration")
	_, err = submit(parentService.PickupChangeSubmission{PickupPersonName: "Tante Frieda", PickupPersonID: contactID, Signature: testSignature(t)})
	require.ErrorIs(t, err, parentService.ErrInvalidCareRequestPayload, "a contact and a one-time person at once")
	_, err = submit(parentService.PickupChangeSubmission{PickupPersonName: strings.Repeat("a", 121), Signature: testSignature(t)})
	require.ErrorIs(t, err, parentService.ErrInvalidCareRequestPayload, "the day value keeps 120 characters")
	_, err = submit(parentService.PickupChangeSubmission{PickupPersonName: "Tante Frieda", DepartureMode: "alone", Signature: testSignature(t)})
	require.ErrorIs(t, err, parentService.ErrInvalidCareRequestPayload, "a child who walks home alone is not collected")

	created, err := submit(parentService.PickupChangeSubmission{
		PickupPersonName: "  Tante   Frieda ", Signature: signedOneTimePerson(t, f, chain, pickupPermissionDay, "Tante Frieda"),
	})
	require.NoError(t, err)
	terms := carerequests.StoredPickupTerms(created.Payload)
	require.NotNil(t, terms)
	assert.Equal(t, "Tante Frieda", terms.PickupPersonName)
	assert.Zero(t, terms.PickupPersonGuardianProfileID, "a one-time person is no contact")
	signed := carerequests.StoredSignature(created.Payload)
	require.NotNil(t, signed)
	assert.Contains(t, signed.Statement, "Tante Frieda")

	approveCareRequest(t, f, chain.TenantID, created.ID)

	tenantCtx := tenant.WithTenantID(ctx, chain.TenantID)
	person := dayPickupPersonOf(t, f, tenantCtx, chain.StudentID, pickupPermissionDay)
	require.NotNil(t, person)
	assert.Equal(t, "Tante Frieda", person.Name)
	assert.True(t, person.OneTime(), "the staff check the ID card of a one-time person")
	require.NotNil(t, person.RequestedByGuardian)
	assert.Equal(t, chain.AccountID, *person.RequestedByGuardian, "the parents portal says „Von dir eingetragen“")
}

// Naming the person needs the relationship's pickup permission
// (parent_portal.pickup.manage); portal access alone is refused.
func TestDayPickupPerson_NeedsThePickupPermissionOfTheRelationship(t *testing.T) {
	t.Parallel()

	f := buildPickupPermissionService(t)
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	_, err := f.db.ExecContext(tenant.WithTenantID(ctx, chain.TenantID), `
		UPDATE auth.guardian_student_access AS a
		SET permissions = '{"parent_portal.access": true}'::jsonb
		FROM users.student_guardian_relationships AS r
		WHERE r.tenant_id = a.tenant_id AND r.id = a.relationship_id
		  AND r.tenant_id = ? AND r.student_id = ? AND r.guardian_profile_id = ?
	`, chain.TenantID, chain.StudentID, chain.GuardianProfileID)
	require.NoError(t, err)

	_, err = f.svc.SubmitPickupChange(ctx, chain.AccountID, chain.StudentID, parentService.PickupChangeSubmission{
		Date: pickupPermissionDay, PickupPersonName: "Tante Frieda", Reason: "Tante holt ab",
		Signature: testSignature(t),
	})
	require.ErrorIs(t, err, parentService.ErrGuardianPermissionDenied)
	assert.Nil(t, dayPickupPersonOf(t, f, tenant.WithTenantID(ctx, chain.TenantID), chain.StudentID, pickupPermissionDay))
}

// A guardian of a child in another school cannot name a person for it.
func TestDayPickupPerson_RefusesAChildOfAnotherSchool(t *testing.T) {
	t.Parallel()

	f := buildPickupPermissionService(t)
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	otherSchool, _ := testpkg.CreateTestTenant(t, f.db)
	foreign := testpkg.CreateTestStudentForTenant(t, f.db, otherSchool, "Fremd", "Kind", "2a")
	ctx := testpkg.WithPackageTenantRuntime(context.Background())

	_, err := f.svc.SubmitPickupChange(ctx, chain.AccountID, foreign.ID, parentService.PickupChangeSubmission{
		Date: pickupPermissionDay, PickupPersonName: "Tante Frieda", Reason: "Tante holt ab", Signature: testSignature(t),
	})
	require.ErrorIs(t, err, parentService.ErrChildNotLinked)
	assert.Nil(t, dayPickupPersonOf(t, f, tenant.WithTenantID(ctx, otherSchool), foreign.ID, pickupPermissionDay))
}

// After the school's cutoff (operations.parent_pickup_change_cutoff_time)
// today is closed for naming a person too; later days stay open.
func TestDayPickupPerson_RefusedAfterTheCutoff(t *testing.T) {
	t.Parallel()

	f := buildPickupPermissionServiceWith(t, parentSettingsStub{
		boolValues: map[string]bool{parentService.KeyParentPickupChangeEnabled: true},
		stringValues: map[string]string{
			parentService.KeyGuardianParentInviteMode:     parentService.ParentInviteModeDisabled,
			parentService.KeyParentPickupChangeCutoffTime: "00:00",
		},
	})
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	submit := func(day calendar.Date) error {
		_, err := f.svc.SubmitPickupChange(ctx, chain.AccountID, chain.StudentID, parentService.PickupChangeSubmission{
			Date: day, PickupPersonName: "Tante Frieda", Reason: "Tante holt ab",
			Signature: signedOneTimePerson(t, f, chain, day, "Tante Frieda"),
		})
		return err
	}

	require.ErrorIs(t, submit(pickupPermissionToday), parentService.ErrPickupChangeCutoffPassed)
	require.NoError(t, submit(pickupPermissionDay), "a later day has no cutoff")
}
