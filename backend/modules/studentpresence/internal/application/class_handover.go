package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ClassHandoversOn returns the handovers of date (#4794), each assembled with
// its children from the same snapshot.
func (s *Service) ClassHandoversOn(ctx context.Context, date calendar.Date) (result []studentpresence.ClassHandover, err error) {
	if _, err := calendar.ParseDate(date.String()); err != nil {
		return nil, fmt.Errorf("%w: %w", studentpresence.ErrClassHandoverInvalid, err)
	}
	err = s.runWrite(ctx, "list_class_handovers", func(txCtx context.Context) (ports.Stats, error) {
		handovers, stats, err := s.store.ListClassHandovers(txCtx, date)
		result = make([]studentpresence.ClassHandover, 0, len(handovers))
		for _, handover := range handovers {
			// Keep the public lists non-nil and independent of store buffers.
			handover.PresentStudentIDs = append([]int64{}, handover.PresentStudentIDs...)
			handover.AbsentStudentIDs = append([]int64{}, handover.AbsentStudentIDs...)
			result = append(result, handover)
		}
		return stats, err
	})
	return result, err
}

// ChangeClassHandover stores the handover of one class (#4794), replacing an
// earlier one of the same class and date with the clock's now as its
// moment, or deletes it on Withdraw. It never touches the morning attendance
// or the OGS attendance.
func (s *Service) ChangeClassHandover(ctx context.Context, in studentpresence.ClassHandoverChange) (existed bool, err error) {
	class := strings.ToLower(strings.TrimSpace(in.SchoolClass))
	if _, dateErr := calendar.ParseDate(in.Date.String()); class == "" || dateErr != nil {
		return false, studentpresence.ErrClassHandoverInvalid
	}
	in.PresentStudentIDs = distinctIDs(in.PresentStudentIDs)
	in.AbsentStudentIDs = distinctIDs(in.AbsentStudentIDs)
	if !in.Withdraw && (in.HandedOverBy <= 0 || in.HandoverChildren == nil || !validHandoverChildren(in.PresentStudentIDs, in.AbsentStudentIDs)) {
		return false, studentpresence.ErrClassHandoverInvalid
	}
	in.SchoolClass = strings.TrimSpace(in.SchoolClass)
	err = s.runWrite(ctx, "change_class_handover", func(txCtx context.Context) (ports.Stats, error) {
		if in.Withdraw {
			stats, err := s.store.DeleteClassHandover(txCtx, class, in.Date)
			existed = stats.Rows > 0
			return stats, err
		}
		stats, err := s.checkClassHandover(txCtx, in, class)
		if err != nil {
			return stats, err
		}
		var replaceStats ports.Stats
		existed, replaceStats, err = s.store.ReplaceClassHandover(txCtx, in, class, s.now())
		stats.Queries += replaceStats.Queries
		stats.Rows += replaceStats.Rows
		stats.StatementDuration += replaceStats.StatementDuration
		return stats, err
	})
	return existed, err
}

// checkClassHandover takes the lock of the class and day and refuses a
// handover over another state than the one its Lehrkraft read (ADR 0311):
// another stored handover, another set of children in the dialog, or
// another morning absence mark of one of them. The dialog's children and
// their marks are read under that lock; the morning-mark writes of the
// class take it too, so no mark lands between this check and the
// handover's commit. A stale save would mark a child the class now has
// "nicht da", or no longer hands over, as "da".
func (s *Service) checkClassHandover(ctx context.Context, in studentpresence.ClassHandoverChange, class string) (ports.Stats, error) {
	stats, err := s.store.LockClassHandover(ctx, class, in.Date)
	if err != nil {
		return stats, err
	}
	handovers, listStats, err := s.store.ListClassHandovers(ctx, in.Date)
	stats.Queries += listStats.Queries
	stats.Rows += listStats.Rows
	stats.StatementDuration += listStats.StatementDuration
	if err != nil {
		return stats, err
	}
	var stored *studentpresence.ClassHandover
	for i := range handovers {
		if strings.ToLower(strings.TrimSpace(handovers[i].SchoolClass)) == class {
			stored = &handovers[i]
		}
	}
	children, err := in.HandoverChildren(ctx)
	if err != nil {
		return stats, err
	}
	morningAbsent, markStats, err := s.morningAbsentOf(ctx, in.Date, children)
	stats.Queries += markStats.Queries
	stats.Rows += markStats.Rows
	stats.StatementDuration += markStats.StatementDuration
	if err != nil {
		return stats, err
	}
	return stats, readstate.Check(in.ExpectedVersion, studentpresence.ClassHandoverVersion(stored, children, morningAbsent))
}

// morningAbsentOf lists the children among studentIDs whose stored morning
// mark of date is "absent".
func (s *Service) morningAbsentOf(ctx context.Context, date calendar.Date, studentIDs []int64) ([]int64, ports.Stats, error) {
	studentIDs = distinctIDs(studentIDs)
	if len(studentIDs) == 0 {
		return nil, ports.Stats{}, nil
	}
	entries, stats, err := s.store.ListMorningAttendance(ctx, date, date, studentIDs, nil)
	if err != nil {
		return nil, stats, err
	}
	absent := make([]int64, 0, len(entries))
	for _, entry := range entries {
		if entry.Child.StudentID > 0 && entry.Status == studentpresence.MorningAttendanceAbsent {
			absent = append(absent, entry.Child.StudentID)
		}
	}
	return absent, stats, nil
}

// validHandoverChildren accepts positive IDs, each child either "da" or
// "nicht da".
func validHandoverChildren(present, absent []int64) bool {
	if !validIDs(present) || !validIDs(absent) {
		return false
	}
	isPresent := make(map[int64]bool, len(present))
	for _, id := range present {
		isPresent[id] = true
	}
	for _, id := range absent {
		if isPresent[id] {
			return false
		}
	}
	return true
}

// distinctIDs keeps the first occurrence of each ID.
func distinctIDs(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
