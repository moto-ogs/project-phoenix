package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// capacityCheck is the booking an approval reserves: the offerings the
// materialization books from the effective date through the end the change
// writes (selectionBookingEnds), next to the ones the child already holds.
type capacityCheck struct {
	in                selectionMaterialization
	studentID         int64
	current           []*careplan.BookedOffering
	held              map[int64]bool
	replacementIDs    []int64
	lockedByID        map[int64]*careplan.CareOffering
	phaseEndExclusive calendar.Date
	// bookingEnds is the exclusive end the change books each offering to.
	bookingEnds map[int64]calendar.Date
}

// assertCapacityAvailable refuses an approval that would overbook an
// offering. It counts every selected offering after removing this child's
// old intervals, then reserves one replacement interval through the end the
// change books it to: an offering that stays chosen keeps the end of its
// booking (#7928), any other runs to the end of the care period.
func (s *OfferingChanges) assertCapacityAvailable(
	ctx context.Context,
	in selectionMaterialization,
	studentID int64,
	pending *careplan.OfferingChangeRequest,
) error {
	check, err := s.lockCapacityOfferings(ctx, in, studentID)
	if err != nil {
		return err
	}
	courseOfferings, err := check.courseCandidates()
	if err != nil {
		return err
	}
	// Resolve every course group before acquiring any course lock. Each
	// batch is ordered by group id, so approvals touching overlapping
	// offerings cannot deadlock.
	if err := s.assertCourseCapacitiesAvailable(ctx, courseCapacityCheck{
		studentID: studentID, requestChildID: in.requestChildID, offerings: courseOfferings,
		from: in.effectiveFrom, until: check.latestBookingEnd(courseOfferings), pending: pending,
		child: selectionFactsChild(in.facts),
	}); err != nil {
		return err
	}
	return s.assertOfferingCapacities(ctx, check)
}

// lockCapacityOfferings locks every offering the approval touches in id
// order: the replacement, the held and the excluded ones. A concurrent
// approval that releases one of this child's offerings holds that row lock
// too, so this one cannot count a slot that is about to become free.
func (s *OfferingChanges) lockCapacityOfferings(ctx context.Context, in selectionMaterialization, studentID int64) (*capacityCheck, error) {
	current, err := s.capacityCurrentSelections(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("offering change: list current offerings: %w", err)
	}
	held := heldOfferingIDs(current)
	materialized, err := s.materializedSelections(ctx, in)
	if err != nil {
		return nil, err
	}
	replacementIDs := make([]int64, 0, len(materialized))
	for _, selected := range materialized {
		replacementIDs = append(replacementIDs, selected.OfferingID)
	}
	allOfferingIDs := append([]int64(nil), replacementIDs...)
	for offeringID := range held {
		allOfferingIDs = append(allOfferingIDs, offeringID)
	}
	for offeringID := range in.excluded {
		allOfferingIDs = append(allOfferingIDs, offeringID)
	}
	slices.Sort(allOfferingIDs)
	allOfferingIDs = slices.Compact(allOfferingIDs)
	locked, err := s.lockOfferings(ctx, allOfferingIDs)
	if err != nil {
		return nil, fmt.Errorf("offering change: lock offering capacity: %w", err)
	}
	lockedByID, phaseEnd := offeringsByID(locked), in.phase.ServiceEnd.AddDays(1)
	stored, err := s.storedBookingsAt(ctx, in.facts, in.requestChildID, current, phaseEnd)
	if err != nil {
		return nil, err
	}
	return &capacityCheck{
		in: in, studentID: studentID, current: current, held: held, replacementIDs: replacementIDs,
		lockedByID: lockedByID, phaseEndExclusive: phaseEnd,
		bookingEnds: selectionBookingEnds(materialized, current, stored, lockedByID, phaseEnd),
	}, nil
}

// courseCandidates refuses an offering that vanished or was deactivated and
// is not held, and returns the offerings the approval newly books.
func (c *capacityCheck) courseCandidates() ([]*careplan.CareOffering, error) {
	offerings := make([]*careplan.CareOffering, 0, len(c.replacementIDs))
	for _, offeringID := range c.replacementIDs {
		offering := c.lockedByID[offeringID]
		if offering == nil || (!c.held[offeringID] && !offering.IsActive) {
			return nil, fmt.Errorf("%w: care offering %d is unavailable", careplan.ErrOfferingChangeInvalid, offeringID)
		}
		if heldOfferingCoversRange(c.current, offeringID, c.bookingEnd(offeringID)) {
			continue
		}
		offerings = append(offerings, offering)
	}
	return offerings, nil
}

// assertOfferingCapacities checks each newly booked offering's own limit. A
// Kurs carries the AG's Teilnehmergrenze as a second limit (#3075), checked
// before; the stricter one decides.
func (s *OfferingChanges) assertOfferingCapacities(ctx context.Context, check *capacityCheck) error {
	for _, offeringID := range check.replacementIDs {
		offering := check.lockedByID[offeringID]
		until := check.bookingEnd(offeringID)
		if heldOfferingCoversRange(check.current, offeringID, until) || offering.Capacity == nil {
			continue
		}
		taken, err := s.deps.Enrollment.CapacityPeak(
			ctx, offering.ID, []int64{check.in.requestChildID}, check.in.effectiveFrom, until,
		)
		if err != nil {
			return fmt.Errorf("offering change: count offering occupancy: %w", err)
		}
		if taken >= *offering.Capacity {
			return fmt.Errorf("%w: %s", careplan.ErrOfferingChangeCapacityFull, offering.Name)
		}
	}
	return nil
}

// bookingEnd is the exclusive end the change books the offering to.
func (c *capacityCheck) bookingEnd(offeringID int64) calendar.Date {
	if end, ok := c.bookingEnds[offeringID]; ok {
		return end
	}
	return c.phaseEndExclusive
}

// latestBookingEnd is the latest end the change books one of the offerings
// to: the AG check counts one window for all of them and stays on the safe
// side of each.
func (c *capacityCheck) latestBookingEnd(offerings []*careplan.CareOffering) calendar.Date {
	var latest calendar.Date
	for _, offering := range offerings {
		if end := c.bookingEnd(offering.ID); latest.IsZero() || end.After(latest) {
			latest = end
		}
	}
	if latest.IsZero() {
		return c.phaseEndExclusive
	}
	return latest
}

// storedBookingsAt reads the child's stored bookings when one in effect ends
// before the phase (endsBeforePhase); a projection with preloaded facts
// reads them once for all its alternatives.
func (s *OfferingChanges) storedBookingsAt(ctx context.Context, facts *directSelectionFacts, requestChildID int64,
	current []*careplan.BookedOffering, phaseEnd calendar.Date) ([]*careplan.BookedOffering, error) {
	if facts != nil && facts.storedLoaded {
		return facts.stored, nil
	}
	var stored []*careplan.BookedOffering
	if endsBeforePhase(current, phaseEnd) {
		history, err := s.deps.Enrollment.SelectionHistory(ctx, requestChildID)
		if err != nil {
			return nil, fmt.Errorf("offering change: list stored offerings: %w", err)
		}
		stored = bookedOfferingPointers(history)
	}
	if facts != nil {
		facts.stored, facts.storedLoaded = stored, true
	}
	return stored, nil
}
