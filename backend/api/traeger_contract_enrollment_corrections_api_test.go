package api

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
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
	c := newBoundContractCorrection(t, "Träger Korrektur ohne Version")
	c.correct(t, enrollmentOwner.OfferingAdjustmentSelection{OfferingID: c.f.offering}, enrollmentOwner.OfferingAdjustmentSelection{OfferingID: c.late})
	assert.Equal(t, 1, c.f.count(t, `SELECT COUNT(*) FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?
		AND care_offering_id = ? AND valid_until = DATE '2028-02-01'`, c.f.school, c.child, c.late), "the late care keeps its end")

	amended, err := c.conclusion.AmendFromBookings(c.ctx, c.f.office.organization)
	require.NoError(t, err)
	assert.Empty(t, amended.Amended, "the care did not change: no version")
	assert.Equal(t, c.versions, c.f.versions(t, c.f.mia))
}

// The office extends the late care to the end of the phase (#7929). That is
// a change it decided: the amendment makes a version from the old end on
// whose late care runs with the contract, to the end of the phase.
func TestAnExtendedBookingMakesAVersionOfABoundContract(t *testing.T) {
	t.Parallel()
	c := newBoundContractCorrection(t, "Träger Verlängerung")
	c.correct(t, enrollmentOwner.OfferingAdjustmentSelection{OfferingID: c.f.offering},
		enrollmentOwner.OfferingAdjustmentSelection{OfferingID: c.late, ExtendToPhaseEnd: true})
	var phaseEnd string
	require.NoError(t, c.f.db.NewRaw(`SELECT service_end_date::text FROM enrollment.phases WHERE id = ?`, c.f.phase).Scan(c.ctx, &phaseEnd))
	require.Equal(t, 1, c.f.count(t, `SELECT COUNT(*) FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?
		AND care_offering_id = ? AND valid_until = ?::date + 1`, c.f.school, c.child, c.late, phaseEnd), "the late care runs to the end of the phase")

	amended, err := c.conclusion.AmendFromBookings(c.ctx, c.f.office.organization)
	require.NoError(t, err)
	assert.Len(t, amended.Amended, 1, "the extension makes a version")
	assert.Equal(t, 1, c.f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions AS v
		JOIN care_contract.contract_version_services AS s ON s.contract_version_id = v.id
		WHERE v.contract_id = ? AND v.effective_from = DATE '2028-02-01' AND s.care_offering_id = ? AND s.last_day IS NULL`,
		c.f.mia, c.late), "from the old end on, the late care runs with the contract")
}

// boundContractCorrection is Mia's bound contract with the late care until
// January, as a version names it, and the office's undated correction.
type boundContractCorrection struct {
	f           contractEnrollmentFixture
	conclusion  carecontract.Conclusion
	ctx         context.Context
	child, late int64
	versions    int
	correct     func(*testing.T, ...enrollmentOwner.OfferingAdjustmentSelection)
}

func newBoundContractCorrection(t *testing.T, name string) *boundContractCorrection {
	t.Helper()
	f, conclusion := newContractEnrollmentFixtureWithAmendments(t, name)
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
	_, err = conclusion.AmendFromBookings(ctx, f.office.organization)
	require.NoError(t, err)
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
	return &boundContractCorrection{f: f, conclusion: conclusion, ctx: ctx, child: miaChild, late: late.ID, versions: f.versions(t, f.mia),
		correct: func(t *testing.T, offerings ...enrollmentOwner.OfferingAdjustmentSelection) {
			t.Helper()
			require.NoError(t, tenant.WithinTenant(ctx, schoolID, func(ctx context.Context) error {
				_, err := decisions.UpdateChildOfferings(ctx, enrollmentOwner.UpdateChildOfferingsInput{
					RequestID: requestID, ChildID: miaChild, ActorAccountID: actor.ID, ActorRole: "admin", Reason: "Korrektur",
					Offerings: offerings,
				})
				return err
			}))
		}}
}
