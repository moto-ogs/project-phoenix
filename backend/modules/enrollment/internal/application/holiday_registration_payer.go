package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
)

var _ enrollment.HolidayPayerTrail = (*HolidayRegistrationReview)(nil)

// RecordHolidayPayer records a payer change of the Elternabrechnung (#8158,
// ADR 0325) in the audit trail of a confirmed registration, frozen or not:
// freezing locks cancellations and rebookings, not who pays.
func (h *HolidayRegistrationReview) RecordHolidayPayer(ctx context.Context, reviewer enrollment.HolidayReviewer, periodID, registrationID int64, change enrollment.HolidayPayerChange, reason string) error {
	reason = strings.TrimSpace(reason)
	switch {
	case reason == "":
		return validation.Errors{"reason": errors.New("is required")}
	case utf8.RuneCountInString(reason) > enrollment.HolidayPayerReasonMaxLength:
		return validation.Errors{"reason": fmt.Errorf("must be at most %d characters", enrollment.HolidayPayerReasonMaxLength)}
	case !knownHolidayPayer(change.Before) || !knownHolidayPayer(change.After):
		return validation.Errors{"payer": errors.New("is unknown")}
	}
	_, err := h.change(ctx, reviewer, periodID, registrationID, func(_ enrollment.HolidayPeriod, current holidayRegistrationState) (string, any, error) {
		if current.Status != enrollment.HolidayRegistrationConfirmed {
			return "", nil, enrollment.ErrHolidayRegistrationStateConflict
		}
		return enrollment.HolidayAuditPayer, enrollment.HolidayRegistrationEventDetails{Payer: &change, Reason: reason}, nil
	})
	return err
}

// knownHolidayPayer reports a payer of a known kind; only a cost bearer has
// a name.
func knownHolidayPayer(payer enrollment.HolidayPaidBy) bool {
	switch payer.Kind {
	case enrollment.HolidayPayerFamily, enrollment.HolidayPayerExemption:
		return payer.CostBearerName == ""
	case enrollment.HolidayPayerCostBearer:
		return strings.TrimSpace(payer.CostBearerName) != ""
	}
	return false
}
