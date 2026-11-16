package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/domain"
)

func (s *Service) CurrentStudentConsents(
	ctx context.Context,
	snapshot peopledirectory.StudentConsentSnapshot,
	canManagePhoto bool,
) ([]peopledirectory.StudentConsentState, error) {
	if snapshot.StudentID <= 0 {
		return nil, invalidStudent("a persisted student is required")
	}

	values, err := s.studentConsents.CurrentStates(ctx, domain.StudentConsentSnapshot(snapshot), canManagePhoto)
	if err != nil {
		return nil, MapError(err)
	}
	if err := s.offerPhotoGrantOnlyWhilePhotosAreOn(ctx, values); err != nil {
		return nil, err
	}
	result := make([]peopledirectory.StudentConsentState, 0, len(values))
	for _, value := range values {
		result = append(result, peopledirectory.StudentConsentState(value))
	}
	return result, nil
}

// offerPhotoGrantOnlyWhilePhotosAreOn drops the offer to give the photo
// consent again while the school has child photos switched off (#7208): the
// grant would be refused, and a switch-off records a withdrawal for every
// child. The setting is read only when a grant is on offer.
func (s *Service) offerPhotoGrantOnlyWhilePhotosAreOn(ctx context.Context, values []domain.StudentConsentState) error {
	for i := range values {
		if values[i].Key != domain.StudentConsentPhoto || !values[i].CanGrant {
			continue
		}
		err := s.studentPhotos.requireFeatureEnabled(ctx)
		if errors.Is(err, domain.ErrPhotoFeatureDisabled) {
			values[i].CanGrant = false
			continue
		}
		if err != nil {
			return MapError(err)
		}
	}
	return nil
}
