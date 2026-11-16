package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func (s *Service) DeleteExpiredChildlessGuardians(ctx context.Context, retentionDays int, openInvitations peopledirectory.OpenGuardianInvitations) (int, error) {
	if retentionDays <= 0 {
		return 0, fmt.Errorf("%w, got %d", peopledirectory.ErrGuardianRetentionWindow, retentionDays)
	}
	// One instant marks this run's childless contacts and sets the cut-off,
	// so a contact marked now is never already past it.
	now := s.students.now()
	cutoff := calendar.DateFromTime(now).AddDays(-retentionDays).BerlinMidnight()
	return s.guardianLifecycle.DeleteChildlessGuardiansBefore(ctx, now, cutoff, openInvitations)
}
