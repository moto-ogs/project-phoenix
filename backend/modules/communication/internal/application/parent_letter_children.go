package application

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewParentLetterChildren reads and formats the child values named by a
// parent letter. All source reads share the caller's tenant transaction.
func NewParentLetterChildren(sources ports.ParentLetterSources, now func() time.Time) communication.ParentLetterChildren {
	return parentLetterChildren{students: sources.Students, groups: sources.Groups, pickups: sources.Pickups, arrivals: sources.Arrivals, now: now}
}

type parentLetterChildren struct {
	students ports.ParentLetterStudents
	groups   ports.GroupNames
	pickups  ports.ParentLetterPickups
	arrivals ports.ParentLetterArrivals
	now      func() time.Time
}

func (c parentLetterChildren) ParentLetterChildren(ctx context.Context, studentIDs []int64) ([]communication.ParentLetterChild, error) {
	if len(studentIDs) == 0 {
		return []communication.ParentLetterChild{}, nil
	}
	students, err := c.students.ListStudentsByID(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	names, err := c.studentNames(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	groups, err := c.groupNames(ctx, students)
	if err != nil {
		return nil, err
	}
	weeks, err := c.careWeeks(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	out := make([]communication.ParentLetterChild, 0, len(students))
	for _, student := range students {
		child := communication.ParentLetterChild{
			StudentID: student.ID, FirstName: names[student.ID].FirstName, LastName: names[student.ID].LastName,
			SchoolClass: strings.TrimSpace(student.SchoolClass),
		}
		if student.GroupID != nil {
			child.Group = groups[*student.GroupID]
		}
		child.CareDays, child.PickupTime = letterCareWeek(weeks[student.ID])
		out = append(out, child)
	}
	return out, nil
}

func (c parentLetterChildren) studentNames(ctx context.Context, studentIDs []int64) (map[int64]ports.ParentLetterStudentName, error) {
	names, err := c.students.ListStudentNamesByID(ctx, studentIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[int64]ports.ParentLetterStudentName, len(names))
	for _, name := range names {
		byID[name.StudentID] = name
	}
	return byID, nil
}

func (c parentLetterChildren) groupNames(ctx context.Context, students []ports.ParentLetterStudent) (map[int64]string, error) {
	groupIDs := make([]int64, 0, len(students))
	for _, student := range students {
		if student.GroupID != nil {
			groupIDs = append(groupIDs, *student.GroupID)
		}
	}
	names := map[int64]string{}
	if len(groupIDs) == 0 {
		return names, nil
	}
	return c.groups(ctx, groupIDs)
}

// careWeeks reads both weekly plans of today: the pickup plan gives the
// times, and a weekday with only an arrival is a booked day without one.
func (c parentLetterChildren) careWeeks(ctx context.Context, studentIDs []int64) (map[int64]letterCareWeekPlan, error) {
	date := calendar.DateFromTime(c.now())
	pickups, err := c.pickups.GetWeeklySchedulesByStudentIDsForDate(ctx, studentIDs, date)
	if err != nil {
		return nil, err
	}
	arrivals, err := c.arrivals.GetWeeklySchedulesByStudentIDsForDate(ctx, studentIDs, date)
	if err != nil {
		return nil, err
	}
	weeks := map[int64]letterCareWeekPlan{}
	for _, pickup := range pickups {
		if pickup != nil {
			week := weeks[pickup.StudentID]
			week.pickups = append(week.pickups, pickup)
			weeks[pickup.StudentID] = week
		}
	}
	for _, arrival := range arrivals {
		if arrival != nil {
			week := weeks[arrival.StudentID]
			week.arrivalDays = append(week.arrivalDays, arrival.Weekday)
			weeks[arrival.StudentID] = week
		}
	}
	return weeks, nil
}

// letterCareWeekPlan is one child's weekly plan.
type letterCareWeekPlan struct {
	pickups     []*ports.ParentLetterPickup
	arrivalDays []int
}

var letterWeekdayNames = map[int]string{1: "Montag", 2: "Dienstag", 3: "Mittwoch", 4: "Donnerstag", 5: "Freitag", 6: "Samstag", 7: "Sonntag"}
var letterWeekdayShort = map[int]string{1: "Mo", 2: "Di", 3: "Mi", 4: "Do", 5: "Fr", 6: "Sa", 7: "So"}

// letterCareWeek writes the booked weekdays and the pickup time of a weekly
// plan: "Montag, Dienstag und Donnerstag" and "15:30 Uhr", or per day
// "Mo 15:00 Uhr, Di 16:00 Uhr" when the times differ.
func letterCareWeek(week letterCareWeekPlan) (string, string) {
	booked := map[int]bool{}
	for _, day := range week.arrivalDays {
		booked[day] = true
	}
	pickups := append([]*ports.ParentLetterPickup(nil), week.pickups...)
	sort.Slice(pickups, func(i, j int) bool { return pickups[i].Weekday < pickups[j].Weekday })
	perDay := make([]string, 0, len(pickups))
	clocks := map[string]bool{}
	clock := ""
	for _, day := range pickups {
		if _, ok := letterWeekdayNames[day.Weekday]; !ok {
			continue
		}
		booked[day.Weekday] = true
		clock = day.PickupTime.Format("15:04")
		clocks[clock] = true
		perDay = append(perDay, letterWeekdayShort[day.Weekday]+" "+clock+" Uhr")
	}
	days := make([]string, 0, len(booked))
	for weekday := 1; weekday <= 7; weekday++ {
		if booked[weekday] {
			if name, ok := letterWeekdayNames[weekday]; ok {
				days = append(days, name)
			}
		}
	}
	switch len(clocks) {
	case 0:
		return germanList(days), ""
	case 1:
		return germanList(days), clock + " Uhr"
	}
	return germanList(days), strings.Join(perDay, ", ")
}

func germanList(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " und " + items[len(items)-1]
}
