package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The registrations of a parent account (ADR 0216 points 3 and 9). They lie
// at every Träger the account registered with, so each statement runs in the
// administrative transaction and names the account in its filter. The
// statement count does not depend on the rows: one claim, one read of the
// Träger, for the list one read of the registrations with their voluntary
// consents (#8038) and one of all their booked weeks, and one statement for
// a consent the parents withdraw or give again (ADR 0321).

const (
	// claimHolidayRegistrationsQuery links the registrations without an
	// account that name the account's address; idx_holiday_registrations_
	// unclaimed_email serves it.
	claimHolidayRegistrationsQuery = `UPDATE enrollment.holiday_registrations
		SET parent_account_id = ?
		WHERE parent_account_id IS NULL AND LOWER(guardian_email) = LOWER(?)`
	holidayParentRegistrationTraegerQuery = `SELECT DISTINCT organization_id FROM enrollment.holiday_registrations
		WHERE parent_account_id = ? ORDER BY organization_id`
	holidayParentRegistrationsQuery = `SELECT registration.id, registration.organization_id, period.name AS period_name,
			registration.submitted_at, registration.status,
			(SELECT min(week.starts_on) FROM enrollment.holiday_period_weeks AS week
				WHERE week.organization_id = registration.organization_id AND week.holiday_period_id = registration.holiday_period_id) AS first_day,
			(SELECT max(week.ends_on) FROM enrollment.holiday_period_weeks AS week
				WHERE week.organization_id = registration.organization_id AND week.holiday_period_id = registration.holiday_period_id) AS last_day,
			` + holidayRegistrationConsentsColumn + ` AS consents
		FROM enrollment.holiday_registrations AS registration
		JOIN enrollment.holiday_periods AS period
			ON period.organization_id = registration.organization_id AND period.id = registration.holiday_period_id
		WHERE registration.parent_account_id = ?
		ORDER BY registration.submitted_at DESC, registration.id DESC`
	// holidayParentRegistrationWeeksQuery reads every child of the
	// registrations with its booked weeks; a child without a booking keeps
	// one row without a week.
	holidayParentRegistrationWeeksQuery = `SELECT child.holiday_registration_id AS registration_id, child.position, child.first_name,
			week.starts_on, week.ends_on, model.name AS time_model_name, booking.placement,
			COALESCE(booking.lunch AND week.lunch_price_cents IS NOT NULL, FALSE) AS lunch
		FROM enrollment.holiday_registration_children AS child
		JOIN enrollment.holiday_registrations AS registration
			ON registration.organization_id = child.organization_id AND registration.id = child.holiday_registration_id
		LEFT JOIN enrollment.holiday_registration_bookings AS booking
			ON booking.organization_id = child.organization_id AND booking.holiday_registration_child_id = child.id
		LEFT JOIN enrollment.holiday_period_weeks AS week
			ON week.organization_id = booking.organization_id AND week.id = booking.holiday_period_week_id
		LEFT JOIN enrollment.holiday_week_time_models AS model
			ON model.organization_id = booking.organization_id AND model.id = booking.holiday_week_time_model_id
		WHERE registration.parent_account_id = ? AND child.holiday_registration_id = ANY(?)
		ORDER BY child.holiday_registration_id, child.position, week.starts_on, week.id`
)

// holidayRegistrationConsentsColumn builds, for the row of registration, the
// enabled consent blocks of its form version in the order of the form, with
// whether they are given right now and since when, or since when withdrawn
// (#8038, ADR 0321).
const holidayRegistrationConsentsColumn = `(SELECT COALESCE(jsonb_agg(jsonb_build_object(
				'key', block.definition->>'key',
				'title', COALESCE(block.definition->>'title', ''),
				'label', COALESCE(block.definition->>'label', ''),
				'text', COALESCE(block.definition->>'text', ''),
				'given', registration.legal_acceptances->(block.definition->>'key') IS NOT NULL,
				'changed_at', COALESCE(registration.legal_acceptances->(block.definition->>'key'),
					registration.legal_withdrawals->(block.definition->>'key')))
				ORDER BY COALESCE((block.definition->>'sort_order')::int, 0), block.position), '[]'::jsonb)
			FROM enrollment.holiday_period_forms AS form
			CROSS JOIN LATERAL jsonb_array_elements(form.legal_blocks) WITH ORDINALITY AS block(definition, position)
			WHERE form.organization_id = registration.organization_id AND form.holiday_period_id = registration.holiday_period_id
				AND form.version = registration.form_version
				AND block.definition->>'kind' = 'consent' AND COALESCE((block.definition->>'enabled')::boolean, false))`

// setHolidayRegistrationConsentQuery withdraws (?3 false) or gives again
// (?3 true) the consent ?2 of the registration ?1 of the account ?0 at the
// instant ?4, in one statement: it locks the registration, changes it only
// when the consent is in the other state and writes the audit entry with
// the account as its author. found counts the registration with an enabled
// consent block of that key in its form version.
const setHolidayRegistrationConsentQuery = `WITH target AS (
		SELECT registration.organization_id, registration.holiday_period_id, registration.id, registration.form_version,
			registration.legal_acceptances->?2 AS accepted_at, registration.legal_withdrawals->?2 AS withdrawn_at
		FROM enrollment.holiday_registrations AS registration
		JOIN enrollment.holiday_period_forms AS form
			ON form.organization_id = registration.organization_id AND form.holiday_period_id = registration.holiday_period_id
				AND form.version = registration.form_version
		WHERE registration.parent_account_id = ?0 AND registration.id = ?1
			AND EXISTS (SELECT 1 FROM jsonb_array_elements(form.legal_blocks) AS block(definition)
				WHERE block.definition->>'key' = ?2 AND block.definition->>'kind' = 'consent'
					AND COALESCE((block.definition->>'enabled')::boolean, false))
		FOR UPDATE OF registration
	), changed AS (
		UPDATE enrollment.holiday_registrations AS registration SET
			legal_acceptances = CASE WHEN ?3 THEN registration.legal_acceptances || jsonb_build_object(?2::text, ?4::timestamptz)
				ELSE registration.legal_acceptances - ?2::text END,
			legal_withdrawals = CASE WHEN ?3 THEN registration.legal_withdrawals - ?2::text
				ELSE registration.legal_withdrawals || jsonb_build_object(?2::text, ?4::timestamptz) END
		FROM target
		WHERE registration.organization_id = target.organization_id AND registration.id = target.id
			AND (target.accepted_at IS NOT NULL) <> ?3
		RETURNING registration.organization_id, registration.holiday_period_id, registration.id,
			target.form_version, target.accepted_at, target.withdrawn_at
	), logged AS (
		INSERT INTO enrollment.holiday_registration_audit
			(organization_id, holiday_period_id, holiday_registration_id, action, details, actor_account_id, occurred_at)
		SELECT changed.organization_id, changed.holiday_period_id, changed.id, 'consent',
			jsonb_build_object('key', ?2::text, 'given', ?3, 'form_version', changed.form_version,
				'accepted_at', changed.accepted_at, 'withdrawn_at', changed.withdrawn_at),
			?0, ?4
		FROM changed
		RETURNING id
	)
	SELECT (SELECT COUNT(*) FROM target) AS found, (SELECT COUNT(*) FROM logged) AS logged`

var _ enrollment.HolidayParentRegistrations = (*HolidayRegistrationStore)(nil)

var errHolidayParentRegistrationsAdmin = errors.New("enrollment postgres: the registrations of a parent account require the administrative transaction")

// ClaimHolidayRegistrations links, in one statement, every registration
// without an account whose guardian address equals email to the account.
// No account or no address claims nothing.
func (s *HolidayRegistrationStore) ClaimHolidayRegistrations(ctx context.Context, accountID int64, email string) (int, error) {
	if !tenant.IsAdminTx(ctx) {
		return 0, errHolidayParentRegistrationsAdmin
	}
	email = strings.TrimSpace(email)
	if accountID <= 0 || !strings.Contains(email, "@") {
		return 0, nil
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return 0, err
	}
	claimed, err := affectedRows(db.NewRaw(claimHolidayRegistrationsQuery, accountID, email).Exec(ctx))
	if err != nil {
		return 0, fmt.Errorf("enrollment postgres: claim holiday registrations: %w", err)
	}
	return claimed, nil
}

// HolidayParentRegistrationTraeger reads the Träger at which the account has
// a linked registration.
func (s *HolidayRegistrationStore) HolidayParentRegistrationTraeger(ctx context.Context, accountID int64) ([]int64, error) {
	if !tenant.IsAdminTx(ctx) {
		return nil, errHolidayParentRegistrationsAdmin
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return nil, err
	}
	organizationIDs := []int64{}
	if err := db.NewRaw(holidayParentRegistrationTraegerQuery, accountID).Scan(ctx, &organizationIDs); err != nil {
		return nil, fmt.Errorf("enrollment postgres: read the Träger of holiday parent registrations: %w", err)
	}
	return organizationIDs, nil
}

type holidayParentRegistrationRow struct {
	ID             int64          `bun:"id"`
	OrganizationID int64          `bun:"organization_id"`
	PeriodName     string         `bun:"period_name"`
	SubmittedAt    time.Time      `bun:"submitted_at"`
	Status         string         `bun:"status"`
	FirstDay       *calendar.Date `bun:"first_day"`
	LastDay        *calendar.Date `bun:"last_day"`
	// Consents is the JSON array holidayRegistrationConsentsColumn builds.
	Consents json.RawMessage `bun:"consents,type:jsonb"`
}

type holidayParentRegistrationWeekRow struct {
	RegistrationID int64          `bun:"registration_id"`
	Position       int            `bun:"position"`
	FirstName      string         `bun:"first_name"`
	StartsOn       *calendar.Date `bun:"starts_on"`
	EndsOn         *calendar.Date `bun:"ends_on"`
	TimeModelName  *string        `bun:"time_model_name"`
	Placement      *string        `bun:"placement"`
	Lunch          bool           `bun:"lunch"`
}

// HolidayParentRegistrations reads the account's registrations, newest
// first, with the first name and the booked weeks of each child: two
// statements whatever the number of registrations.
func (s *HolidayRegistrationStore) HolidayParentRegistrations(ctx context.Context, accountID int64) ([]enrollment.HolidayParentRegistration, error) {
	if !tenant.IsAdminTx(ctx) {
		return nil, errHolidayParentRegistrationsAdmin
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return nil, err
	}
	var rows []holidayParentRegistrationRow
	if err := db.NewRaw(holidayParentRegistrationsQuery, accountID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("enrollment postgres: read holiday parent registrations: %w", err)
	}
	registrations := make([]enrollment.HolidayParentRegistration, len(rows))
	if len(rows) == 0 {
		return registrations, nil
	}
	ids := make([]int64, len(rows))
	index := make(map[int64]int, len(rows))
	for i, row := range rows {
		ids[i], index[row.ID] = row.ID, i
		consents, err := decodeHolidayRegistrationConsents(row.Consents)
		if err != nil {
			return nil, err
		}
		registrations[i] = enrollment.HolidayParentRegistration{
			ID: row.ID, OrganizationID: row.OrganizationID, PeriodName: row.PeriodName, SubmittedAt: row.SubmittedAt, Status: row.Status,
			Children: []enrollment.HolidayParentRegistrationChild{}, Consents: consents,
		}
		if row.FirstDay != nil && row.LastDay != nil {
			registrations[i].FirstDay, registrations[i].LastDay = *row.FirstDay, *row.LastDay
		}
	}
	var weeks []holidayParentRegistrationWeekRow
	if err := db.NewRaw(holidayParentRegistrationWeeksQuery, accountID, pgdialect.Array(ids)).Scan(ctx, &weeks); err != nil {
		return nil, fmt.Errorf("enrollment postgres: read the weeks of holiday parent registrations: %w", err)
	}
	addHolidayParentRegistrationWeeks(registrations, index, weeks)
	return registrations, nil
}

// addHolidayParentRegistrationWeeks groups the rows, ordered by registration
// and child position, into the children of their registration.
func addHolidayParentRegistrationWeeks(registrations []enrollment.HolidayParentRegistration, index map[int64]int, weeks []holidayParentRegistrationWeekRow) {
	lastRegistration, lastPosition := int64(0), 0
	for _, row := range weeks {
		i, ok := index[row.RegistrationID]
		if !ok {
			continue
		}
		registration := &registrations[i]
		if row.RegistrationID != lastRegistration || row.Position != lastPosition {
			registration.Children = append(registration.Children, enrollment.HolidayParentRegistrationChild{
				FirstName: row.FirstName, Weeks: []enrollment.HolidayParentRegistrationWeek{},
			})
			lastRegistration, lastPosition = row.RegistrationID, row.Position
		}
		if row.StartsOn == nil || row.EndsOn == nil {
			continue
		}
		child := &registration.Children[len(registration.Children)-1]
		week := enrollment.HolidayParentRegistrationWeek{FirstDay: *row.StartsOn, LastDay: *row.EndsOn, Lunch: row.Lunch}
		if row.TimeModelName != nil {
			week.TimeModelName = *row.TimeModelName
		}
		if row.Placement != nil {
			week.Placement = *row.Placement
		}
		child.Weeks = append(child.Weeks, week)
	}
}

// SetHolidayRegistrationConsent withdraws or gives again a voluntary consent
// of the account's registration in one statement (ADR 0321).
func (s *HolidayRegistrationStore) SetHolidayRegistrationConsent(ctx context.Context, accountID, registrationID int64, key string, given bool) (bool, error) {
	if !tenant.IsAdminTx(ctx) {
		return false, errHolidayParentRegistrationsAdmin
	}
	if accountID <= 0 || registrationID <= 0 || strings.TrimSpace(key) == "" {
		return false, nil
	}
	db, err := NewDatabase()(ctx)
	if err != nil {
		return false, err
	}
	// The statement names the audit entry it wrote (logged) only so that
	// PostgreSQL runs the insert; found decides.
	var found, logged int
	if err := db.NewRaw(setHolidayRegistrationConsentQuery, accountID, registrationID, key, given, holidayNow(s.now)).Scan(ctx, &found, &logged); err != nil {
		return false, fmt.Errorf("enrollment postgres: set holiday registration consent: %w", err)
	}
	return found > 0, nil
}

// decodeHolidayRegistrationConsents reads the consents a statement built
// as a JSON array; none reads as an empty list.
func decodeHolidayRegistrationConsents(raw json.RawMessage) ([]enrollment.HolidayRegistrationConsent, error) {
	consents := []enrollment.HolidayRegistrationConsent{}
	if len(raw) == 0 || string(raw) == "null" {
		return consents, nil
	}
	if err := json.Unmarshal(raw, &consents); err != nil {
		return nil, fmt.Errorf("enrollment postgres: decode holiday registration consents: %w", err)
	}
	return consents, nil
}
