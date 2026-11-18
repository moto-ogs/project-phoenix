package application

import (
	"context"
	"math"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ traegerview.DailyAttendanceReport = (*Overview)(nil)

// DailyAttendance returns the daily attendance report of the Träger's
// schools in Mecklenburg-Vorpommern (#4717). Every owner is read once for the
// whole school set. The answer names no child, yet a day with one child shows
// that child's times, so each school with child-days records the read in its
// access log before the answer leaves.
func (o *Overview) DailyAttendance(ctx context.Context, viewer traegerview.Viewer, from, to calendar.Date) (traegerview.DailyAttendance, error) {
	if viewer.AccountID <= 0 {
		return traegerview.DailyAttendance{}, traegerview.ErrTraegerRequired
	}
	data, err := o.dailyAttendanceData(ctx, viewer.OrganizationID, from, to)
	if err != nil {
		return traegerview.DailyAttendance{}, err
	}
	if err := o.recordDailyAttendance(ctx, viewer, traegerview.ResourceTypeTraegerDailyAttendance, "list", data, shownChildDays(data)); err != nil {
		return traegerview.DailyAttendance{}, err
	}
	return buildDailyAttendance(data), nil
}

// DailyAttendanceExport returns one record per child and day and writes the
// export to the access log of every school it holds rows of, before it
// answers: no file leaves without its entry.
func (o *Overview) DailyAttendanceExport(ctx context.Context, viewer traegerview.Viewer, from, to calendar.Date) (traegerview.DailyAttendanceExport, error) {
	if viewer.AccountID <= 0 {
		return traegerview.DailyAttendanceExport{}, traegerview.ErrTraegerRequired
	}
	data, err := o.dailyAttendanceData(ctx, viewer.OrganizationID, from, to)
	if err != nil {
		return traegerview.DailyAttendanceExport{}, err
	}
	export := buildDailyAttendanceExport(data)
	shown := map[int64]int{}
	for _, record := range export.Records {
		shown[record.SchoolID]++
	}
	if err := o.recordDailyAttendance(ctx, viewer, traegerview.ResourceTypeTraegerDailyAttendanceExport, "export", data, shown); err != nil {
		return traegerview.DailyAttendanceExport{}, err
	}
	return export, nil
}

// recordDailyAttendance writes a read of the report to the access log of
// every school with rows, for the Berlin days of its period.
func (o *Overview) recordDailyAttendance(ctx context.Context, viewer traegerview.Viewer, resourceType, view string, data dailyAttendanceData, shown map[int64]int) error {
	span := window{from: data.from.BerlinMidnight(), to: data.to.AddDays(1).BerlinMidnight()}
	return o.record(ctx, viewer, resourceType, span, shown, view, 0)
}

// shownChildDays counts the child-days, present or absent, of each school.
func shownChildDays(data dailyAttendanceData) map[int64]int {
	shown := map[int64]int{}
	for _, day := range data.days {
		shown[day.SchoolID]++
	}
	for _, absence := range data.absences {
		shown[absence.SchoolID]++
	}
	return shown
}

// FederalStates returns the federal states of the Träger's schools, each
// once and sorted.
func (o *Overview) FederalStates(ctx context.Context, organizationID int64) ([]string, error) {
	if organizationID <= 0 {
		return nil, traegerview.ErrTraegerRequired
	}
	states, err := o.daily.States.TraegerSchoolStates(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(states))
	for _, state := range states {
		if state != "" && !slices.Contains(result, state) {
			result = append(result, state)
		}
	}
	slices.Sort(result)
	return result, nil
}

// dailyAttendanceData is what the owners answered for one report.
type dailyAttendanceData struct {
	from, to calendar.Date
	schools  []traegerview.TraegerSchool
	other    int
	days     []traegerview.ChildDay
	absences []traegerview.AbsenceDay
}

// dailyAttendanceData checks the period, keeps the schools in
// Mecklenburg-Vorpommern and reads their days. The federal states come from
// the settings system in units of their own, before the administrative unit.
func (o *Overview) dailyAttendanceData(ctx context.Context, organizationID int64, from, to calendar.Date) (dailyAttendanceData, error) {
	if organizationID <= 0 {
		return dailyAttendanceData{}, traegerview.ErrTraegerRequired
	}
	from, to, err := dailyAttendancePeriod(from, to, calendar.DateFromTime(o.now()))
	if err != nil {
		return dailyAttendanceData{}, err
	}
	states, err := o.daily.States.TraegerSchoolStates(ctx, organizationID)
	if err != nil {
		return dailyAttendanceData{}, err
	}
	data := dailyAttendanceData{from: from, to: to}
	err = o.read(ctx, organizationID, func(adminCtx context.Context, ids []int64) error {
		scope := make([]int64, 0, len(ids))
		for _, id := range ids {
			if states[id] == traegerview.FederalStateMecklenburgVorpommern {
				scope = append(scope, id)
			}
		}
		data.other = len(ids) - len(scope)
		if len(scope) == 0 {
			data.schools = []traegerview.TraegerSchool{}
			return nil
		}
		var err error
		if data.schools, err = o.rows.Schools(adminCtx, scope); err != nil {
			return err
		}
		if data.days, err = o.daily.Days.ChildDaysByTenant(adminCtx, scope, from, to); err != nil {
			return err
		}
		data.absences, err = o.daily.Absences.AbsenceDaysByTenant(adminCtx, scope, from, to)
		return err
	})
	if err != nil {
		return dailyAttendanceData{}, err
	}
	return data, nil
}

// dailyAttendancePeriod checks a period and ends it yesterday at the latest:
// today's pickups are not over yet.
func dailyAttendancePeriod(from, to, today calendar.Date) (calendar.Date, calendar.Date, error) {
	if from.IsZero() || to.IsZero() || to.Before(from) {
		return "", "", traegerview.ErrInvalidDailyAttendancePeriod
	}
	if yesterday := today.AddDays(-1); yesterday.Before(to) {
		to = yesterday
	}
	if to.Before(from) || from.DaysUntil(to) >= traegerview.DailyAttendanceMaxDays {
		return "", "", traegerview.ErrInvalidDailyAttendancePeriod
	}
	return from, to, nil
}

// schoolDay is one day of one school.
type schoolDay struct {
	school int64
	date   calendar.Date
}

// childOnDay is one child on one day of one school.
type childOnDay struct {
	schoolDay
	student int64
}

// dayTally adds up child-days. It keeps the sum of the stays, so tallies of
// several days or schools merge into a correct average.
type dayTally struct {
	figures traegerview.DailyAttendanceFigures
	minutes int
	stays   int
}

func (t *dayTally) addPresent(day traegerview.ChildDay) {
	t.figures.Present++
	arrived := day.ArrivedAt
	if t.figures.FirstArrival == nil || arrived.Before(*t.figures.FirstArrival) {
		t.figures.FirstArrival = &arrived
	}
	minutes, ok := stayMinutes(day)
	if !ok {
		t.figures.WithoutPickup++
		return
	}
	left := *day.LeftAt
	if t.figures.LastPickup == nil || left.After(*t.figures.LastPickup) {
		t.figures.LastPickup = &left
	}
	t.minutes += minutes
	t.stays++
	if t.figures.LongestMinutes == nil || minutes > *t.figures.LongestMinutes {
		t.figures.LongestMinutes = &minutes
	}
}

func (t *dayTally) addAbsent(status string) {
	switch status {
	case traegerview.AttendanceSick:
		t.figures.Sick++
	case traegerview.AttendanceExcused:
		t.figures.Excused++
	case traegerview.AttendanceClassTrip:
		t.figures.ClassTrip++
	}
}

func (t *dayTally) merge(other dayTally) {
	t.figures.Present += other.figures.Present
	t.figures.Sick += other.figures.Sick
	t.figures.Excused += other.figures.Excused
	t.figures.ClassTrip += other.figures.ClassTrip
	t.figures.WithoutPickup += other.figures.WithoutPickup
	t.figures.FirstArrival = earlier(t.figures.FirstArrival, other.figures.FirstArrival)
	t.figures.LastPickup = later(t.figures.LastPickup, other.figures.LastPickup)
	if other.figures.LongestMinutes != nil && (t.figures.LongestMinutes == nil || *other.figures.LongestMinutes > *t.figures.LongestMinutes) {
		longest := *other.figures.LongestMinutes
		t.figures.LongestMinutes = &longest
	}
	t.minutes += other.minutes
	t.stays += other.stays
}

// result is the figures with the average of the stays, rounded to the
// minute.
func (t dayTally) result() traegerview.DailyAttendanceFigures {
	figures := t.figures
	if t.stays > 0 {
		average := int(math.Round(float64(t.minutes) / float64(t.stays)))
		figures.AverageMinutes = &average
	}
	return figures
}

// stayMinutes is the length of a child's stay in whole minutes; false
// without a pickup.
func stayMinutes(day traegerview.ChildDay) (int, bool) {
	if day.LeftAt == nil {
		return 0, false
	}
	return max(int(day.LeftAt.Sub(day.ArrivedAt)/time.Minute), 0), true
}

func earlier(a, b *time.Time) *time.Time {
	if a == nil || (b != nil && b.Before(*a)) {
		return b
	}
	return a
}

func later(a, b *time.Time) *time.Time {
	if a == nil || (b != nil && b.After(*a)) {
		return b
	}
	return a
}

// presentChildren keys the children present on a day, so an absence of the
// same child on that day does not count (place before status).
func presentChildren(days []traegerview.ChildDay) map[childOnDay]bool {
	present := make(map[childOnDay]bool, len(days))
	for _, day := range days {
		present[childOnDay{schoolDay{day.SchoolID, day.Date}, day.StudentID}] = true
	}
	return present
}

// buildDailyAttendance applies the definitions of
// traegerview.DailyAttendance to the owners' answer.
func buildDailyAttendance(data dailyAttendanceData) traegerview.DailyAttendance {
	tallies := tallyDays(data)
	result := traegerview.DailyAttendance{
		From: data.from, To: data.to, FederalState: traegerview.FederalStateMecklenburgVorpommern,
		OtherSchools: data.other, Days: []traegerview.DailyAttendanceDay{},
		Schools: make([]traegerview.SchoolDailyAttendance, 0, len(data.schools)),
	}
	all := map[calendar.Date]*dayTally{}
	var total dayTally
	for _, school := range data.schools {
		entry, schoolTotal := schoolDailyAttendance(school, data.from, data.to, tallies, all)
		total.merge(schoolTotal)
		result.Schools = append(result.Schools, entry)
	}
	for date := data.from; !data.to.Before(date); date = date.AddDays(1) {
		if day, ok := all[date]; ok {
			result.Days = append(result.Days, traegerview.DailyAttendanceDay{Date: date, DailyAttendanceFigures: day.result()})
		}
	}
	result.Summary = summary(total, result.Days)
	return result
}

// tallyDays adds the children's days and absences up per school and day.
func tallyDays(data dailyAttendanceData) map[schoolDay]*dayTally {
	tallies := map[schoolDay]*dayTally{}
	tally := func(key schoolDay) *dayTally {
		if tallies[key] == nil {
			tallies[key] = &dayTally{}
		}
		return tallies[key]
	}
	for _, day := range data.days {
		tally(schoolDay{day.SchoolID, day.Date}).addPresent(day)
	}
	present := presentChildren(data.days)
	for _, absence := range data.absences {
		key := schoolDay{absence.SchoolID, absence.Date}
		if !present[childOnDay{key, absence.StudentID}] {
			tally(key).addAbsent(absence.Status)
		}
	}
	return tallies
}

// schoolDailyAttendance lists the days of one school, Saturday and Sunday
// only with a child on them, and adds each day to all schools together.
func schoolDailyAttendance(school traegerview.TraegerSchool, from, to calendar.Date, tallies map[schoolDay]*dayTally, all map[calendar.Date]*dayTally) (traegerview.SchoolDailyAttendance, dayTally) {
	entry := traegerview.SchoolDailyAttendance{TraegerSchool: school, Days: []traegerview.DailyAttendanceDay{}}
	var total dayTally
	for date := from; !to.Before(date); date = date.AddDays(1) {
		day, recorded := tallies[schoolDay{school.ID, date}]
		if !recorded {
			if weekday := date.Weekday(); weekday == time.Saturday || weekday == time.Sunday {
				continue
			}
			day = &dayTally{}
		}
		entry.Days = append(entry.Days, traegerview.DailyAttendanceDay{Date: date, DailyAttendanceFigures: day.result()})
		total.merge(*day)
		if all[date] == nil {
			all[date] = &dayTally{}
		}
		all[date].merge(*day)
	}
	entry.Summary = summary(total, entry.Days)
	return entry, total
}

// summary is a period's figures with its days that had children.
func summary(total dayTally, days []traegerview.DailyAttendanceDay) traegerview.DailyAttendanceSummary {
	result := traegerview.DailyAttendanceSummary{DailyAttendanceFigures: total.result()}
	for _, day := range days {
		if day.Present > 0 {
			result.DaysWithChildren++
		}
	}
	if result.DaysWithChildren > 0 {
		result.PresentPerDay = math.Round(float64(total.figures.Present)/float64(result.DaysWithChildren)*10) / 10
	}
	return result
}

// statusOrder sorts the records of a day: present children first, then sick,
// excused and on a class trip.
var statusOrder = map[string]int{
	traegerview.AttendancePresent: 0, traegerview.AttendanceSick: 1,
	traegerview.AttendanceExcused: 2, traegerview.AttendanceClassTrip: 3,
}

// buildDailyAttendanceExport lists one record per child and day, without
// name or ID, ordered by school name, day, status and arrival. The order
// never follows a student ID, so a row's position reveals no child.
func buildDailyAttendanceExport(data dailyAttendanceData) traegerview.DailyAttendanceExport {
	position := make(map[int64]int, len(data.schools))
	for i, school := range data.schools {
		position[school.ID] = i
	}
	records := make([]traegerview.DailyAttendanceRecord, 0, len(data.days)+len(data.absences))
	for _, day := range data.days {
		arrived := day.ArrivedAt
		record := traegerview.DailyAttendanceRecord{SchoolID: day.SchoolID, Date: day.Date, Status: traegerview.AttendancePresent, ArrivedAt: &arrived}
		if minutes, ok := stayMinutes(day); ok {
			left := *day.LeftAt
			record.LeftAt, record.Minutes = &left, &minutes
		}
		records = append(records, record)
	}
	present := presentChildren(data.days)
	for _, absence := range data.absences {
		if !present[childOnDay{schoolDay{absence.SchoolID, absence.Date}, absence.StudentID}] {
			records = append(records, traegerview.DailyAttendanceRecord{SchoolID: absence.SchoolID, Date: absence.Date, Status: absence.Status})
		}
	}
	slices.SortStableFunc(records, func(a, b traegerview.DailyAttendanceRecord) int {
		for _, order := range []int{
			position[a.SchoolID] - position[b.SchoolID],
			a.Date.Compare(b.Date),
			statusOrder[a.Status] - statusOrder[b.Status],
			compareInstants(a.ArrivedAt, b.ArrivedAt),
			compareInstants(a.LeftAt, b.LeftAt),
		} {
			if order != 0 {
				return order
			}
		}
		return 0
	})
	return traegerview.DailyAttendanceExport{From: data.from, To: data.to, Schools: data.schools, Records: records}
}

// compareInstants orders instants, a missing one last.
func compareInstants(a, b *time.Time) int {
	switch {
	case a == nil && b == nil:
		return 0
	case a == nil:
		return 1
	case b == nil:
		return -1
	}
	return a.Compare(*b)
}
