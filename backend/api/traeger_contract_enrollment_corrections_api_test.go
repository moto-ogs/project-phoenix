package api

import (
	"context"
	"testing"

	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A bound imported contract follows its bookings (ADR 0309). Mia's contract
// has the all-day care to the end of the phase and, until January, a late
// care on Thursday; a version of the contract names the last day of the late
// care. The office then corrects the same offerings, without a date unless
// a case says otherwise.
//
//   - Keeping them makes no version (#7909), with a date too (#7928). Before the fix the correction
//     booked the late care to the end of the phase, and the amendment made a
//     version nobody decided.
//   - Extending the late care to the end of the phase (#7929) is a change the
//     office decided: the amendment makes a version from the old end on whose
//     late care runs with the contract.
func TestAnUndatedCorrectionOfABoundContract(t *testing.T) {
	t.Parallel()
	dated := calendar.NewDate(2027, 11, 8)
	for name, c := range map[string]struct {
		extend        bool
		effectiveFrom *calendar.Date
	}{
		"keeping the care makes no version": {}, "an extension makes a version": {extend: true},
		// A change with a date keeps the end too (#7928): from November the
		// office confirms the same offerings.
		"a dated change keeping the care makes no version": {effectiveFrom: &dated},
	} {
		extend := c.extend
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f, conclusion := newContractEnrollmentFixtureWithAmendments(t, "Träger Korrektur "+name)
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
					Offerings:     []enrollmentOwner.OfferingAdjustmentSelection{{OfferingID: f.offering}, {OfferingID: late.ID, ExtendToPhaseEnd: extend}},
					EffectiveFrom: c.effectiveFrom,
					// The office corrects the bookings it read (ADR 0311).
					ExpectedVersion: readOfferingsVersion(ctx, decisions, requestID, miaChild),
				})
				return err
			}))
			amended, err := conclusion.AmendFromBookings(ctx, f.office.organization)
			require.NoError(t, err)

			if !extend {
				assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?
		AND care_offering_id = ? AND valid_until = DATE '2028-02-01'`, f.school, miaChild, late.ID), "the late care keeps its end")
				assert.Empty(t, amended.Amended, "the care did not change: no version")
				assert.Equal(t, versions, f.versions(t, f.mia))
				return
			}
			assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM enrollment.care_offering_bookings AS b
		JOIN enrollment.phases AS p ON p.id = ? WHERE b.tenant_id = ? AND b.request_child_id = ?
		AND b.care_offering_id = ? AND b.valid_until = p.service_end_date + 1`, f.phase, f.school, miaChild, late.ID),
				"the late care runs to the end of the phase")
			assert.Len(t, amended.Amended, 1, "the extension makes a version")
			assert.Equal(t, 1, f.count(t, `SELECT COUNT(*) FROM care_contract.contract_versions AS v
		JOIN care_contract.contract_version_services AS s ON s.contract_version_id = v.id
		WHERE v.contract_id = ? AND v.effective_from = DATE '2028-02-01' AND s.care_offering_id = ? AND s.last_day IS NULL`,
				f.mia, late.ID), "from the old end on, the late care runs with the contract")
		})
	}
}
