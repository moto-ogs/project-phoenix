package postgres

import (
	"context"
	"fmt"
)

// withdrawHolidayConsentQuery takes the consent ?2 out of the acceptances of
// the registration ?1 of the Träger ?0 and stamps its withdrawal at ?3, only
// while it is given and an enabled consent block of the registration's form
// version (ADR 0321). The Träger-Büro records it; the caller holds the row.
const withdrawHolidayConsentQuery = `UPDATE enrollment.holiday_registrations AS registration
	SET legal_acceptances = registration.legal_acceptances - ?2::text,
		legal_withdrawals = registration.legal_withdrawals || jsonb_build_object(?2::text, ?3::timestamptz)
	FROM enrollment.holiday_period_forms AS form
	WHERE registration.organization_id = ?0 AND registration.id = ?1
		AND form.organization_id = registration.organization_id AND form.holiday_period_id = registration.holiday_period_id
		AND form.version = registration.form_version
		AND registration.legal_acceptances->?2::text IS NOT NULL
		AND EXISTS (SELECT 1 FROM jsonb_array_elements(form.legal_blocks) AS block(definition)
			WHERE block.definition->>'key' = ?2::text AND block.definition->>'kind' = 'consent'
				AND COALESCE((block.definition->>'enabled')::boolean, false))`

// WithdrawHolidayConsent withdraws a given consent of a registration in the
// Träger transaction (ADR 0321); false when it is not given or no consent
// of the registration's form version.
func (s *HolidayRegistrationStore) WithdrawHolidayConsent(ctx context.Context, organizationID, registrationID int64, key string) (bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	withdrawn, err := affectedRows(db.NewRaw(withdrawHolidayConsentQuery, organizationID, registrationID, key, holidayNow(s.now)).Exec(ctx))
	if err != nil {
		return false, fmt.Errorf("enrollment postgres: withdraw holiday consent: %w", err)
	}
	return withdrawn > 0, nil
}
