package timetracking

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

const recentOwnLeaveLimit = 8

func (s ownTimeViews) LeaveOverview(ctx context.Context, staffID int64) (workforce.OwnLeaveOverview, error) {
	today := s.months.today()
	year := today.Year()
	input, err := s.absences.loadVacationQuotaInputs(ctx, staffID, year)
	if err != nil {
		return workforce.OwnLeaveOverview{}, err
	}
	quota := computeVacationQuotaSummary(staffID, year, input.entitled, input.carryover, input.absences, input.opening)
	questionRows, err := s.absences.absenceRepo.ListStaffAbsences(ctx, workforce.StaffAbsenceFilter{
		StaffID: staffID, Statuses: []string{workforce.AbsenceStatusQuestion},
		Order: []workforce.StaffAbsenceOrder{{Field: workforce.StaffAbsenceOrderRequestedAt, Descending: true}, {Field: workforce.StaffAbsenceOrderID}},
	})
	if err != nil {
		return workforce.OwnLeaveOverview{}, fmt.Errorf("own leave overview: open questions: %w", err)
	}
	counts, recent := ownRecentLeave(input.absences, today)
	questioned := slices.DeleteFunc(absencesToRecord(questionRows), func(a *StaffAbsence) bool { return !showsInOwnLeave(a) })
	slices.SortStableFunc(questioned, newestOwnLeaveFirst)
	counts.Question = len(questioned)

	visible := append(slices.Clone(recent), questioned...)
	absences, err := s.ownAbsenceRows(ctx, visible)
	if err != nil {
		return workforce.OwnLeaveOverview{}, err
	}
	allowances, err := s.planning.Allowances.AllowanceAccounts(ctx, staffID, year)
	if err != nil {
		return workforce.OwnLeaveOverview{}, err
	}
	mails, err := s.ownLeaveMailStatus(ctx, recent)
	if err != nil {
		return workforce.OwnLeaveOverview{}, err
	}
	return workforce.OwnLeaveOverview{
		Year: year, Counts: counts, Recent: absences[:len(recent)], Questions: absences[len(recent):],
		Quota: workforce.OwnLeaveQuota{
			EntitledDays: quota.EntitledDays, CarryoverDays: quota.CarryoverDays, TakenBeforeDays: quota.TakenBeforeDays,
			TakenDays: quota.TakenDays, ReservedDays: quota.ReservedDays, RemainingDays: quota.RemainingDays,
		},
		Allowances: ownLeaveAllowances(allowances), Mails: mails,
	}, nil
}

func ownRecentLeave(absences []*StaffAbsence, today calendar.Date) (workforce.OwnLeaveCounts, []*StaffAbsence) {
	var counts workforce.OwnLeaveCounts
	recent := make([]*StaffAbsence, 0)
	for _, a := range absences {
		if !showsInOwnLeave(a) || a.Status == workforce.AbsenceStatusQuestion {
			continue
		}
		switch a.Status {
		case workforce.AbsenceStatusRequested:
			counts.Reserved++
		case workforce.AbsenceStatusApproved, workforce.AbsenceStatusReported:
			if !a.DateEnd.Before(today) {
				counts.Approved++
			}
		case workforce.AbsenceStatusDeclined:
			counts.Declined++
		}
		recent = append(recent, a)
	}
	slices.SortStableFunc(recent, newestOwnLeaveFirst)
	return counts, recent[:min(len(recent), recentOwnLeaveLimit)]
}

func showsInOwnLeave(a *StaffAbsence) bool {
	return a.AbsenceType == workforce.AbsenceTypeVacation || (a.AbsenceTypeID != nil && a.Status != workforce.AbsenceStatusReported)
}

func newestOwnLeaveFirst(a, b *StaffAbsence) int {
	return ownLeaveSortInstant(b).Compare(ownLeaveSortInstant(a))
}

func ownLeaveSortInstant(a *StaffAbsence) time.Time {
	if a.RequestedAt.IsZero() {
		return a.DateStart.UTCMidnight()
	}
	return a.RequestedAt
}

func (s ownTimeViews) ownAbsenceRows(ctx context.Context, absences []*StaffAbsence) ([]workforce.OwnTimeAbsence, error) {
	var labels map[int64]string
	if s.absences.absenceTypes != nil && slices.ContainsFunc(absences, func(a *StaffAbsence) bool { return a.AbsenceTypeID != nil }) {
		var err error
		labels, err = s.absences.absenceTypes.LabelsByID(ctx)
		if err != nil {
			return nil, fmt.Errorf("own time views: absence labels: %w", err)
		}
	}
	rows := make([]workforce.OwnTimeAbsence, 0, len(absences))
	for _, a := range absences {
		label := a.AbsenceTypeLabel
		if a.AbsenceTypeID != nil {
			label = labels[*a.AbsenceTypeID]
		}
		rows = append(rows, workforce.OwnTimeAbsence{
			ID: ident.ID(a.ID), DateStart: a.DateStart, DateEnd: a.DateEnd, AbsenceType: a.AbsenceType,
			AbsenceTypeID: (*ident.ID)(a.AbsenceTypeID), AbsenceTypeLabel: label,
			HalfDay: a.HalfDay, StartHalfDay: a.StartHalfDay, EndHalfDay: a.EndHalfDay, Note: a.Note,
			Status: a.Status, DecisionNote: a.DecisionNote, RequestedAt: a.RequestedAt,
			DurationDays: absenceDurationDays(a), WorkingDays: a.WorkingDays,
		})
	}
	return rows, nil
}

func ownLeaveAllowances(accounts []workforce.AbsenceTypeAllowanceAccount) []workforce.OwnLeaveAllowance {
	rows := make([]workforce.OwnLeaveAllowance, 0, len(accounts))
	for _, account := range accounts {
		summary := account.Summary
		row := workforce.OwnLeaveAllowance{
			AbsenceTypeID: ident.ID(summary.AbsenceTypeID), Name: account.AbsenceType.Name,
			EntitledDays: summary.EntitledDays, TakenDays: summary.TakenDays, ReservedDays: summary.ReservedDays,
			RemainingDays: summary.RemainingDays, ExpiresOn: calendar.Date(summary.ExpiresOn), ExpiredDays: summary.ExpiredDays,
		}
		if carry := summary.CarriedIn; carry != nil {
			row.CarriedIn = &workforce.OwnLeaveAllowanceCarry{
				Year: carry.Year, RemainingDays: carry.RemainingDays, ExpiredDays: carry.ExpiredDays, ExpiresOn: calendar.Date(carry.ExpiresOn),
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func (s ownTimeViews) ownLeaveMailStatus(ctx context.Context, absences []*StaffAbsence) (workforce.OwnLeaveMails, error) {
	var waiting []int64
	for _, a := range absences {
		if a.Status == workforce.AbsenceStatusRequested {
			waiting = append(waiting, a.ID)
		}
	}
	result := workforce.OwnLeaveMails{State: workforce.OwnReadReady, Absences: map[ident.ID]map[string]int{}}
	if len(waiting) == 0 {
		return result, nil
	}
	if s.mails == nil {
		return workforce.OwnLeaveMails{State: workforce.OwnReadUnavailable}, nil
	}
	counts, state, err := optionalOwnRead(ctx, s.months.getLogger(), "absence_mails", func(ctx context.Context) (map[int64]map[string]int, error) {
		return s.mails.AbsenceRequestMails(ctx, waiting)
	})
	if state != workforce.OwnReadReady {
		return workforce.OwnLeaveMails{State: state}, err
	}
	for id, count := range counts {
		result.Absences[ident.ID(id)] = count
	}
	return result, nil
}
