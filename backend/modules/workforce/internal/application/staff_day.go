package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

var _ workforce.StaffDayReads = (*Service)(nil)

// StaffDay reads the absences with plan effect that overlap the day and the
// group handovers that cover it in one statement (#7903), with the filters
// of ListStaffAbsences and ListGroupSubstitutions.
func (s *Service) StaffDay(ctx context.Context, day string) (workforce.StaffDay, error) {
	absenceFilter := domain.StaffAbsenceFilter{Statuses: domain.EffectiveAbsenceStatuses, OverlapFrom: day, OverlapTo: day}
	handoverFilter := domain.GroupSubstitutionFilter{TargetType: domain.GroupSubstitutionTypeGroupHandover, On: day}
	if err := absenceFilter.Validate(); err != nil {
		return workforce.StaffDay{}, MapError(err)
	}
	if err := handoverFilter.Validate(); err != nil {
		return workforce.StaffDay{}, MapError(err)
	}
	// One plain select in the caller's transaction, unobserved like the
	// other reads of "Heute anders" (OnSiteStaff, Meal Plan's MenuChanges).
	absences, handovers, _, err := s.store.ListStaffAbsencesAndGroupSubstitutions(ctx, absenceFilter, handoverFilter)
	if err != nil {
		return workforce.StaffDay{}, MapError(err)
	}
	result := workforce.StaffDay{Absences: absencesToPublic(absences), Handovers: make([]workforce.GroupSubstitution, 0, len(handovers))}
	for _, row := range handovers {
		result.Handovers = append(result.Handovers, substitutionToPublic(row))
	}
	return result, nil
}
