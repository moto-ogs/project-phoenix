package postgres

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ListRoomBlockStaff reads, in one statement, the staff rows of the planned
// or active blocks of the caller's school whose effective room is roomID from
// through until (#8234), with whether the member is marked absent. A staff
// row's room override wins over the block's primary room.
func (s *Store) ListRoomBlockStaff(ctx context.Context, roomID int64, from, until calendar.Date) ([]timetable.RoomBlockStaffRow, domain.OperationStats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	var rows []struct {
		StaffID int64 `bun:"staff_id"`
		Absent  bool  `bun:"is_absent"`
	}
	query := db.NewSelect().
		TableExpr(`schedule.instance_staff AS "instance_staff"`).
		Join(`INNER JOIN schedule.activity_instances AS "activity_instance"
			ON "activity_instance".id = "instance_staff".instance_id
			AND "activity_instance".tenant_id = "instance_staff".tenant_id`).
		ColumnExpr(`"instance_staff".staff_id, "instance_staff".is_absent`).
		Where(`"instance_staff".tenant_id = ?`, tenantID).
		Where(`COALESCE("instance_staff".room_id, "activity_instance".room_id) = ?`, roomID).
		Where(`"activity_instance".date >= ?`, from).
		Where(`"activity_instance".date <= ?`, until).
		Where(`"activity_instance".status IN (?, ?)`, timetable.InstanceStatusPlanned, timetable.InstanceStatusActive).
		OrderExpr(`"instance_staff".staff_id ASC`)
	stats, err := scanAllInto(ctx, query, &rows, "list room block staff")
	if err != nil {
		return nil, stats, err
	}
	result := make([]timetable.RoomBlockStaffRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, timetable.RoomBlockStaffRow{StaffID: row.StaffID, Absent: row.Absent})
	}
	stats.Rows = int64(len(result))
	return result, stats, nil
}
