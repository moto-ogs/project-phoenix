package application

import (
	"context"
	"fmt"
	"sort"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The block half of a sick report's reversal: restore exactly the
// assignments the report stamped, keep a block an admin covered meanwhile,
// and tell the people concerned which blocks have the person back (#7136).

func (s *sickCascade) clearStampedBlocks(ctx context.Context, report sickReport, onlyDays map[calendar.Date]bool, activeTouched timetable.TouchedActivities) error {
	rows, err := s.loadStampedBlockRows(ctx, report.absenceID)
	if err != nil || len(rows) == 0 {
		return err
	}
	byDay, releaseOnly, err := s.classifyStampedBlockRows(ctx, rows, onlyDays)
	if err != nil {
		return err
	}
	if err := s.releaseSickBlockStamps(ctx, releaseOnly); err != nil {
		return err
	}
	notice := timetable.SickAbsenceNotice{AbsenceID: report.absenceID, StaffID: report.subjectStaffID, ActorAccountID: report.actorAccountID, Returned: true}
	for _, day := range sortedStampedBlockDays(byDay) {
		cleared, err := s.clearStampedBlocksForDay(ctx, report, day, byDay[day], activeTouched)
		if err != nil {
			return err
		}
		notice.Blocks = append(notice.Blocks, cleared...)
	}
	// A withdrawn or shortened absence tells the same people that the person
	// is there again on the blocks it restored (#7136).
	if len(notice.Blocks) == 0 {
		return nil
	}
	if err := s.deviations.NoticeSickAbsence(ctx, notice); err != nil {
		return fmt.Errorf("sick clear: staffing notice: %w", err)
	}
	return nil
}

type stampedSickBlockRow struct {
	row      *timetable.InstanceStaff
	instance *timetable.ScheduledInstance
}

func (s *sickCascade) loadStampedBlockRows(ctx context.Context, absenceID int64) ([]*timetable.InstanceStaff, error) {
	rows, err := s.sickStamps.ListBySickAbsence(ctx, absenceID)
	if err != nil {
		return nil, fmt.Errorf("sick clear: load stamped rows: %w", err)
	}
	return rows, nil
}

func (s *sickCascade) classifyStampedBlockRows(ctx context.Context, rows []*timetable.InstanceStaff, onlyDays map[calendar.Date]bool) (map[calendar.Date][]stampedSickBlockRow, []*timetable.InstanceStaff, error) {
	today := s.todayDate()
	byDay := make(map[calendar.Date][]stampedSickBlockRow)
	var releaseOnly []*timetable.InstanceStaff
	instancesByID, err := s.timetableData.GetActivityInstancesByID(ctx, instanceStaffInstanceIDs(rows))
	if err != nil {
		return nil, nil, fmt.Errorf("sick clear: load stamped instances: %w", err)
	}
	if missingID := missingActivityInstanceID(rows, instancesByID); missingID > 0 {
		return nil, nil, fmt.Errorf("sick clear: load instance %d: %w", missingID, errRecordNotFound)
	}
	for _, row := range rows {
		instance := instancesByID[row.InstanceID]
		if instance != nil && onlyDays != nil && !onlyDays[instance.Date] {
			continue
		}
		// Past days stay as recorded history; rows a manual edit already
		// restored, and terminal instances, only shed their stamp.
		if instance == nil || !row.IsAbsent || instance.Date.Before(today) || !isPlannableInstance(instance) {
			releaseOnly = append(releaseOnly, row)
			continue
		}
		date := instance.Date
		byDay[date] = append(byDay[date], stampedSickBlockRow{row: row, instance: instance})
	}
	return byDay, releaseOnly, nil
}

func instanceStaffInstanceIDs(rows []*timetable.InstanceStaff) []int64 {
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.InstanceID)
	}
	return ids
}

func missingActivityInstanceID(rows []*timetable.InstanceStaff, instances map[int64]*timetable.ScheduledInstance) int64 {
	for _, row := range rows {
		if instances[row.InstanceID] == nil {
			return row.InstanceID
		}
	}
	return 0
}

func (s *sickCascade) releaseSickBlockStamps(ctx context.Context, rows []*timetable.InstanceStaff) error {
	for _, row := range rows {
		row.SickAbsenceID = nil
		if _, err := s.sickStamps.SetSickAbsence(ctx, row.ID, row.SickAbsenceID); err != nil {
			return fmt.Errorf("sick clear: release row %d: %w", row.ID, err)
		}
	}
	return nil
}

func sortedStampedBlockDays(byDay map[calendar.Date][]stampedSickBlockRow) []calendar.Date {
	dates := make([]calendar.Date, 0, len(byDay))
	for d := range byDay {
		dates = append(dates, d)
	}
	sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })
	return dates
}

func (s *sickCascade) clearStampedBlocksForDay(ctx context.Context, report sickReport, day calendar.Date, entries []stampedSickBlockRow, activeTouched timetable.TouchedActivities) ([]timetable.SickAbsenceNoticeBlock, error) {
	if err := s.timetableData.AcquireSubstituteDayLock(ctx, day); err != nil {
		return nil, fmt.Errorf("sick clear: day lock %s: %w", day.String(), err)
	}
	var cleared []timetable.SickAbsenceNoticeBlock
	for _, entry := range entries {
		hasSubstitute, err := s.instanceHasActiveSubstitute(ctx, entry.row.InstanceID)
		if err != nil {
			return nil, err
		}
		if hasSubstitute {
			// An admin covered this block for the sick person; restoring
			// presence would silently overstaff it. Release the stamp and
			// keep the absence for the admin to resolve.
			entry.row.SickAbsenceID = nil
			if _, err := s.sickStamps.SetSickAbsence(ctx, entry.row.ID, entry.row.SickAbsenceID); err != nil {
				return nil, fmt.Errorf("sick clear: release row %d: %w", entry.row.ID, err)
			}
			s.getLogger().Info("sick clear kept a substituted block absent",
				"instance_id", entry.row.InstanceID,
				"staff_id", entry.row.StaffID,
			)
			continue
		}
		// The owner clears the block's understaffed acknowledgement when the
		// restore leaves it fully staffed again.
		if err := s.deviations.ClearSickAbsence(ctx, timetable.SickAbsenceClear{
			AssignmentID: entry.row.ID, SickAbsenceID: report.absenceID, Sick: report.sick(), ActorAccountID: report.actorAccountID,
		}, activeTouched); err != nil {
			return nil, fmt.Errorf("sick clear: clear block %d: %w", entry.row.InstanceID, err)
		}
		cleared = append(cleared, timetable.SickAbsenceNoticeBlock{InstanceID: entry.row.InstanceID, Date: day})
	}
	return cleared, nil
}
