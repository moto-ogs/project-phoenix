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
// go with the guest's next room change. It skips a visit another
// transaction holds instead of waiting for it: the statement already holds
// its own, newer visit, and every other visit write locks in id order, so
// waiting for an older one could deadlock. A skipped visit goes with the
// next room change. The open guests among the written children are found
// first, by a join on enrollment.holiday_guests; only for them the function
// asks the home school, once per guest and statement, and deletes. A
// statement without a guest, the usual case, costs that one join.
const repeatableActiveDiscardStoppedRoomHistorySQL = `
CREATE OR REPLACE FUNCTION active.discard_stopped_room_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	guest_visit RECORD;
BEGIN
	DELETE FROM active.visits AS v
	USING visit_rows_new AS n, active.room_history_stops AS s
	WHERE v.id = n.id AND v.tenant_id = n.tenant_id AND v.exit_time IS NOT NULL
		AND s.tenant_id = n.tenant_id AND s.student_id = n.student_id;

	FOR guest_visit IN
		SELECT DISTINCT n.tenant_id, n.student_id
		FROM visit_rows_new AS n
		JOIN enrollment.holiday_guests AS guest
			ON guest.tenant_id = n.tenant_id AND guest.student_id = n.student_id AND guest.ended_on IS NULL
		WHERE n.exit_time IS NOT NULL
	LOOP
		IF EXISTS (
			SELECT 1
			FROM enrollment.holiday_guest_home_children(guest_visit.tenant_id, guest_visit.student_id) AS home
			JOIN active.room_history_stops AS s
				ON s.tenant_id = home.home_school_id AND s.student_id = ANY (home.student_ids))
		THEN
			DELETE FROM active.visits AS v
			WHERE v.id IN (
				SELECT older.id FROM active.visits AS older
				WHERE older.tenant_id = guest_visit.tenant_id AND older.student_id = guest_visit.student_id
					AND older.exit_time IS NOT NULL
				FOR UPDATE SKIP LOCKED);
		END IF;
	END LOOP;
	RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION active.discard_stopped_room_history() FROM PUBLIC;
`
