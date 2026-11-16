package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
)

func (s *Service) DeleteExpiredChildlessGuardians(ctx context.Context, retentionDays int, openInvitations peopledirectory.OpenGuardianInvitations) (int, error) {
	if retentionDays <= 0 {
		return 0, fmt.Errorf("%w, got %d", peopledirectory.ErrGuardianRetentionWindow, retentionDays)
	}
	cutoff := s.students.today().AddDays(-retentionDays).BerlinMidnight()
	return s.guardianLifecycle.DeleteChildlessGuardiansBefore(ctx, cutoff, openInvitations)
}
