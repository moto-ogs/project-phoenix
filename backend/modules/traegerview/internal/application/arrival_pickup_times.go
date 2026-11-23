package application

import (
	"context"
	"math"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The default axis of the heatmap: 07:00 to 17:30. Data outside widens it.
const (
	arrivalPickupFirstMinute = 7 * 60
	arrivalPickupLastMinute  = 17 * 60
)

// ArrivalPickupTimes returns the heatmap of arrival and pickup times of every
// school of the Träger between from and to (#4714). Every owner is read once
// for the whole school set. The answer holds averages and school names, no
// child, so it is not written to the access log (ADR 0084 section 7).
func (o *Overview) ArrivalPickupTimes(ctx context.Context, organizationID int64, from, to calendar.Date) (traegerview.ArrivalPickupTimes, error) {
	if organizationID <= 0 {
		return traegerview.ArrivalPickupTimes{}, traegerview.ErrTraegerRequired
	}
	from, to, err := arrivalPickupPeriod(from, to, calendar.DateFromTime(o.now()))
	if err != nil {
		return traegerview.ArrivalPickupTimes{}, err
	}
	var result traegerview.ArrivalPickupTimes
	err = o.read(ctx, organizationID, func(adminCtx context.Context, ids []int64) error {
		schools, err := o.rows.Schools(adminCtx, ids)
		if err != nil {
			return err
		}
		var counts []traegerview.ArrivalPickupCount
		var days []traegerview.AttendanceDays
		if len(ids) > 0 {
			if counts, days, err = o.times.ArrivalPickupCountsByTenant(adminCtx, ids, from, to, traegerview.ArrivalPickupSlotMinutes); err != nil {
				return err
			}
		}
		result = buildArrivalPickupTimes(schools, counts, days, from, to)
		return nil
	})
	if err != nil {
		return traegerview.ArrivalPickupTimes{}, err
	}
	return result, nil
}

// arrivalPickupPeriod checks a period and ends it yesterday at the latest:
// today's pickups are not over yet.
func arrivalPickupPeriod(from, to, today calendar.Date) (calendar.Date, calendar.Date, error) {
	if from == "" || to == "" || to.Before(from) {
		return "", "", traegerview.ErrInvalidArrivalPickupPeriod
	}
	if yesterday := today.AddDays(-1); yesterday.Before(to) {
		to = yesterday
	}
	if to.Before(from) || from.DaysUntil(to) >= traegerview.ArrivalPickupMaxDays {
		return "", "", traegerview.ErrInvalidArrivalPickupPeriod
	}
	return from, to, nil
}

// weekdayKey is one ISO weekday of one school.
type weekdayKey struct {
	school  int64
	weekday int
}

// slotKey is one half hour of a weekday of one school.
type slotKey struct {
	weekdayKey
	minute int
}

// arrivalPickupIndex is the owners' answer keyed for the heatmap.
type arrivalPickupIndex struct {
	days     map[weekdayKey]int
	firstDay map[int64]calendar.Date
	cells    map[slotKey]traegerview.ArrivalPickupCount
	weekdays []int
	first    int
	last     int
}

func indexArrivalPickups(counts []traegerview.ArrivalPickupCount, days []traegerview.AttendanceDays) arrivalPickupIndex {
	index := arrivalPickupIndex{
		days: make(map[weekdayKey]int, len(days)), firstDay: map[int64]calendar.Date{},
		cells:    make(map[slotKey]traegerview.ArrivalPickupCount, len(counts)),
		weekdays: []int{1, 2, 3, 4, 5}, first: arrivalPickupFirstMinute, last: arrivalPickupLastMinute,
	}
	weekend := map[int]bool{}
	for _, day := range days {
		index.days[weekdayKey{day.SchoolID, day.Weekday}] = day.Days
		if first, ok := index.firstDay[day.SchoolID]; !ok || day.FirstDay.Before(first) {
			index.firstDay[day.SchoolID] = day.FirstDay
		}
		weekend[day.Weekday] = day.Weekday > 5
	}
	for _, day := range []int{6, 7} {
		if weekend[day] {
			index.weekdays = append(index.weekdays, day)
		}
	}
	for _, count := range counts {
		index.cells[slotKey{weekdayKey{count.SchoolID, count.Weekday}, count.StartMinute}] = count
		index.first = min(index.first, count.StartMinute)
		index.last = max(index.last, count.StartMinute)
	}
	return index
}

// buildArrivalPickupTimes applies the definitions of
// traegerview.ArrivalPickupTimes to the counts of the schools.
func buildArrivalPickupTimes(schools []traegerview.TraegerSchool, counts []traegerview.ArrivalPickupCount, days []traegerview.AttendanceDays, from, to calendar.Date) traegerview.ArrivalPickupTimes {
	index := indexArrivalPickups(counts, days)
	result := traegerview.ArrivalPickupTimes{
		From: from, To: to, SlotMinutes: traegerview.ArrivalPickupSlotMinutes,
		FirstMinute: index.first, LastMinute: index.last,
		All:     index.heatmap(0, false),
		Schools: make([]traegerview.SchoolArrivalPickupTimes, 0, len(schools)),
	}
	for _, school := range schools {
		entry := traegerview.SchoolArrivalPickupTimes{TraegerSchool: school, ArrivalPickupHeatmap: index.heatmap(school.ID.Int64(), true)}
		if first, ok := index.firstDay[school.ID.Int64()]; ok {
			entry.FirstDay = &first
		}
		addHeatmap(result.All, entry.ArrivalPickupHeatmap)
		result.Schools = append(result.Schools, entry)
	}
	roundHeatmap(result.All)
	for _, school := range result.Schools {
		roundHeatmap(school.ArrivalPickupHeatmap)
	}
	return result
}

// heatmap is the averages of one school, or the empty rows of all schools
// together when fill is false.
func (index arrivalPickupIndex) heatmap(school int64, fill bool) traegerview.ArrivalPickupHeatmap {
	heatmap := traegerview.ArrivalPickupHeatmap{Weekdays: make([]traegerview.ArrivalPickupWeekday, len(index.weekdays))}
	for i, weekday := range index.weekdays {
		key := weekdayKey{school, weekday}
		row := traegerview.ArrivalPickupWeekday{Weekday: weekday, Slots: emptySlots(index.first, index.last)}
		if fill {
			row.Days = index.days[key]
		}
		for j := range row.Slots {
			if row.Days == 0 {
				break
			}
			count := index.cells[slotKey{key, row.Slots[j].StartMinute}]
			row.Slots[j].Arrivals = float64(count.Arrivals) / float64(row.Days)
			row.Slots[j].Pickups = float64(count.Pickups) / float64(row.Days)
		}
		heatmap.Weekdays[i] = row
	}
	return heatmap
}

// addHeatmap adds a school's averages to all schools together; its days are
// the most days of one school.
func addHeatmap(all, school traegerview.ArrivalPickupHeatmap) {
	for i := range all.Weekdays {
		all.Weekdays[i].Days = max(all.Weekdays[i].Days, school.Weekdays[i].Days)
		for j := range all.Weekdays[i].Slots {
			all.Weekdays[i].Slots[j].Arrivals += school.Weekdays[i].Slots[j].Arrivals
			all.Weekdays[i].Slots[j].Pickups += school.Weekdays[i].Slots[j].Pickups
		}
	}
}

// emptySlots is the axis from first to last, one cell per slot.
func emptySlots(first, last int) []traegerview.ArrivalPickupCell {
	slots := make([]traegerview.ArrivalPickupCell, 0, (last-first)/traegerview.ArrivalPickupSlotMinutes+1)
	for minute := first; minute <= last; minute += traegerview.ArrivalPickupSlotMinutes {
		slots = append(slots, traegerview.ArrivalPickupCell{StartMinute: minute})
	}
	return slots
}

// roundHeatmap keeps one decimal, which is as exact as a planning figure
// gets. All schools together add the unrounded averages.
func roundHeatmap(heatmap traegerview.ArrivalPickupHeatmap) {
	for _, row := range heatmap.Weekdays {
		for i := range row.Slots {
			row.Slots[i].Arrivals = math.Round(row.Slots[i].Arrivals*10) / 10
			row.Slots[i].Pickups = math.Round(row.Slots[i].Pickups*10) / 10
		}
	}
}
