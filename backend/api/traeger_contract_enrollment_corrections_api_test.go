package api

import (
	"context"
	"testing"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A bound imported contract follows its bookings (ADR 0309). An undated
// correction of the office that keeps the care as it is makes no version
// (#7909). Mia's contract has the all-day care to the end of the phase and,
// until January, a late care on Thursday; a version of the contract names
// the last day of the late care. The office then confirms the same offerings
// without a date. Before the fix the correction booked the late care to the
// end of the phase, and the amendment made a version nobody decided.
func TestAnUndatedCorrectionMakesNoVersionOfABoundContract(t *testing.T) {
	t.Parallel()
	f, conclusion := newContractEnrollmentFixtureWithAmendments(t, "Träger Korrektur ohne Version")
	ctx := tenant.WithUnitOfWork(context.Background(), testpkg.TenantRuntime(t, f.db))
	miaChild := int64(f.runPreviewed(t).row(t, f.mia).RequestChildID)
	require.NotZero(t, miaChild)

	late := &testpkg.CareOffering{PhaseID: f.phase, Name: "Spätbetreuung", DaysOfWeekMode: "fixed", AvailableDays: []string{"thu"},
		AutoAddGradeLevels: []int{}, IsActive: true, CountsAsCare: true, PickupTimes: map[string]string{"thu": "17:00"}}
	late.TenantID = f.school
	testpkg.InsertTestCareOffering(t, f.db, testpkg.TenantContext(f.school), late)
	_, err := f.db.ExecContext(ctx, `INSERT INTO enrollment.care_offering_bookings (tenant_id, request_child_id, care_offering_id,
			manual_selected_days, valid_from, valid_until) VALUES (?, ?, ?, '[]'::jsonb, DATE '2027-08-01', DATE '2028-02-01')`,
		f.school, miaChild, late.ID)
	require.NoError(t, err)
	for range 3 {
		_, err = conclusion.AmendFromBookings(ctx, f.office.organization)
		require.NoError(t, err)
	}
	versions := f.versions(t, f.mia)
	require.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions AS v
		JOIN care_contract.contract_version_services AS s ON s.contract_version_id = v.id
		WHERE v.contract_id = ? AND s.care_offering_id = ? AND s.last_day = DATE '2028-01-31'`,
		f.mia, late.ID), "the version names the last day of the late care")

	unit := testpkg.TenantRuntime(t, f.db)
	feedback, err := NewFeedbackTestModule(testpkg.NewDatabase(t, f.db), unit)
	require.NoError(t, err)
	_, _, _, _, decisions, _, err := NewStudentTestModule(testpkg.NewDatabase(t, f.db), unit, feedback.Feedback, contractEnrollmentNow)
	require.NoError(t, err)
	actor := testpkg.CreateTestAccount(t, f.db, "korrektur-"+t.Name()+"@example.com")
	var requestID int64
	require.NoError(t, f.db.NewRaw(`SELECT request_id FROM enrollment.request_children WHERE id = ?`, miaChild).Scan(ctx, &requestID))
	schoolID, err := tenant.NewTenantID(f.school)
	require.NoError(t, err)
	require.NoError(t, tenant.WithinTenant(ctx, schoolID, func(ctx context.Context) error {
		_, err := decisions.UpdateChildOfferings(ctx, enrollmentOwner.UpdateChildOfferingsInput{
			RequestID: requestID, ChildID: miaChild, ActorAccountID: actor.ID, ActorRole: "admin", Reason: "Korrektur",
			Offerings: []enrollmentOwner.OfferingAdjustmentSelection{{OfferingID: f.offering}, {OfferingID: late.ID}},
		})
		return err
	}))
	assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?
		AND care_offering_id = ? AND valid_until = DATE '2028-02-01'`, f.school, miaChild, late.ID), "the late care keeps its end")

	amended, err := conclusion.AmendFromBookings(ctx, f.office.organization)
	require.NoError(t, err)
	assert.Empty(t, amended.Amended, "the care did not change: no version")
	assert.Equal(t, versions, f.versions(t, f.mia))
}
