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
// The answer is one boolean, or NULL when the question does not apply.
// enrollment.holiday_guest_home_children() decides that and which children
// of the home school the guest stands for:
//
//   - NULL: that function returns no row for the calling school.
//   - true: the guest stands for exactly one child of the home school, and
//     its photo consent is given.
//   - false: that child has no photo consent, or the registration fits no
//     child of the home school or several.
//
// The function reads users.student_profiles of the home school, which the
// calling school's RLS hides. It returns no name, no id and no date of it.
const repeatableEnrollmentHolidayGuestHomePhotoConsentSQL = `
CREATE OR REPLACE FUNCTION enrollment.holiday_guest_home_photo_consent(p_student_id BIGINT)
	RETURNS BOOLEAN
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
	AS $$
	SELECT cardinality(home.student_ids) = 1 AND EXISTS (
		SELECT 1 FROM users.student_profiles AS student
		WHERE student.tenant_id = home.home_school_id
			AND student.id = home.student_ids[1]
			AND student.photo_consent_given_at IS NOT NULL)
	FROM enrollment.holiday_guest_home_children(
		NULLIF(current_setting('app.current_tenant_id', true), '')::bigint, p_student_id) AS home
	$$;
REVOKE ALL ON FUNCTION enrollment.holiday_guest_home_photo_consent(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enrollment.holiday_guest_home_photo_consent(BIGINT) TO phoenix_tenant;
COMMENT ON FUNCTION enrollment.holiday_guest_home_photo_consent(BIGINT) IS
	'Whether the home school of a holiday guest of the calling school holds a photo consent for the child right now; NULL when the question does not apply (#4721).';
`
