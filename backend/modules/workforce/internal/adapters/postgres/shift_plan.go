package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The shifts and the Soll of a Personalakte over all its Einsatzorte for the
// working-time check of the Einsatzplanung (#4708, ADR 0242). The database
// functions workforce.shift_plan_slots and workforce.shift_plan_soll answer
// a school that is an Einsatzort of the record, in its tenant transaction,
// and the record's Träger, in the Träger transaction; other schools stay
// unnamed in a tenant transaction.

type shiftPlanSlotRow struct {
	StaffRecordID int64        `bun:"staff_record_id"`
	SchoolID      *int64       `bun:"school_id"`
	ShiftID       *int64       `bun:"shift_id"`
	Date          calendarDate `bun:"date"`
	StartMinute   int          `bun:"start_minute"`
	EndMinute     int          `bun:"end_minute"`
	BreakMinutes  int          `bun:"break_minutes"`
}

type shiftPlanSollRow struct {
	StaffRecordID int64        `bun:"staff_record_id"`
	Date          calendarDate `bun:"date"`
	Own           bool         `bun:"own"`
	Minutes       int          `bun:"minutes"`
}

// ShiftPlanRecords maps the school's employments to the Personalakten that
// keep them; employments without one are missing. RLS shows a school only
// its own links.
func (s *Store) ShiftPlanRecords(ctx context.Context, staffIDs []int64) (map[int64]int64, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		MembershipID  int64 `bun:"membership_id"`
		StaffRecordID int64 `bun:"staff_record_id"`
	}
	if err := db.NewRaw(`SELECT membership_id, staff_record_id FROM workforce.staff_record_links WHERE school_id = ? AND membership_id = ANY(?)`,
		scope.TenantID, pgdialect.Array(staffIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read shift plan records: %w", err)
	}
	result := make(map[int64]int64, len(rows))
	for _, row := range rows {
		result[row.MembershipID] = row.StaffRecordID
	}
	return result, nil
}

// ShiftPlanSlots reads the active shifts of the records at every Einsatzort
// in [from, to]. With lock it first holds each record until the transaction
// ends, so no other school plans the same hours meanwhile.
func (s *Store) ShiftPlanSlots(ctx context.Context, recordIDs []int64, from, to calendar.Date, lock bool) ([]workforce.ShiftPlanSlot, error) {
	db, _, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []shiftPlanSlotRow
	if err := db.NewRaw(`SELECT staff_record_id, school_id, shift_id, date,
			(date_part('hour', start_time) * 60 + date_part('minute', start_time))::int AS start_minute,
			(date_part('hour', end_time) * 60 + date_part('minute', end_time))::int AS end_minute,
			break_minutes
		FROM workforce.shift_plan_slots(?, ?::date, ?::date, ?)`,
		pgdialect.Array(recordIDs), from.String(), to.String(), lock).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read shift plan slots: %w", err)
	}
	result := make([]workforce.ShiftPlanSlot, 0, len(rows))
	for _, row := range rows {
		result = append(result, workforce.ShiftPlanSlot{
			StaffRecordID: row.StaffRecordID, SchoolID: valueOr(row.SchoolID, 0), ShiftID: valueOr(row.ShiftID, 0),
			Date: calendar.Date(row.Date), StartMinute: row.StartMinute, EndMinute: row.EndMinute, BreakMinutes: row.BreakMinutes,
		})
	}
	return result, nil
}

// ShiftPlanSoll reads the Soll per record and weekday in [from, to] from the
// Arbeitsverträge of the Träger, summed over all Einsatzorte.
func (s *Store) ShiftPlanSoll(ctx context.Context, recordIDs []int64, from, to calendar.Date) ([]workforce.ShiftPlanSollDay, error) {
	db, _, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []shiftPlanSollRow
	if err := db.NewRaw(`SELECT staff_record_id, date, own, minutes FROM workforce.shift_plan_soll(?, ?::date, ?::date)`,
		pgdialect.Array(recordIDs), from.String(), to.String()).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read shift plan soll: %w", err)
	}
	result := make([]workforce.ShiftPlanSollDay, 0, len(rows))
	for _, row := range rows {
		result = append(result, workforce.ShiftPlanSollDay{StaffRecordID: row.StaffRecordID, Date: calendar.Date(row.Date), Own: row.Own, Minutes: row.Minutes})
	}
	return result, nil
}

// CountShiftsAfter counts the school's active shifts after the day, for the
// list before the Träger switches the Einsatzplanung off.
func (s *Store) CountShiftsAfter(ctx context.Context, after calendar.Date) (int, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, err
	}
	var count int
	if err := db.NewRaw(`SELECT count(*) FROM schedule.staff_shifts WHERE tenant_id = ? AND date > ?::date AND NOT cancelled`,
		scope.TenantID, after.String()).Scan(ctx, &count); err != nil {
		return 0, fmt.Errorf("workforce postgres: count future shifts: %w", err)
	}
	return count, nil
}
