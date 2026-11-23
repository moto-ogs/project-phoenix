package enrollmenthttp_test

import (
	"testing"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The office extends a booking that ends before its phase (#7929): an
// undated correction books the offering to the end of the phase, or to the
// earlier care end of the child record.

func (c *correctionEnv) extend(days ...string) enrollmentAPI.OfferingAdjustmentSelection {
	return enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.bounded.ID, SelectedDays: days, ExtendToPhaseEnd: true}
}

// extendsUntil is the last day the child's current booking of offeringID
// can be extended to, as the office's detail reads it.
func (c *correctionEnv) extendsUntil(t *testing.T, offeringID int64) *calendar.Date {
	t.Helper()
	sets, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), c.db, c.owner.ListChildOfferings, c.requestID)
	require.NoError(t, err)
	for _, row := range sets[c.childID].Current {
		if row.OfferingID == offeringID {
			return row.ExtendsUntil
		}
	}
	t.Fatalf("no current booking of offering %d", offeringID)
	return nil
}

// The booking that ends with February runs to the end of the phase after
// the extension, and so do its roster row and the child's occurrences. The
// history names the new end.
func TestTheOfficeExtendsABookingToTheEndOfThePhase(t *testing.T) {
	t.Parallel()
	c := setupCorrection(t)
	phaseEnd := calendar.Date(c.sourcePhase.ServiceEndDate)
	require.Equal(t, &phaseEnd, c.extendsUntil(t, c.bounded.ID), "the detail offers the end of the phase")

	c.correct(t, nil, c.extend("mon", "tue"))

	assert.Equal(t, []calendar.Date{c.phaseEndExcl}, c.bookingEnds(t, c.bounded.ID), "the booking runs to the end of the phase")
	assert.Equal(t, 1, c.rosterEndsOn(t, c.phaseEndExcl), "the roster row runs with it")
	assert.Zero(t, c.rosterEndsOn(t, c.bookingEnd))
	assert.Equal(t, 1, c.onOccurrence(t, c.afterEnd), "the child is on the occurrence after the old end")
	assert.Nil(t, c.extendsUntil(t, c.bounded.ID), "nothing is left to extend")
	var after string
	require.NoError(t, c.db.NewRaw(`SELECT after_json::text FROM audit.enrollment_offering_adjustments
		WHERE tenant_id = ? AND request_child_id = ? ORDER BY id DESC LIMIT 1`, testpkg.Tenant(t), c.childID).Scan(testpkg.Ctx(t), &after))
	assert.Contains(t, after, `"extended_until": "`+phaseEnd.String()+`"`, "the history names the new end")
}

// The care end of the child record still caps the extension, and a care
// end on the booking's last day leaves nothing to extend.
func TestAnExtensionEndsWithTheCareEnd(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		careEnd calendar.Date
		offered bool
		lastDay calendar.Date // the booking's last day after the extension
	}{
		"care end in May":          {careEnd: calendar.NewDate(2027, 5, 31), offered: true, lastDay: calendar.NewDate(2027, 5, 31)},
		"care end after the phase": {careEnd: calendar.NewDate(2027, 9, 30), offered: true, lastDay: calendar.NewDate(2027, 7, 31)},
		"care end on the last day": {careEnd: calendar.NewDate(2027, 2, 28), lastDay: calendar.NewDate(2027, 2, 28)},
	} {
		t.Run(name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			t.Parallel()
			c := setupCorrection(t)
			testpkg.SetStudentLifecycle(t, c.db, c.studentID, "active", nil, &tc.careEnd)
			phaseEnd := calendar.Date(c.sourcePhase.ServiceEndDate)
			require.Equal(t, calendar.NewDate(2027, 7, 31), phaseEnd, "the cases assume a phase to the end of July")
			if tc.offered {
				require.Equal(t, &tc.lastDay, c.extendsUntil(t, c.bounded.ID))
			} else {
				require.Nil(t, c.extendsUntil(t, c.bounded.ID), "no extension past the care end")
			}

			c.correct(t, nil, c.extend("mon"))

			assert.Equal(t, []calendar.Date{tc.lastDay.AddDays(1)}, c.bookingEnds(t, c.bounded.ID))
		})
	}
}

// An end where a scheduled change starts is no end to extend: the detail
// offers nothing.
func TestAScheduledChangeIsNoEndToExtend(t *testing.T) {
	t.Parallel()
	c := setupCorrection(t)
	switchDay := c.bookingEnd
	c.correct(t, &switchDay, enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.added.ID, SelectedDays: []string{"wed"}})

	assert.Nil(t, c.extendsUntil(t, c.bounded.ID))
}

// A change scheduled after the end bounds the extension: the detail offers
// the day before it, the booking runs to there, and the history names that
// day. A change that keeps the offering past the end leaves nothing to
// extend.
func TestAScheduledChangeBoundsTheExtension(t *testing.T) {
	t.Parallel()
	c := setupCorrection(t)
	inMay, lastApril := calendar.NewDate(2027, 5, 3), calendar.NewDate(2027, 5, 2)
	c.correct(t, &inMay, enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.added.ID, SelectedDays: []string{"wed"}})
	require.Equal(t, &lastApril, c.extendsUntil(t, c.bounded.ID), "the detail offers the day before the change")

	c.correct(t, nil, c.extend("mon", "tue"))

	assert.Equal(t, []calendar.Date{contractRunDay, inMay}, c.bookingEnds(t, c.bounded.ID),
		"with a scheduled change the correction applies from today; the booking runs to the change")
	assert.Equal(t, []calendar.Date{c.phaseEndExcl}, c.bookingEnds(t, c.added.ID), "the change stays")
	var after string
	require.NoError(t, c.db.NewRaw(`SELECT after_json::text FROM audit.enrollment_offering_adjustments
		WHERE tenant_id = ? AND request_child_id = ? ORDER BY id DESC LIMIT 1`, testpkg.Tenant(t), c.childID).Scan(testpkg.Ctx(t), &after))
	assert.Contains(t, after, `"extended_until": "`+lastApril.String()+`"`, "the history names the end that was written")
}

func TestAChangeThatKeepsTheOfferingLeavesNothingToExtend(t *testing.T) {
	t.Parallel()
	c := setupCorrection(t)
	inMarch, inMay := c.bookingEnd, calendar.NewDate(2027, 5, 3)
	c.correct(t, &inMarch, enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.bounded.ID, SelectedDays: []string{"mon"}})
	c.correct(t, &inMay, enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.added.ID, SelectedDays: []string{"wed"}})

	assert.Nil(t, c.extendsUntil(t, c.bounded.ID))
}

// Only an undated correction extends an end; a dated switch refuses it.
func TestADatedSwitchRefusesAnExtension(t *testing.T) {
	t.Parallel()
	c := setupCorrection(t)
	from := calendar.NewDate(2027, 2, 1)
	_, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), c.db, c.owner.UpdateChildOfferings, enrollmentAPI.UpdateChildOfferingsInput{
		RequestID: c.requestID, ChildID: c.childID, ActorAccountID: c.creatorID, ActorRole: "admin",
		Reason: "Korrektur", Offerings: []enrollmentAPI.OfferingAdjustmentSelection{c.extend("mon")}, EffectiveFrom: &from,
	})

	require.ErrorIs(t, err, capability.ErrOfferingAdjustmentInvalid)
	assert.Equal(t, []calendar.Date{c.bookingEnd}, c.bookingEnds(t, c.bounded.ID))
}
