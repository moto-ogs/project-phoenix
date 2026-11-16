package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/domain"
)

// SetPortalConsent writes the photo slice the parents portal decided on. It
// does not consult the photo feature switch: a withdrawal must land even
// while photos are disabled, and a grant only records the consent. The caller
// holds the child's row lock, so the slice it read is the one it overwrites.
func (s *StudentPhotoService) SetPortalConsent(ctx context.Context, photo domain.StudentPhoto) error {
	if photo.StudentID <= 0 || (photo.PhotoConsentGivenAt == nil) != (photo.PhotoConsentGivenBy == nil) {
		return &domain.InvalidStudentRecordError{Reason: "student ID is required and photo consent time and actor go together"}
	}
	return observeRun(ctx, s.observe, "set_student_photo_consent", s.tx.RunWrite, func(txCtx context.Context, stats *domain.OperationStats) error {
		if s.tx.TenantID(txCtx) <= 0 {
			return domain.ErrTenantRequired
		}
		if photo.PhotoConsentGivenAt != nil {
			if err := s.requirePortalGrantAllowed(txCtx, stats); err != nil {
				return err
			}
		}
		writeStats, err := s.store.SavePhoto(txCtx, photo)
		stats.Add(writeStats)
		return err
	})
}

// requirePortalGrantAllowed admits a parent's photo consent only while the
// school has child photos switched on (#7208): switching them off ends every
// consent, so one recorded meanwhile would survive the next switch-on. The
// parent flow already holds the child's row lock, so the photo gate is only
// tried: a switch-off in progress refuses the grant, and a switch-off that
// starts later waits for this commit and ends the new consent with the rest.
// A withdrawal never comes here; it stays possible at any time.
func (s *StudentPhotoService) requirePortalGrantAllowed(ctx context.Context, stats *domain.OperationStats) error {
	if err := s.requireFeatureEnabled(ctx); err != nil {
		return err
	}
	acquired, lockStats, err := s.store.TryLockPhotoFeature(ctx)
	stats.Add(lockStats)
	if err != nil {
		return err
	}
	if !acquired {
		return domain.ErrPhotoFeatureDisabledMid
	}
	if err := s.requireFeatureEnabledNow(ctx); err != nil {
		return domain.ErrPhotoFeatureDisabledMid
	}
	return nil
}
