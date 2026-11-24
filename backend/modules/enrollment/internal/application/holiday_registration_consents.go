package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

var _ enrollment.HolidayConsentWithdrawals = (*HolidayRegistrationReview)(nil)

// WithdrawHolidayConsent records a withdrawal the parents declared to the
// Träger-Büro outside moto (ADR 0321): any state of the registration takes
// it, because a withdrawal is never too late.
func (h *HolidayRegistrationReview) WithdrawHolidayConsent(ctx context.Context, reviewer enrollment.HolidayReviewer, periodID, registrationID int64, key string) (enrollment.HolidayRegistrationDetail, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		// No consent block has an empty key: nothing to withdraw.
		return enrollment.HolidayRegistrationDetail{}, enrollment.ErrHolidayRegistrationStateConflict
	}
	return h.change(ctx, reviewer, periodID, registrationID, func(_ enrollment.HolidayPeriod, current holidayRegistrationState) (string, any, error) {
		withdrawn, err := h.store.WithdrawHolidayConsent(ctx, reviewer.OrganizationID, current.ID, key)
		if err != nil {
			return "", nil, fmt.Errorf("enrollment: withdraw holiday consent: %w", err)
		}
		if !withdrawn {
			return "", nil, enrollment.ErrHolidayRegistrationStateConflict
		}
		given := false
		return enrollment.HolidayAuditConsent, enrollment.HolidayRegistrationEventDetails{Key: key, Given: &given}, nil
	})
}
