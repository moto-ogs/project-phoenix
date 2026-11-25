package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain"
	schedule "github.com/moto-ogs/project-phoenix/modules/timetable/internal/domain/schedulerecords"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// classArrivalExceptionJSON is one class-wide arrival exception as
// json_agg writes it.
type classArrivalExceptionJSON struct {
	ID          int64     `json:"id"`
	TenantID    int64     `json:"tenant_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	SchoolClass string    `json:"school_class"`
	Date        string    `json:"date"`
	ArrivalTime string    `json:"arrival_time"`
	Reason      *string   `json:"reason"`
	CreatedBy   *int64    `json:"created_by"`
	Origin      string    `json:"origin"`
}

// blockStaffJSON is one staff row of a changed block as json_agg writes it.
// The absence reason is not read.
type blockStaffJSON struct {
	ID             int64  `json:"id"`
	InstanceID     int64  `json:"instance_id"`
	StaffID        int64  `json:"staff_id"`
	IsSubstitute   bool   `json:"is_substitute"`
	IsAbsent       bool   `json:"is_absent"`
	SickAbsenceID  *int64 `json:"sick_absence_id"`
	BlockTitle     string `json:"block_title"`
	BlockStartTime string `json:"block_start_time"`
	BlockEndTime   string `json:"block_end_time"`
}

// SchoolDayChangeRecords reads, in one statement (#8148), the class-wide
// arrival exceptions of every class on the day and the staff rows of the
// day's changed blocks that the staff member is on: each list is
// aggregated as JSON. The filters are those of ListClassArrivalExceptionRecords
// for every class and of ListInstanceStaff with StaffChangesOnly; a staffID
// of 0 reads no blocks.
func (s *Store) SchoolDayChangeRecords(ctx context.Context, day calendar.Date, staffID int64) ([]timetable.ClassArrivalException, []timetable.InstanceStaff, domain.OperationStats, error) {
	db, tenantID, err := s.database(ctx)
	if err != nil {
		return nil, nil, domain.OperationStats{}, err
	}
	classQuery, err := s.classArrivalExceptionQuery(ctx, nil, day, day, &[]*schedule.ClassArrivalException{})
	if err != nil {
		return nil, nil, domain.OperationStats{}, err
	}
	dayString := day.String()
	// Only the columns the overview needs: no absence reason, room or role
	// leaves the database.
	blockQuery := filterInstanceStaff(db.NewSelect().
		ModelTableExpr(`schedule.instance_staff AS "instance_staff"`).
		ColumnExpr(`"instance_staff".id, "instance_staff".instance_id, "instance_staff".staff_id`).
		ColumnExpr(`"instance_staff".is_substitute, "instance_staff".is_absent, "instance_staff".sick_absence_id`).
		Where(`"instance_staff".tenant_id = ?`, tenantID), timetable.InstanceStaffFilter{
		Date: &dayString, StaffChangesOnly: true,
	}).Where(`EXISTS (SELECT 1 FROM schedule.instance_staff AS "mine"
		WHERE "mine".tenant_id = "instance_staff".tenant_id
		AND "mine".instance_id = "instance_staff".instance_id
		AND "mine".staff_id = ?)`, staffID)
	var classJSON, blockJSON string
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewSelect().
		ColumnExpr(`COALESCE((SELECT json_agg(class ORDER BY LOWER(BTRIM(class.school_class)), class.id) FROM (?) AS class), '[]'::json)`, classQuery).
		ColumnExpr(`COALESCE((SELECT json_agg(block ORDER BY block.block_start_time, block.instance_id, block.id) FROM (?) AS block), '[]'::json)`, blockQuery).
		Scan(ctx, &classJSON, &blockJSON)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, nil, stats, fmt.Errorf("timetable postgres: school day changes: %w", err)
	}
	classes, err := decodeClassArrivalExceptions(classJSON)
	if err != nil {
		return nil, nil, stats, err
	}
	blocks := []blockStaffJSON{}
	if err := json.Unmarshal([]byte(blockJSON), &blocks); err != nil {
		return nil, nil, stats, fmt.Errorf("timetable postgres: decode school day blocks: %w", err)
	}
	staff := make([]timetable.InstanceStaff, 0, len(blocks))
	for _, row := range blocks {
		staff = append(staff, timetable.InstanceStaff{
			ID: row.ID, TenantID: tenantID, InstanceID: row.InstanceID, StaffID: row.StaffID,
			IsSubstitute: row.IsSubstitute, IsAbsent: row.IsAbsent, SickAbsenceID: row.SickAbsenceID,
			Block: &timetable.InstanceStaffBlock{Title: row.BlockTitle, StartTime: row.BlockStartTime, EndTime: row.BlockEndTime},
		})
	}
	stats.Rows = int64(len(classes) + len(staff))
	return classes, staff, stats, nil
}

func decodeClassArrivalExceptions(raw string) ([]timetable.ClassArrivalException, error) {
	rows := []classArrivalExceptionJSON{}
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return nil, fmt.Errorf("timetable postgres: decode school day classes: %w", err)
	}
	result := make([]timetable.ClassArrivalException, 0, len(rows))
	for _, row := range rows {
		// The TIME column holds the wall clock itself; no zone applies.
		arrival, err := time.Parse("15:04:05.999999999", row.ArrivalTime)
		if err != nil {
			return nil, fmt.Errorf("timetable postgres: decode school day class arrival time: %w", err)
		}
		result = append(result, timetable.ClassArrivalException{
			ID: row.ID, TenantID: row.TenantID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			SchoolClass: row.SchoolClass, Date: row.Date, ArrivalTime: calendar.NormalizeWallClock(arrival),
			Reason: row.Reason, CreatedBy: row.CreatedBy, Origin: row.Origin,
		})
	}
	return result, nil
}
