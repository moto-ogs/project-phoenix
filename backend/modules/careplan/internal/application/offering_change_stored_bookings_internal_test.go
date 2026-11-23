package application

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// historyCountingEnrollment counts the reads of the child's stored bookings.
type historyCountingEnrollment struct {
	ports.OfferingChangeEnrollment
	reads int
}

func (e *historyCountingEnrollment) SelectionHistory(context.Context, int64) ([]careplan.BookedOffering, error) {
	e.reads++
	return nil, nil
}

type manualPlanningStub struct {
	ports.OfferingChangePlanning
	occurrences []ports.ManualPlanningOccurrence
}

func (p manualPlanningStub) ListManualPlanningOccurrences(context.Context, int64, string, string) ([]ports.ManualPlanningOccurrence, error) {
	return p.occurrences, nil
}

// The alternatives of a pickup preview share their facts: the stored
// bookings are read once for all of them (#7928, council round 3), and not
// at all without manual planning to check.
func TestManualPlanningReadsTheStoredBookingsOncePerProjection(t *testing.T) {
	t.Parallel()
	end, phaseEnd := calendar.NewDate(2027, 3, 1), calendar.NewDate(2027, 7, 31)
	current := []*careplan.BookedOffering{{RequestChildID: 4, CareOfferingID: 1, ValidUntil: &end}}
	newDiff := func(facts *directSelectionFacts) *offeringDecisionDiff {
		return &offeringDecisionDiff{
			current: current, selected: []careplan.OfferingSelection{{OfferingID: 1, SelectedDays: []string{"tue"}}},
			offeringByID:  map[int64]*careplan.CareOffering{1: {ID: 1, CountsAsCare: true}},
			phase:         &ports.BookingPhase{OfferingPhase: careplan.OfferingPhase{ServiceEnd: phaseEnd}},
			effectiveFrom: calendar.NewDate(2027, 1, 11), selectionFacts: facts,
		}
	}
	occurrence := ports.ManualPlanningOccurrence{ActivityGroupID: 9, Date: "2027-03-02"}
	enrollment := &historyCountingEnrollment{}
	svc := offeringChangesForTest(OfferingChangeDependencies{Enrollment: enrollment,
		Planning: manualPlanningStub{occurrences: []ports.ManualPlanningOccurrence{occurrence}}})

	facts := &directSelectionFacts{current: current}
	for range 3 {
		conflicts, err := svc.manualPlanningConflicts(context.Background(), 2, newDiff(facts))
		require.NoError(t, err)
		require.Len(t, conflicts, 1, "the Tuesday after the kept end is uncovered")
	}
	assert.Equal(t, 1, enrollment.reads, "one read for the alternatives of one projection")

	quiet := offeringChangesForTest(OfferingChangeDependencies{Enrollment: enrollment, Planning: manualPlanningStub{}})
	_, err := quiet.manualPlanningConflicts(context.Background(), 2, newDiff(nil))
	require.NoError(t, err)
	assert.Equal(t, 1, enrollment.reads, "no read without manual planning")
}
