package application

import (
	"context"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ traegerview.SchoolComparisons = (*Overview)(nil)

// SchoolComparison returns the key figures of the chosen schools of the
// Träger side by side (#4715, ADR 0245). It reads the series of the
// utilization without the rooms and the captured Stichtagszahlen in one
// administrative transaction, so the read costs the same statements for 3
// and for 100 schools. The answer holds counts only and is not written to the
// access log (ADR 0084 section 7).
func (o *Overview) SchoolComparison(ctx context.Context, organizationID int64, filter traegerview.ComparisonFilter) (traegerview.SchoolComparison, error) {
	if organizationID <= 0 {
		return traegerview.SchoolComparison{}, traegerview.ErrTraegerRequired
	}
	now := o.now()
	today := calendar.DateFromTime(now)
	if err := validateUtilizationWindow(filter.From, filter.To, today); err != nil {
		return traegerview.SchoolComparison{}, err
	}
	days := utilizationWeekdays(filter.From, filter.To)
	var schools []traegerview.SchoolUtilization
	var keyDates []traegerview.SchoolKeyDateCount
	err := o.read(ctx, organizationID, func(adminCtx context.Context, ids []int64) error {
		scope, err := comparisonScope(ids, filter.SchoolIDs)
		if err != nil || len(scope) == 0 {
			return err
		}
		rows, err := o.rows.Schools(adminCtx, scope)
		if err != nil {
			return err
		}
		reads, err := o.utilizationReads(adminCtx, scope, filter.From, filter.To, today, false)
		if err != nil {
			return err
		}
		if keyDates, err = o.keyDates.ListTraegerKeyDateCounts(adminCtx, organizationID); err != nil {
			return err
		}
		for _, row := range rows {
			schools = append(schools, reads.school(row, days))
		}
		return nil
	})
	if err != nil {
		return traegerview.SchoolComparison{}, err
	}
	result := compareSchools(schools, keyDates, filter.From, filter.To, len(days))
	result.AsOf = now
	return result, nil
}

// comparisonScope keeps the chosen schools of the Träger in the order of
// ids; no choice keeps every school. A chosen school outside the Träger is
// ErrSchoolOutsideTraeger, so the answer never says whether it exists.
func comparisonScope(ids, chosen []int64) ([]int64, error) {
	if len(chosen) == 0 {
		return ids, nil
	}
	for _, id := range chosen {
		if !slices.Contains(ids, id) {
			return nil, traegerview.ErrSchoolOutsideTraeger
		}
	}
	scope := make([]int64, 0, len(chosen))
	for _, id := range ids {
		if slices.Contains(chosen, id) {
			scope = append(scope, id)
		}
	}
	return scope, nil
}

// compareSchools applies the definitions of traegerview.SchoolComparison to
// the series of the chosen schools.
func compareSchools(schools []traegerview.SchoolUtilization, keyDates []traegerview.SchoolKeyDateCount, from, to calendar.Date, days int) traegerview.SchoolComparison {
	result := traegerview.SchoolComparison{
		From: from, To: to, Days: days,
		Schools: make([]traegerview.ComparedSchool, 0, len(schools)),
	}
	newest := newestKeyDates(keyDates, from, to)
	for _, school := range schools {
		values := schoolFigures(school)
		compared := traegerview.ComparedSchool{School: school.School, Values: values}
		if count, ok := newest[school.ID]; ok {
			values[traegerview.ComparisonActiveStudents] = float64(count.ActiveStudents)
			keyDate := count.KeyDate
			compared.KeyDate = &keyDate
		}
		result.Schools = append(result.Schools, compared)
		if school.AttendanceFrom != nil && school.AttendanceFrom.After(from) &&
			(result.AttendanceFrom == nil || school.AttendanceFrom.After(*result.AttendanceFrom)) {
			attendanceFrom := *school.AttendanceFrom
			result.AttendanceFrom = &attendanceFrom
		}
	}
	result.Average = averageFigures(result.Schools)
	result.Together = togetherFigures(schools, result.Schools)
	return result
}

// newestKeyDates picks, per school, the newest captured Stichtagszahl whose
// key date lies in the window.
func newestKeyDates(counts []traegerview.SchoolKeyDateCount, from, to calendar.Date) map[int64]traegerview.KeyDateCount {
	newest := map[int64]traegerview.KeyDateCount{}
	for _, count := range counts {
		if count.KeyDate.Before(from) || count.KeyDate.After(to) {
			continue
		}
		if current, ok := newest[count.SchoolID]; !ok || count.KeyDate.After(current.KeyDate) {
			newest[count.SchoolID] = count.KeyDateCount
		}
	}
	return newest
}

// schoolFigures derives the figures of one school from its series.
func schoolFigures(school traegerview.SchoolUtilization) traegerview.ComparisonValues {
	values := traegerview.ComparisonValues{}
	if school.Places > 0 {
		values[traegerview.ComparisonPlaces] = float64(school.Places)
	}
	days := len(school.Booked)
	if days == 0 {
		return values
	}
	bookedPlaces := sumInts(school.BookedPlaces)
	if school.Places > 0 {
		values[traegerview.ComparisonPlacesRate] = float64(bookedPlaces) / float64(school.Places*days)
		values[traegerview.ComparisonFreePlaces] = float64(school.Places) - float64(bookedPlaces)/float64(days)
	}
	values[traegerview.ComparisonBooked] = float64(sumInts(school.Booked)) / float64(days)
	if days > 1 {
		values[traegerview.ComparisonBookedChange] = float64(school.Booked[days-1] - school.Booked[0])
	}
	present, peak, presentDays := 0, 0, 0
	for _, count := range school.Present {
		if count == nil {
			continue
		}
		present += *count
		peak = max(peak, *count)
		presentDays++
	}
	if presentDays > 0 {
		values[traegerview.ComparisonPresent] = float64(present) / float64(presentDays)
		values[traegerview.ComparisonPresentPeak] = float64(peak)
	}
	return values
}

// figureTotal adds the figure key over the schools that have it; count is
// the number of those schools.
func figureTotal(schools []traegerview.ComparedSchool, key string) (total float64, count int) {
	for _, school := range schools {
		if value, ok := school.Values[key]; ok {
			total += value
			count++
		}
	}
	return total, count
}

// averageFigures is the mean of each figure over the schools that have it.
func averageFigures(schools []traegerview.ComparedSchool) traegerview.ComparisonValues {
	average := traegerview.ComparisonValues{}
	for _, key := range traegerview.ComparisonKeys {
		if total, count := figureTotal(schools, key); count > 0 {
			average[key] = total / float64(count)
		}
	}
	return average
}

// togetherFigures is each figure of the chosen schools as one: the sums,
// the share of all their places and no peak.
func togetherFigures(series []traegerview.SchoolUtilization, schools []traegerview.ComparedSchool) traegerview.ComparisonValues {
	together := traegerview.ComparisonValues{}
	for _, key := range []string{
		traegerview.ComparisonPlaces, traegerview.ComparisonFreePlaces, traegerview.ComparisonBooked,
		traegerview.ComparisonBookedChange, traegerview.ComparisonPresent, traegerview.ComparisonActiveStudents,
	} {
		if total, count := figureTotal(schools, key); count > 0 {
			together[key] = total
		}
	}
	placeDays, bookedPlaces := 0, 0
	for _, school := range series {
		if school.Places > 0 {
			placeDays += school.Places * len(school.BookedPlaces)
			bookedPlaces += sumInts(school.BookedPlaces)
		}
	}
	if placeDays > 0 {
		together[traegerview.ComparisonPlacesRate] = float64(bookedPlaces) / float64(placeDays)
	}
	return together
}

// sumInts adds the counts of a series.
func sumInts(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}
