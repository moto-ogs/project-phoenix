package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("enrollment.holiday_guest_home_room_history_stopped", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableEnrollmentHolidayGuestHomeRoomHistoryStoppedSQL)
		return err
	})
}

// repeatableEnrollmentHolidayGuestHomeRoomHistoryStoppedSQL is the
// definition of enrollment.holiday_guest_home_room_history_stopped()
// (#8037, ADR 0120 addendum of 2026-11-24, ADR 0223). Change the function
// here.
//
// It tells the hosting school of a holiday week, in its tenant transaction,
// whether room history and mood are stopped at the home school of one of
// its holiday guests right now (#3844). Nothing is copied: a stop set or
// lifted at the home school answers in the next read of the hosting school.
//
// The answer is one boolean, or NULL when the question does not apply
// (enrollment.holiday_guest_home_children() returns no row for the calling
// school). It is true when one of the children of the home school the guest
// stands for is stopped: where the registration fits several children, the
// stop of any of them counts, so a stop is never lost to a namesake.
//
// The function reads active.room_history_stops of the home school, which
// the calling school's RLS hides. It returns no name, no id and no date.
const repeatableEnrollmentHolidayGuestHomeRoomHistoryStoppedSQL = `
CREATE OR REPLACE FUNCTION enrollment.holiday_guest_home_room_history_stopped(p_student_id BIGINT)
	RETURNS BOOLEAN
	LANGUAGE sql
	STABLE
	SECURITY DEFINER
	SET search_path = pg_catalog, pg_temp
	AS $$
	SELECT EXISTS (
		SELECT 1 FROM active.room_history_stops AS stop
		WHERE stop.tenant_id = home.home_school_id
			AND stop.student_id = ANY (home.student_ids))
	FROM enrollment.holiday_guest_home_children(
		NULLIF(current_setting('app.current_tenant_id', true), '')::bigint, p_student_id) AS home
	$$;
REVOKE ALL ON FUNCTION enrollment.holiday_guest_home_room_history_stopped(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enrollment.holiday_guest_home_room_history_stopped(BIGINT) TO phoenix_tenant;
COMMENT ON FUNCTION enrollment.holiday_guest_home_room_history_stopped(BIGINT) IS
	'Whether room history and mood of a holiday guest of the calling school are stopped at its home school right now; NULL when the question does not apply (#8037).';
`
