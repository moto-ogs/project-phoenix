package application

import (
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

// Sources of an ended phase (#8203). A rollover clones the catalog into the
// follow-up phase but leaves every Regeltermin on its old source offering,
// because old and new phase run side by side for a while. Once the old
// phase ends before the planning period starts, the source feeds nothing
// there; the indicator names it and suggests the offering of the same name
// in a phase that overlaps the period. Nothing is switched automatically.

// offeringNameKey compares offering names as the school reads them.
func offeringNameKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// offeringsByName groups the tenant's offerings by name key.
func offeringsByName(offerings map[int64]*careplan.CareOffering) map[string][]*careplan.CareOffering {
	byName := make(map[string][]*careplan.CareOffering, len(offerings))
	for _, offering := range offerings {
		key := offeringNameKey(offering.Name)
		byName[key] = append(byName[key], offering)
	}
	return byName
}

// addSuccessorCandidates adds every offering that shares its name with a
// source to the offerings whose phase the feeds load, so the suggestion
// needs no further read.
func (index rosterFeedIndex) addSuccessorCandidates(templates []careplan.TemplateRosterFeedQuery) {
	names := make(map[string]bool)
	for _, template := range templates {
		for _, id := range template.SourceCareOfferingIDs {
			if offering := index.offerings[id]; offering != nil {
				names[offeringNameKey(offering.Name)] = true
			}
		}
	}
	if len(names) == 0 {
		return
	}
	for id, offering := range index.offerings {
		if names[offeringNameKey(offering.Name)] {
			index.validationOfferingIDs[id] = true
		}
	}
}

// phaseEndedBefore reports whether the offering's phase is known and ended
// before the period starts. Without a period nothing has expired.
func (v rosterFeedValidation) phaseEndedBefore(offering *careplan.CareOffering, period *careplan.LinkedPeriod) bool {
	if period == nil {
		return false
	}
	phase, ok := v.phases[offering.PhaseID]
	return ok && phase.ServiceEnd.Before(period.StartDate)
}

// markExpiredSources marks the template's sources whose phase ended before
// its planning period and attaches their suggested successors. Every
// successor of one template comes from one phase, as a combined source
// requires: the first suggestion fixes the phase for the others.
func (v rosterFeedValidation) markExpiredSources(
	feeds *careplan.TemplateRosterFeeds,
	query careplan.TemplateRosterFeedQuery,
	offerings map[int64]*careplan.CareOffering,
	byName map[string][]*careplan.CareOffering,
) error {
	if len(feeds.Sources) == 0 {
		return nil
	}
	period, err := v.period(query.CalendarPeriodID)
	if err != nil || period == nil {
		return err
	}
	var successorPhaseID int64
	for i := range feeds.Sources {
		source := offerings[feeds.Sources[i].ID]
		if source == nil || !v.phaseEndedBefore(source, period) {
			continue
		}
		feeds.Sources[i].ExpiredPhase = true
		feeds.Sources[i].IsInvalid = true
		successor := v.successorFor(source, byName[offeringNameKey(source.Name)], period, successorPhaseID)
		if successor == nil {
			continue
		}
		successorPhaseID = successor.PhaseID
		feeds.Sources[i].Successor = &careplan.RosterMaintenanceOffering{ID: successor.ID, Name: successor.Name}
	}
	return nil
}

// successorFor picks the offering that replaces an expired source: same
// name, active, no holiday phase, a phase that overlaps the period and has
// not ended before it. The latest phase start wins, then the lower id. A
// non-zero phaseID restricts the choice to that phase.
func (v rosterFeedValidation) successorFor(
	source *careplan.CareOffering,
	candidates []*careplan.CareOffering,
	period *careplan.LinkedPeriod,
	phaseID int64,
) *careplan.CareOffering {
	var best *careplan.CareOffering
	var bestStart careplan.OfferingPhase
	for _, candidate := range candidates {
		phase, ok := v.successorPhase(source, candidate, period, phaseID)
		if !ok {
			continue
		}
		if best == nil || phase.ServiceStart.After(bestStart.ServiceStart) ||
			(phase.ServiceStart == bestStart.ServiceStart && candidate.ID < best.ID) {
			best, bestStart = candidate, phase
		}
	}
	return best
}

// successorPhase returns the candidate's phase when the candidate may
// replace the source.
func (v rosterFeedValidation) successorPhase(
	source, candidate *careplan.CareOffering,
	period *careplan.LinkedPeriod,
	phaseID int64,
) (careplan.OfferingPhase, bool) {
	if candidate.ID == source.ID || candidate.PhaseID == source.PhaseID || !candidate.IsActive {
		return careplan.OfferingPhase{}, false
	}
	if phaseID != 0 && candidate.PhaseID != phaseID {
		return careplan.OfferingPhase{}, false
	}
	phase, ok := v.phases[candidate.PhaseID]
	if !ok || phase.Holiday || !v.sourceFits(candidate, period) {
		return careplan.OfferingPhase{}, false
	}
	return phase, true
}
