package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("active.discard_stopped_room_history", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableActiveDiscardStoppedRoomHistorySQL)
		return err
	})
}

// repeatableActiveDiscardStoppedRoomHistorySQL is the current definition of
// active.discard_stopped_room_history() (ADR 0223). Change the function
// here; numbered migrations no longer define it. The statement triggers on
// active.visits that run it come from migration 20261121090000.
//
// While a child is stopped (#3844), a visit keeps existing only while it is
// open. The function deletes every visit of a stopped child the moment it
// is written closed, on every path. It is SECURITY DEFINER and names the
// school in its own predicates, so a scheduler connection without a tenant
// setting cannot skip it through RLS.
//
// A holiday guest (#8037, ADR 0120 addendum of 2026-11-24) is stopped at
// the hosting school while its home school holds a stop for the child the
// guest stands for (enrollment.holiday_guest_home_children()). The hosting
// school holds no stop row for that: the function reads the stop of the
// home school with every closed visit of a guest. Then it deletes all
// closed visits of that guest at the hosting school, not only the one just
// written: visits stored before the parents set the stop at the home school
// go with the guest's next room change. The probe on
// enrollment.holiday_guests keeps a statement for other children at one
// index lookup per closed visit.
const repeatableActiveDiscardStoppedRoomHistorySQL = `
CREATE OR REPLACE FUNCTION active.discard_stopped_room_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	DELETE FROM active.visits AS v
	USING visit_rows_new AS n, active.room_history_stops AS s
	WHERE v.id = n.id AND v.tenant_id = n.tenant_id AND v.exit_time IS NOT NULL
		AND s.tenant_id = n.tenant_id AND s.student_id = n.student_id;

	DELETE FROM active.visits AS v
	USING (
		SELECT DISTINCT n.tenant_id, n.student_id
		FROM visit_rows_new AS n
		WHERE n.exit_time IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM enrollment.holiday_guests AS guest
				WHERE guest.tenant_id = n.tenant_id AND guest.student_id = n.student_id AND guest.ended_on IS NULL)
			AND EXISTS (
				SELECT 1
				FROM enrollment.holiday_guest_home_children(n.tenant_id, n.student_id) AS home
				JOIN active.room_history_stops AS s
					ON s.tenant_id = home.home_school_id AND s.student_id = ANY (home.student_ids))
	) AS stopped_guest
	WHERE v.tenant_id = stopped_guest.tenant_id AND v.student_id = stopped_guest.student_id
		AND v.exit_time IS NOT NULL;
	RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION active.discard_stopped_room_history() FROM PUBLIC;
`
