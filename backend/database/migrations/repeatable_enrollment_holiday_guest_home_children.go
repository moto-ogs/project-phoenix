package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("enrollment.holiday_guest_home_children", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableEnrollmentHolidayGuestHomeChildrenSQL)
		return err
	})
}

// repeatableEnrollmentHolidayGuestHomeChildrenSQL is the definition of
// enrollment.holiday_guest_home_children() (#4721, ADR 0120 addendum of
// 2026-11-24, ADR 0223). Change the function here.
//
// It is the one place that decides which children of the home school a
// holiday guest of a hosting school stands for. The functions that answer
// the hosting school a question about the home school build on it:
// enrollment.holiday_guest_home_photo_consent(),
// enrollment.holiday_guest_home_room_history_stopped() and the trigger
// function active.discard_stopped_room_history().
//
// It returns no row when the question does not apply: the school does not
// host the week or left the Träger, the child is no open holiday guest of
// that school, its booking is not confirmed and placed any more, its week
// is over or not published, or it has no home school of the same Träger.
// Otherwise it returns one row: the home school and the children that
// belong to it during the week and carry the names and the date of birth
// of the registration (the rule of the participant list, ADR 0116; names
// compare as People Directory compares them, NFC and without regard to
// case). That list can be empty or hold several children.
//
// It takes the hosting school as a parameter and reads
// users.persons, users.student_profiles and users.student_school_memberships
// of the home school, so no tenant role may execute it. Only SECURITY
// DEFINER functions that bind the school themselves call it.
const repeatableEnrollmentHolidayGuestHomeChildrenSQL = `
CREATE OR REPLACE FUNCTION enrollment.holiday_guest_home_children(p_host_school_id BIGINT, p_student_id BIGINT)
	RETURNS TABLE (home_school_id BIGINT, student_ids BIGINT[])
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
	AS $$
	SELECT home.id, ARRAY(
		SELECT student.id
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
		ORDER BY student.id
	)
	FROM enrollment.holiday_guests AS guest
	JOIN enrollment.holiday_period_weeks AS week
		ON week.organization_id = guest.organization_id AND week.id = guest.holiday_period_week_id
	JOIN platform.schools AS host
		ON host.id = week.host_school_id AND host.organization_id = week.organization_id
	JOIN enrollment.holiday_periods AS period
		ON period.organization_id = week.organization_id AND period.id = week.holiday_period_id
	JOIN enrollment.holiday_registration_children AS child
		ON child.organization_id = guest.organization_id AND child.id = guest.holiday_registration_child_id
	JOIN enrollment.holiday_registrations AS registration
		ON registration.organization_id = child.organization_id AND registration.id = child.holiday_registration_id
	JOIN platform.schools AS home
		ON home.id = child.home_school_id AND home.organization_id = guest.organization_id
	WHERE guest.tenant_id = p_host_school_id
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
REVOKE ALL ON FUNCTION enrollment.holiday_guest_home_children(BIGINT, BIGINT) FROM PUBLIC, phoenix_tenant;
COMMENT ON FUNCTION enrollment.holiday_guest_home_children(BIGINT, BIGINT) IS
	'The children of the home school a holiday guest of the given hosting school stands for; no row when the guest has no open, placed booking there. For SECURITY DEFINER callers only (#4721).';
`
