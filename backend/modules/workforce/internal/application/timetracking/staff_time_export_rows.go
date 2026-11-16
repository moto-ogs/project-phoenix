package timetracking

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func sortStaffByName(staffMembers []OverviewStaff) {
	slices.SortStableFunc(staffMembers, func(a, b OverviewStaff) int {
		return compareExportStaff(TimeExportStaff{ID: a.ID, FirstName: a.FirstName, LastName: a.LastName}, TimeExportStaff{ID: b.ID, FirstName: b.FirstName, LastName: b.LastName})
	})
}

// GetMonthExportRows builds the payroll rows for every active staff member
// (#1417 2b). month == 0 means the whole year (January through the running
// month for the current year). It reuses the #1986 prefetch: one load for all
// staff members, then the UNCHANGED month math per staff member and month —
// the export cannot drift from the Monatskarte by construction.
func (s *staffOverviewService) GetMonthExportRows(ctx context.Context, year, month int) ([]MonthExportRow, error) {
	firstKey, lastKey, err := exportMonthRange(year, month, s.today())
	if err != nil {
		return nil, err
	}

	staffMembers, err := s.activeStaff(ctx)
	if err != nil {
		return nil, err
	}
	sortStaffByName(staffMembers)
	if len(staffMembers) == 0 {
		return []MonthExportRow{}, nil
	}
	// One prefetch for the whole request. `lower` widens the window to the
	// first requested month: for a year export the early months may lie before
	// the account anchor and are then computed as standalone months — exactly
	// like the per-staff Monatskarte does.
	lower := firstKey.firstDay()
	prefetch, err := s.buildPrefetch(ctx, staffMembers, &lower, lastKey)
	if err != nil {
		return nil, err
	}
	monthSvc := newPrefetchedMonthService(prefetch, s.logger)
	payroll, err := s.loadExportPayroll(ctx, firstKey, lastKey)
	if err != nil {
		return nil, err
	}

	paidByTraeger, err := s.traegerPaidStaff(ctx, staffMembers, firstKey, lastKey)
	if err != nil {
		return nil, err
	}
	rows := make([]MonthExportRow, 0, len(staffMembers))
	for _, staff := range staffMembers {
		for key := firstKey; !lastKey.before(key); key = key.next() {
			if paidByTraeger[key][staff.ID] {
				continue
			}
			row, err := exportMonthRow(ctx, monthSvc, payroll, prefetch, staff, key)
			if err != nil {
				return nil, err
			}
			rows = append(rows, row)
		}
	}
	return rows, nil
}

// exportMonthRow computes one staff member's month and its payroll columns.
func exportMonthRow(ctx context.Context, monthSvc WorkTimeMonthService, payroll *exportPayroll, prefetch *monthPrefetch, staff OverviewStaff, key monthKey) (MonthExportRow, error) {
	summary, err := monthSvc.GetMonthSummary(ctx, staff.ID, key.Year, key.Month)
	if err != nil {
		return MonthExportRow{}, fmt.Errorf("failed to compute month summary for staff %d: %w", staff.ID, err)
	}
	row := buildMonthExportRow(staff, summary)
	if err := payroll.apply(&row, summary, prefetch, key); err != nil {
		return MonthExportRow{}, err
	}
	return row, nil
}

// traegerPaidStaff names, per month, the staff a contract of the Träger
// covers: the Träger closes and pays them, so the school's payroll file
// leaves them out (#4711, decision E6). One read for the whole range.
func (s *staffOverviewService) traegerPaidStaff(ctx context.Context, staffMembers []OverviewStaff, firstKey, lastKey monthKey) (map[monthKey]map[int64]bool, error) {
	result := map[monthKey]map[int64]bool{}
	if s.traeger == nil {
		return result, nil
	}
	staffIDs := make([]int64, 0, len(staffMembers))
	for _, staff := range staffMembers {
		staffIDs = append(staffIDs, staff.ID)
	}
	kept, err := s.traeger.TraegerKeptStaffByMonth(ctx, staffIDs, firstKey.firstDay(), lastKey.lastDay())
	if err != nil {
		return nil, fmt.Errorf("failed to read the staff the traeger pays: %w", err)
	}
	for key := firstKey; !lastKey.before(key); key = key.next() {
		result[key] = map[int64]bool{}
		for _, id := range kept[key.firstDay()] {
			result[key][id] = true
		}
	}
	return result, nil
}

// exportMonthRange validates the requested export period and returns its
// first and last month; month == 0 is the year, cut at the running month.
func exportMonthRange(year, month int, today calendar.Date) (monthKey, monthKey, error) {
	if year < 2000 || year > 2100 {
		return monthKey{}, monthKey{}, fmt.Errorf("%w: year out of range", ErrTimeExportInvalid)
	}
	if month < 0 || month > 12 {
		return monthKey{}, monthKey{}, fmt.Errorf("%w: month out of range", ErrTimeExportInvalid)
	}
	if year > today.Year() {
		return monthKey{}, monthKey{}, fmt.Errorf("%w: year %d lies in the future", ErrTimeExportInvalid, year)
	}
	if month != 0 && monthOf(today).before(monthKey{Year: year, Month: month}) {
		return monthKey{}, monthKey{}, fmt.Errorf("%w: month %04d-%02d lies in the future", ErrTimeExportInvalid, year, month)
	}

	firstKey := monthKey{Year: year, Month: month}
	lastKey := firstKey
	if month == 0 {
		firstKey = monthKey{Year: year, Month: 1}
		lastKey = monthKey{Year: year, Month: 12}
		if todayKey := monthOf(today); todayKey.before(lastKey) && year == today.Year() {
			lastKey = todayKey
		}
	}
	return firstKey, lastKey, nil
}

// buildMonthExportRow copies a MonthSummary into the export shape. The only
// transformation is splitting the adjustment ledger by type — payout,
// comp_time and reset are the categories that later map to DATEV Lohnarten,
// so the file carries them as separate columns.
func buildMonthExportRow(staff OverviewStaff, summary *MonthSummary) MonthExportRow {
	row := MonthExportRow{
		StaffID:                 summary.StaffID,
		Year:                    summary.Year,
		Month:                   summary.Month,
		CarryInMinutes:          summary.CarryInMinutes,
		TargetMinutes:           summary.TargetMinutesToDate,
		ActualMinutes:           summary.ActualMinutes,
		CreditedSickMinutes:     summary.CreditedSickMinutes,
		CreditedVacationMinutes: summary.CreditedVacationMinutes,
		CreditedTrainingMinutes: summary.CreditedTrainingMinutes,
		CreditedOtherMinutes:    summary.CreditedOtherMinutes,
		SickDays:                summary.SickDays,
		VacationDays:            summary.VacationDays,
		TrainingDays:            summary.TrainingDays,
		BalanceMinutes:          summary.BalanceMinutes,
		ClosingBalanceMinutes:   summary.ClosingBalanceMinutes,
		DriftMinutes:            summary.DriftMinutes,
		IsClosed:                summary.IsClosed,
		ClosedAt:                summary.ClosedAt,
	}
	// The authoritative month-end carry of a closed month is the FROZEN value —
	// the number the following month really starts from (#1986). The live
	// difference stays visible as DriftMinutes instead of being smoothed away.
	if summary.IsClosed && summary.FrozenClosingBalanceMinutes != nil {
		row.ClosingBalanceMinutes = *summary.FrozenClosingBalanceMinutes
	}
	for _, adjustment := range summary.Adjustments {
		switch adjustment.Type {
		case BalanceAdjustmentTypePayout:
			row.PayoutMinutes += adjustment.MinutesDelta
		case BalanceAdjustmentTypeCompTime:
			row.CompTimeMinutes += adjustment.MinutesDelta
		case BalanceAdjustmentTypeReset:
			row.ResetMinutes += adjustment.MinutesDelta
		case BalanceAdjustmentTypeOpening:
			row.OpeningMinutes += adjustment.MinutesDelta
		}
	}
	if staff.EmploymentType != nil {
		row.EmploymentType = *staff.EmploymentType
	}
	if staff.PersonnelNumber != nil {
		row.PersonnelNumber = *staff.PersonnelNumber
	}
	row.FirstName, row.LastName = staff.FirstName, staff.LastName
	return row
}

// --- day rows --------------------------------------------------------------

// DayExportRow is one rendered day cell-row of the per-staff export, exposed
// for the cross-staff evidence export.
type DayExportRow struct {
	Date  calendar.Date
	Cells []string
}

func (s *workSessionService) DayExportRows(ctx context.Context, staffID int64, from, to calendar.Date) ([]DayExportRow, error) {
	rowsByStaff, err := s.DayExportRowsByStaffIDs(ctx, []int64{staffID}, from, to)
	if err != nil {
		return nil, err
	}
	return rowsByStaff[staffID], nil
}

func (s *workSessionService) DayExportRowsByStaffIDs(ctx context.Context, staffIDs []int64, from, to calendar.Date) (map[int64][]DayExportRow, error) {
	result := make(map[int64][]DayExportRow, len(staffIDs))
	if len(staffIDs) == 0 {
		return result, nil
	}
	responsesByStaff, absencesByStaff, err := s.loadDayExport(ctx, staffIDs, from, to)
	if err != nil {
		return nil, err
	}
	for _, staffID := range staffIDs {
		absences := clampAbsencesToRange(absencesByStaff[staffID], from, to)
		merged := s.buildExportRows(responsesByStaff[staffID], absences)
		rows := make([]DayExportRow, 0, len(merged))
		for _, row := range merged {
			rows = append(rows, DayExportRow{Date: row.Date, Cells: row.Row})
		}
		result[staffID] = rows
	}
	return result, nil
}

// loadDayExport loads the blocks and absences of the staff members in the
// range with a constant number of repository calls: the blocks with their
// breaks per staff member in check-in order, the absences with the school's
// own wording.
func (s *workSessionService) loadDayExport(ctx context.Context, staffIDs []int64, from, to calendar.Date) (map[int64][]*SessionResponse, map[int64][]*StaffAbsence, error) {
	sessionsByStaffRecords, err := s.repo.ListWorkSessions(ctx, workforce.WorkSessionFilter{StaffIDs: staffIDs, DateFrom: from.String(), DateTo: to.String(), Order: workSessionOrder(workforce.WorkSessionOrderStaffID, workforce.WorkSessionOrderDate, workforce.WorkSessionOrderCheckInTime)})
	sessionsByStaff := workSessionsByStaff(sessionsByStaffRecords)
	err = rowReadError("get history by staff IDs", err, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get sessions for export: %w", err)
	}

	absencesByStaff := make(map[int64][]*StaffAbsence, len(staffIDs))
	if s.absenceRepo != nil {
		absenceValues, err := s.absenceRepo.ListStaffAbsences(ctx, workforce.StaffAbsenceFilter{StaffIDs: staffIDs, OverlapFrom: from.String(), OverlapTo: to.String(), Order: []workforce.StaffAbsenceOrder{{Field: workforce.StaffAbsenceOrderStaffID}, {Field: workforce.StaffAbsenceOrderDateStart}}})
		absencesByStaff = staffAbsencesByID(absenceValues)
		err = rowReadError("get absences by staff IDs and date range", err, nil)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to get absences for export: %w", err)
		}
		allAbsences := make([]*StaffAbsence, 0)
		for _, absences := range absencesByStaff {
			allAbsences = append(allAbsences, absences...)
		}
		// The cross-staff export must use the same school-defined wording as
		// the single-staff export rather than falling back to "Sonstige".
		StampAbsenceTypeLabels(ctx, s.absenceTypes, allAbsences, s.getLogger())
	}

	allSessions := make([]*WorkSession, 0)
	for _, staffID := range staffIDs {
		allSessions = append(allSessions, sessionsByStaff[staffID]...)
	}
	responses, err := s.buildDayExportSessionResponses(ctx, allSessions)
	if err != nil {
		return nil, nil, err
	}
	responsesByStaff := make(map[int64][]*SessionResponse, len(staffIDs))
	for _, response := range responses {
		responsesByStaff[response.StaffID] = append(responsesByStaff[response.StaffID], response)
	}
	return responsesByStaff, absencesByStaff, nil
}

func (s *workSessionService) buildDayExportSessionResponses(ctx context.Context, sessions []*WorkSession) ([]*SessionResponse, error) {
	sessionIDs := make([]int64, len(sessions))
	for i, session := range sessions {
		sessionIDs[i] = session.ID
	}

	editCounts, err := s.auditRepo.CountManualBySessionIDs(ctx, sessionIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to get edit counts: %w", err)
	}

	breaksBySession := make(map[int64][]*WorkSessionBreak, len(sessions))
	if len(sessionIDs) > 0 {
		breaksBySessionRecords, err := s.breakRepo.ListWorkSessionBreaks(ctx, workforce.WorkSessionBreakFilter{SessionIDs: sessionIDs})
		breaksBySession = workBreaksBySession(breaksBySessionRecords)
		err = rowReadError("get breaks by session IDs", err, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to get breaks for export: %w", err)
		}
	}

	now := s.now()
	responses := make([]*SessionResponse, len(sessions))
	for i, session := range sessions {
		breaks := breaksBySession[session.ID]
		credit := sessionCredit(session)
		responses[i] = &SessionResponse{
			WorkSession:     session,
			BreakMinutes:    totalBreakMinutes(session, breaks, now),
			NetMinutes:      creditedNetMinutes(session, breaks, now),
			EditCount:       editCounts[session.ID],
			PackUpMinutes:   credit.PackUpMinutes,
			RoundingMinutes: credit.RoundingMinutes,
		}
	}
	return responses, nil
}
