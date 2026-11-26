package postgres

import (
	"context"
	"fmt"
	"time"
)

// withdrawHolidayConsentQuery takes the consent ?2 out of the acceptances of
// the registration ?1 of the Träger ?0 and stamps its withdrawal at ?3, only
// while it is given and an enabled consent block of the registration's form
// version (ADR 0321). The Träger-Büro records it; the caller holds the row.
// It answers the form version and when the consent had been given, so the
// audit entry keeps that evidence after the acceptance is gone.
const withdrawHolidayConsentQuery = `WITH target AS (
		SELECT registration.id, registration.form_version,
			(registration.legal_acceptances->>?2::text)::timestamptz AS accepted_at
		FROM enrollment.holiday_registrations AS registration
		JOIN enrollment.holiday_period_forms AS form
			ON form.organization_id = registration.organization_id AND form.holiday_period_id = registration.holiday_period_id
				AND form.version = registration.form_version
		WHERE registration.organization_id = ?0 AND registration.id = ?1
			AND registration.legal_acceptances->?2::text IS NOT NULL
			AND EXISTS (SELECT 1 FROM jsonb_array_elements(form.legal_blocks) AS block(definition)
				WHERE block.definition->>'key' = ?2::text AND block.definition->>'kind' = 'consent'
					AND COALESCE((block.definition->>'enabled')::boolean, false))
	)
	UPDATE enrollment.holiday_registrations AS registration
	SET legal_acceptances = registration.legal_acceptances - ?2::text,
		legal_withdrawals = registration.legal_withdrawals || jsonb_build_object(?2::text, ?3::timestamptz)
	FROM target
	WHERE registration.organization_id = ?0 AND registration.id = target.id
	RETURNING target.form_version, target.accepted_at`

// WithdrawHolidayConsent withdraws a given consent of a registration in the
// Träger transaction (ADR 0321) and answers the form version and when the
// consent had been given; withdrawn is false when it is not given or no
// consent of the registration's form version.
func (s *HolidayRegistrationStore) WithdrawHolidayConsent(ctx context.Context, organizationID, registrationID int64, key string) (formVersion int, acceptedAt *time.Time, withdrawn bool, err error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, nil, false, err
	}
	var rows []struct {
		FormVersion int        `bun:"form_version"`
		AcceptedAt  *time.Time `bun:"accepted_at"`
	}
	if err := db.NewRaw(withdrawHolidayConsentQuery, organizationID, registrationID, key, holidayNow(s.now)).Scan(ctx, &rows); err != nil {
		return 0, nil, false, fmt.Errorf("enrollment postgres: withdraw holiday consent: %w", err)
	}
	if len(rows) == 0 {
		return 0, nil, false, nil
	}
	return rows[0].FormVersion, rows[0].AcceptedAt, true, nil
}
