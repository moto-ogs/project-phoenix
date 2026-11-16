package timetracking

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The school's side of the Träger's exports (#4712, ADR 0249): the month of
// each employment in the values the payroll file books, and its days for the
// time export. Both run in the school's tenant transaction the Träger opens
// and reuse the computations of the school's own exports, so the Träger's
// file shows the numbers of the Monatskarte and of the evidence export.

// TraegerExportSchool serves the months and days of the school to the
// Träger's payroll file and time export. The overview answers the months
// itself; the days pass its staff check first.
type TraegerExportSchool struct {
	traegerPayrollMonths
	staff traegerTimeStaff
	days  traegerTimeDays
}

var _ workforce.TraegerStaffExportSchool = TraegerExportSchool{}

type traegerPayrollMonths interface {
	TraegerPayrollMonths(ctx context.Context, staffIDs []int64, year, month int) ([]workforce.TraegerPayrollMonth, error)
}

type traegerTimeStaff interface {
	traegerTimeStaff(ctx context.Context, staffIDs []int64) ([]int64, error)
}

type traegerTimeDays interface {
	TraegerTimeDays(ctx context.Context, staffIDs []int64, from, to calendar.Date) ([]workforce.TraegerTimeDay, error)
}

// TraegerExportCapability binds the overview and the work sessions.
func TraegerExportCapability(overview StaffOverviewService, sessions WorkSessionService) TraegerExportSchool {
	if overview == nil || sessions == nil {
		panic("traeger export capability: the overview and the work sessions are required")
	}
	return TraegerExportSchool{traegerPayrollMonths: overview, staff: overview, days: sessions}
}

// TraegerTimeDays keeps the named employments the payroll file would keep
// too and reads the days of the kept ones the file carries.
func (s TraegerExportSchool) TraegerTimeDays(ctx context.Context, request workforce.TraegerTimeRequest) (workforce.TraegerTimeSchool, error) {
	kept, err := s.staff.traegerTimeStaff(ctx, request.StaffIDs)
	if err != nil {
		return workforce.TraegerTimeSchool{}, err
	}
	daysFor := slices.DeleteFunc(slices.Clone(request.DaysFor), func(id int64) bool { return !slices.Contains(kept, id) })
	result := workforce.TraegerTimeSchool{Kept: kept, Days: []workforce.TraegerTimeDay{}}
	if len(daysFor) > 0 {
		result.Days, err = s.days.TraegerTimeDays(ctx, daysFor, request.From, request.To)
	}
	return result, err
}

// TraegerPayrollMonths computes the month of the employments with the
// prefetch and month math of the school's payroll file (#1417 2b). Unlike
// that file it keeps the people the Träger closes and books no wage type of
// the school: the Träger's Lohnarten apply (ADR 0089 section 11).
func (s *staffOverviewService) TraegerPayrollMonths(ctx context.Context, staffIDs []int64, year, month int) ([]workforce.TraegerPayrollMonth, error) {
	if month == 0 {
		return nil, fmt.Errorf("%w: the payroll file needs a single month", workforce.ErrTraegerExportInvalid)
	}
	key, _, err := exportMonthRange(year, month, s.today())
	if err != nil {
		return nil, fmt.Errorf("%w: %w", workforce.ErrTraegerExportInvalid, err)
	}
	// Offboarded employments stay in: the month a person left is billed
	// after the school ended the membership.
	staffMembers, err := s.staffRepo.FindOverviewStaff(ctx, staffIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to find staff: %w", err)
	}
	kept := slices.DeleteFunc(staffMembers, func(member OverviewStaff) bool { return member.ExternalCaregiver })
	if len(kept) == 0 {
		return []workforce.TraegerPayrollMonth{}, nil
	}
	sortStaffByName(kept)
	lower := key.firstDay()
	prefetch, err := s.buildPrefetch(ctx, kept, &lower, key)
	if err != nil {
		return nil, err
	}
	monthSvc := newPrefetchedMonthService(prefetch, s.logger)
	months := make([]workforce.TraegerPayrollMonth, 0, len(kept))
	for _, staff := range kept {
		row, err := exportMonthRow(ctx, monthSvc, nil, prefetch, staff, key)
		if err != nil {
			return nil, err
		}
		months = append(months, traegerPayrollMonth(row))
	}
	return months, nil
}

// traegerTimeStaff keeps the given employments in their order without the
// external caregivers; offboarded ones stay.
func (s *staffOverviewService) traegerTimeStaff(ctx context.Context, staffIDs []int64) ([]int64, error) {
	if len(staffIDs) == 0 {
		return []int64{}, nil
	}
	members, err := s.staffRepo.FindOverviewStaff(ctx, staffIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to find staff: %w", err)
	}
	keep := make(map[int64]bool, len(members))
	for _, member := range members {
		keep[member.ID] = !member.ExternalCaregiver
	}
	return slices.DeleteFunc(slices.Clone(staffIDs), func(id int64) bool { return !keep[id] }), nil
}

// traegerPayrollMonth copies the row fields the school's DATEV file books
// (datevCategoryValue): payout and comp time are negative balance deltas,
// the booked value is the inverted delta; an opening booked in the month is
// no payroll value.
func traegerPayrollMonth(row MonthExportRow) workforce.TraegerPayrollMonth {
	plus := row.BalanceMinutes - row.OpeningMinutes
	if plus < 0 {
		plus = 0
	}
	return workforce.TraegerPayrollMonth{
		StaffID: row.StaffID, RegularMinutes: row.ActualMinutes, PlusMinutes: plus,
		PayoutMinutes: -row.PayoutMinutes, CompTimeMinutes: -row.CompTimeMinutes,
		SickMinutes: row.CreditedSickMinutes, VacationMinutes: row.CreditedVacationMinutes, TrainingMinutes: row.CreditedTrainingMinutes,
		SickDays: row.SickDays, VacationDays: row.VacationDays, TrainingDays: row.TrainingDays,
		Closed: row.IsClosed,
	}
}

// TraegerTimeDays folds the blocks and absences of the evidence export into
// one row per staff member and day: the first start, the last end, the
// breaks plus the gaps between two blocks, the credited net time and the
// absence. An open block leaves the end empty.
func (s *workSessionService) TraegerTimeDays(ctx context.Context, staffIDs []int64, from, to calendar.Date) ([]workforce.TraegerTimeDay, error) {
	if to.Before(from) {
		return nil, fmt.Errorf("%w: the range ends before it starts", workforce.ErrTraegerExportInvalid)
	}
	if len(staffIDs) == 0 {
		return []workforce.TraegerTimeDay{}, nil
	}
	responsesByStaff, absencesByStaff, err := s.loadDayExport(ctx, staffIDs, from, to)
	if err != nil {
		return nil, err
	}
	var days []workforce.TraegerTimeDay
	for _, staffID := range staffIDs {
		days = append(days, traegerStaffDays(staffID, responsesByStaff[staffID], clampAbsencesToRange(absencesByStaff[staffID], from, to))...)
	}
	return days, nil
}

// dayFold collects the days of one staff member in date order.
type dayFold struct {
	staffID int64
	byDay   map[calendar.Date]*workforce.TraegerTimeDay
	order   []calendar.Date
	// lastEnd is the end of the day's previous block; a gap to the next
	// block counts as a break. open marks a day with a running block.
	lastEnd map[calendar.Date]time.Time
	open    map[calendar.Date]bool
}

func (f *dayFold) day(date calendar.Date) *workforce.TraegerTimeDay {
	if entry, ok := f.byDay[date]; ok {
		return entry
	}
	entry := &workforce.TraegerTimeDay{StaffID: f.staffID, Date: date}
	f.byDay[date] = entry
	f.order = append(f.order, date)
	return entry
}

func (f *dayFold) addSession(session *SessionResponse) {
	entry := f.day(session.Date)
	if entry.Start == "" {
		entry.Start = session.CheckInTime.In(calendar.Berlin).Format("15:04")
	} else if end, ok := f.lastEnd[session.Date]; ok {
		entry.BreakMinutes += max(int(session.CheckInTime.Sub(end).Minutes()), 0)
	}
	entry.BreakMinutes += session.BreakMinutes
	entry.ActualMinutes += session.NetMinutes
	if session.CheckOutTime == nil {
		f.open[session.Date], entry.End = true, ""
		delete(f.lastEnd, session.Date)
		return
	}
	f.lastEnd[session.Date] = *session.CheckOutTime
	if !f.open[session.Date] {
		entry.End = session.CheckOutTime.In(calendar.Berlin).Format("15:04")
	}
}

func (f *dayFold) addAbsence(absence *StaffAbsence) {
	if absence.Status != AbsenceStatusReported && absence.Status != AbsenceStatusApproved {
		return
	}
	label := absence.AbsenceTypeLabel
	if label == "" {
		label = germanAbsenceTypeLabels[absence.AbsenceType]
	}
	if label == "" {
		label = absence.AbsenceType
	}
	for d := absence.DateStart; !d.After(absence.DateEnd); d = d.AddDays(1) {
		entry := f.day(d)
		entry.AbsenceKind, entry.AbsenceLabel = absence.AbsenceType, label
	}
}

func traegerStaffDays(staffID int64, sessions []*SessionResponse, absences []*StaffAbsence) []workforce.TraegerTimeDay {
	fold := &dayFold{staffID: staffID, byDay: map[calendar.Date]*workforce.TraegerTimeDay{},
		lastEnd: map[calendar.Date]time.Time{}, open: map[calendar.Date]bool{}}
	for _, session := range sessions {
		fold.addSession(session)
	}
	for _, absence := range absences {
		fold.addAbsence(absence)
	}
	slices.SortFunc(fold.order, func(a, b calendar.Date) int { return a.Compare(b) })
	result := make([]workforce.TraegerTimeDay, 0, len(fold.order))
	for _, date := range fold.order {
		result = append(result, *fold.byDay[date])
	}
	return result
}
