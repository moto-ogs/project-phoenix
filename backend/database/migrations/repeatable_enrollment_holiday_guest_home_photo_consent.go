package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("enrollment.holiday_guest_home_photo_consent", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableEnrollmentHolidayGuestHomePhotoConsentSQL)
		return err
	})
}

// repeatableEnrollmentHolidayGuestHomePhotoConsentSQL is the definition of
// enrollment.holiday_guest_home_photo_consent() (#4721, ADR 0120 addendum of
// 2026-11-24, ADR 0223). Change the function here.
//
// It tells the hosting school of a holiday week, in its tenant transaction,
// whether the home school of one of its holiday guests holds a photo consent
// for that child right now. Nothing is copied: a withdrawal at the home
// school answers false in the next read of the hosting school.
//
// The answer is one boolean, or NULL when the question does not apply:
//
//   - NULL: the child is no open holiday guest of the calling school, its
//     booking is not confirmed and placed any more, its week is over or not
//     published, or it has no home school of the same Träger.
//   - true: exactly one child that belongs to the home school during the
//     week carries the names and the date of birth of the registration (the
//     rule of the participant list, ADR 0116; names compare as People
//     Directory compares them, NFC and without regard to case), and its
//     photo consent is given.
//   - false: that child has no photo consent, or the registration fits no
//     child of the home school or several.
//
// The function reads users.persons, users.student_profiles and
// users.student_school_memberships of the home school, which the calling school's RLS hides. It returns no name, no id
// and no date of them.
const repeatableEnrollmentHolidayGuestHomePhotoConsentSQL = `
CREATE OR REPLACE FUNCTION enrollment.holiday_guest_home_photo_consent(p_student_id BIGINT)
	RETURNS BOOLEAN
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
	AS $$
	SELECT (
		SELECT COUNT(*) = 1 AND COALESCE(bool_and(student.photo_consent_given_at IS NOT NULL), false)
		FROM users.student_profiles AS student
		JOIN users.persons AS person ON person.id = student.person_id
		WHERE student.tenant_id = home.id
			AND person.deleted_at IS NULL
			AND person.birthday = child.birth_date
			AND LOWER(NORMALIZE(TRIM(person.first_name), NFC) COLLATE public.german_name)
				= LOWER(NORMALIZE(TRIM(child.first_name), NFC) COLLATE public.german_name)
			AND LOWER(NORMALIZE(TRIM(person.last_name), NFC) COLLATE public.german_name)
				= LOWER(NORMALIZE(TRIM(child.last_name), NFC) COLLATE public.german_name)
			AND EXISTS (
				SELECT 1 FROM users.student_school_memberships AS membership
				WHERE membership.tenant_id = student.tenant_id
					AND membership.student_profile_id = student.id
					AND membership.deleted_at IS NULL
					AND (membership.enrolled_from IS NULL OR membership.enrolled_from <= week.ends_on)
					AND (membership.enrolled_until IS NULL OR membership.enrolled_until >= week.starts_on))
	)
	FROM enrollment.holiday_guests AS guest
	JOIN enrollment.holiday_period_weeks AS week
		ON week.organization_id = guest.organization_id AND week.id = guest.holiday_period_week_id
	JOIN enrollment.holiday_periods AS period
		ON period.organization_id = week.organization_id AND period.id = week.holiday_period_id
	JOIN enrollment.holiday_registration_children AS child
		ON child.organization_id = guest.organization_id AND child.id = guest.holiday_registration_child_id
	JOIN enrollment.holiday_registrations AS registration
		ON registration.organization_id = child.organization_id AND registration.id = child.holiday_registration_id
	JOIN platform.schools AS home
		ON home.id = child.home_school_id AND home.organization_id = guest.organization_id
	WHERE guest.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
		AND guest.student_id = p_student_id
		AND guest.ended_on IS NULL
		AND week.host_school_id = guest.tenant_id
		AND week.ends_on >= (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date
		AND period.status = 'published'
		AND registration.status = 'confirmed'
		AND EXISTS (
			SELECT 1 FROM enrollment.holiday_registration_bookings AS booking
			WHERE booking.organization_id = child.organization_id
				AND booking.holiday_registration_child_id = child.id
				AND booking.holiday_period_week_id = week.id
				AND booking.placement = 'placed')
	$$;
REVOKE ALL ON FUNCTION enrollment.holiday_guest_home_photo_consent(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enrollment.holiday_guest_home_photo_consent(BIGINT) TO phoenix_tenant;
COMMENT ON FUNCTION enrollment.holiday_guest_home_photo_consent(BIGINT) IS
	'Whether the home school of a holiday guest of the calling school holds a photo consent for the child right now; NULL when the question does not apply (#4721).';
`
