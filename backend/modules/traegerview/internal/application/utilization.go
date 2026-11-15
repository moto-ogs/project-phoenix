package application

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func utilizationPortsBound(ports traegerview.UtilizationPorts) bool {
	return ports.Bookings != nil && ports.Children != nil && ports.Presence != nil && ports.Rooms != nil && ports.Attendance != nil
}

// Utilization returns the utilization of every school of the Träger per
// weekday of the window (#4713). Every owner is read once for the whole
// school set, so the read costs the same statements for 3 and for 100
// schools. The answer holds counts and the names of offerings and rooms, no
// child, so it is not written to the access log (ADR 0084 section 7, ADR
// 0241).
func (o *Overview) Utilization(ctx context.Context, organizationID int64, from, to calendar.Date) (traegerview.Utilization, error) {
	if organizationID <= 0 {
		return traegerview.Utilization{}, traegerview.ErrTraegerRequired
	}
	now := o.now()
	today := calendar.DateFromTime(now)
	if err := validateUtilizationWindow(from, to, today); err != nil {
		return traegerview.Utilization{}, err
	}
	days := utilizationWeekdays(from, to)
	result := traegerview.Utilization{From: from, To: to, Days: days, AsOf: now}
	err := o.read(ctx, organizationID, func(adminCtx context.Context, ids []int64) error {
		schools, err := o.rows.Schools(adminCtx, ids)
		if err != nil {
			return err
		}
		reads, err := o.utilizationReads(adminCtx, ids, from, to, today)
		if err != nil {
			return err
		}
		result.Schools = make([]traegerview.SchoolUtilization, 0, len(schools))
		for _, school := range schools {
			result.Schools = append(result.Schools, reads.school(school, days))
		}
		return nil
	})
	if err != nil {
		return traegerview.Utilization{}, err
	}
	return result, nil
}

// UtilizationChildren returns the children of one school of the Träger over
// the window by name (#4713). The projection checks the school against the
// Träger in its administrative unit; the per-child read then runs in the
// school's tenant transaction, where the Statistik report writes it to the
// school's access log with the viewer's account.
func (o *Overview) UtilizationChildren(ctx context.Context, viewer traegerview.Viewer, schoolID int64, from, to calendar.Date) (traegerview.UtilizationChildren, error) {
	if viewer.OrganizationID <= 0 || viewer.AccountID <= 0 {
		return traegerview.UtilizationChildren{}, traegerview.ErrTraegerRequired
	}
	if err := validateUtilizationWindow(from, to, calendar.DateFromTime(o.now())); err != nil {
		return traegerview.UtilizationChildren{}, err
	}
	var school traegerview.School
	err := o.read(ctx, viewer.OrganizationID, func(adminCtx context.Context, ids []int64) error {
		if !slices.Contains(ids, schoolID) {
			return traegerview.ErrSchoolOutsideTraeger
		}
		rows, err := o.rows.Schools(adminCtx, []int64{schoolID})
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return traegerview.ErrSchoolOutsideTraeger
		}
		school = rows[0]
		return nil
	})
	if err != nil {
		return traegerview.UtilizationChildren{}, err
	}
	children, err := o.utilization.Attendance.ChildAttendance(ctx, schoolID, viewer.AccountID, from, to)
	if err != nil {
		return traegerview.UtilizationChildren{}, err
	}
	if children == nil {
		children = []traegerview.ChildAttendance{}
	}
	return traegerview.UtilizationChildren{School: school, From: from, To: to, Children: children}, nil
}

// validateUtilizationWindow admits a window that ends today at the latest
// and is at most traegerview.UtilizationMaxDays long.
func validateUtilizationWindow(from, to, today calendar.Date) error {
	switch {
	case from.IsZero() || to.IsZero():
		return fmt.Errorf("%w: from and to are required", traegerview.ErrInvalidUtilizationWindow)
	case to.Before(from):
		return fmt.Errorf("%w: from must not be after to", traegerview.ErrInvalidUtilizationWindow)
	case to.After(today):
		return fmt.Errorf("%w: to must not be in the future", traegerview.ErrInvalidUtilizationWindow)
	case from.DaysUntil(to)+1 > traegerview.UtilizationMaxDays:
		return fmt.Errorf("%w: the window exceeds %d days", traegerview.ErrInvalidUtilizationWindow, traegerview.UtilizationMaxDays)
	}
	return nil
}

// finishedUntil is the last day of the window that is over: to, or
// yesterday when the window reaches today. ok is false when no day of the
// window is over yet.
func finishedUntil(from, to, today calendar.Date) (calendar.Date, bool) {
	yesterday := today.AddDays(-1)
	if yesterday.Before(from) {
		return "", false
	}
	if to.After(yesterday) {
		return yesterday, true
	}
	return to, true
}

// utilizationWeekdays lists Monday to Friday of the window in order.
func utilizationWeekdays(from, to calendar.Date) []calendar.Date {
	days := []calendar.Date{}
	for day := from; !day.After(to); day = day.AddDays(1) {
		if weekday := day.Weekday(); weekday != time.Saturday && weekday != time.Sunday {
			days = append(days, day)
		}
	}
	return days
}

// utilizationReads are the owners' answers for a school set, keyed by school.
type utilizationReads struct {
	children   map[int64]map[int64]int64
	bookings   map[int64][]traegerview.OfferingBookingIntervals
	attendance map[int64]traegerview.DailyCounts
	visits     map[int64]traegerview.SchoolRoomVisits
	rooms      map[int64][]traegerview.NamedRoom
}

func (o *Overview) utilizationReads(ctx context.Context, scope []int64, from, to, today calendar.Date) (utilizationReads, error) {
	var reads utilizationReads
	if len(scope) == 0 {
		return reads, nil
	}
	ports := o.utilization
	var phases []int64
	var err error
	if reads.children, phases, err = ports.Children.BookedChildrenAndRunningPhases(ctx, scope, today); err != nil {
		return reads, err
	}
	if reads.bookings, err = ports.Bookings.CareOfferingIntervalsByTenant(ctx, scope, from, to, unbookedOfferingPhases(to, today, phases)); err != nil {
		return reads, err
	}
	// Check-ins and room visits count for finished days only: today's are
	// still running, and a school with the attendance log switched off
	// keeps only today's room visits.
	if finished, ok := finishedUntil(from, to, today); ok {
		to = finished
		if reads.attendance, err = ports.Presence.AttendanceCountsByTenant(ctx, scope, from, to); err != nil {
			return reads, err
		}
		if reads.visits, err = ports.Presence.RoomVisitDaysByTenant(ctx, scope, from, to); err != nil {
			return reads, err
		}
	}
	reads.rooms, err = ports.Rooms.RoomsByTenant(ctx, scope)
	return reads, err
}

// unbookedOfferingPhases names the phases whose active offerings count even
// without a booking: the running ones, and only when the window reaches
// today. An offering of this year's phase did not exist in a past window;
// listed there with its places, it made every past year look emptier.
func unbookedOfferingPhases(to, today calendar.Date, running []int64) []int64 {
	if to.Before(today) {
		return nil
	}
	return running
}

// school applies the definitions of traegerview.Utilization to one school.
func (r utilizationReads) school(school traegerview.School, days []calendar.Date) traegerview.SchoolUtilization {
	offerings := offeringSeries(r.bookings[school.ID], r.children[school.ID], days)
	attendance := r.attendance[school.ID]
	visits := r.visits[school.ID]
	return traegerview.SchoolUtilization{
		School: school, Places: offerings.places, Booked: offerings.booked, BookedPlaces: offerings.bookedPlaces,
		Present: presentSeries(attendance, days), AttendanceFrom: attendance.From, RoomDataFrom: visits.From,
		Offerings: offerings.offerings, Rooms: roomSeries(r.rooms[school.ID], visits, days),
	}
}

// offeringTotals are the offering series of one school with the school's
// sums over them.
type offeringTotals struct {
	offerings    []traegerview.UtilizationOffering
	places       int
	booked       []int
	bookedPlaces []int
}

// offeringSeries counts, per offering and day, the children taken on through
// a booking valid that day. A request child without a student (not approved)
// counts for nothing; a child with two bookings of one offering counts once.
// The school's booked children count each child once over all offerings.
func offeringSeries(offerings []traegerview.OfferingBookingIntervals, children map[int64]int64, days []calendar.Date) offeringTotals {
	totals := offeringTotals{
		offerings: make([]traegerview.UtilizationOffering, 0, len(offerings)),
		booked:    make([]int, len(days)), bookedPlaces: make([]int, len(days)),
	}
	schoolDays := make([]map[int64]struct{}, len(days))
	for i := range schoolDays {
		schoolDays[i] = map[int64]struct{}{}
	}
	for _, offering := range offerings {
		booked := offeringDays(offering, children, days, schoolDays)
		if offering.Capacity != nil {
			totals.places += *offering.Capacity
			for i, count := range booked {
				totals.bookedPlaces[i] += count
			}
		}
		totals.offerings = append(totals.offerings, traegerview.UtilizationOffering{
			ID: offering.ID, Name: offering.Name, Capacity: offering.Capacity, Active: offering.Active, Booked: booked,
		})
	}
	for i, students := range schoolDays {
		totals.booked[i] = len(students)
	}
	return totals
}

// offeringDays counts the children of one offering per day and adds them to
// the school's children of that day.
func offeringDays(offering traegerview.OfferingBookingIntervals, children map[int64]int64, days []calendar.Date, schoolDays []map[int64]struct{}) []int {
	booked := make([]int, len(days))
	for i, day := range days {
		students := map[int64]struct{}{}
		for _, booking := range offering.Bookings {
			if student, taken := children[booking.RequestChildID]; taken && bookingValidOn(booking, day) {
				students[student] = struct{}{}
				schoolDays[i][student] = struct{}{}
			}
		}
		booked[i] = len(students)
	}
	return booked
}

// bookingValidOn applies the rule of the occupancy: valid from ValidFrom
// (inclusive) to ValidUntil (exclusive).
func bookingValidOn(booking traegerview.BookingInterval, day calendar.Date) bool {
	if booking.ValidFrom != nil && booking.ValidFrom.After(day) {
		return false
	}
	return booking.ValidUntil == nil || booking.ValidUntil.After(day)
}

// presentSeries gives the children with an attendance per day; nil before
// the first kept day and on a day without any attendance.
func presentSeries(counts traegerview.DailyCounts, days []calendar.Date) []*int {
	series := make([]*int, len(days))
	if counts.From == nil {
		return series
	}
	for i, day := range days {
		if count, ok := counts.Counts[day]; ok && count > 0 && !day.Before(*counts.From) {
			series[i] = &count
		}
	}
	return series
}

// roomSeries lists the named rooms with a visit in the window, in the order
// of the names. A day without any visit at the school, or before the first
// kept visit, has no figure; on another day a room without a visit has 0.
func roomSeries(names []traegerview.NamedRoom, visits traegerview.SchoolRoomVisits, days []calendar.Date) []traegerview.UtilizationRoom {
	rooms := []traegerview.UtilizationRoom{}
	if visits.From == nil || len(visits.Days) == 0 {
		return rooms
	}
	calendarDays := newRoomCalendar(visits, days)
	for _, room := range names {
		if roomDays, used := calendarDays.byRoom[room.ID]; used {
			children, peak := calendarDays.figures(roomDays)
			rooms = append(rooms, traegerview.UtilizationRoom{ID: room.ID, Name: room.Name, Capacity: room.Capacity, Children: children, Peak: peak})
		}
	}
	return rooms
}

// roomCalendar places the room days of a school on the days of the window:
// open marks the days with a counted visit at the school.
type roomCalendar struct {
	index  map[calendar.Date]int
	open   []bool
	byRoom map[int64][]traegerview.RoomVisitDay
}

func newRoomCalendar(visits traegerview.SchoolRoomVisits, days []calendar.Date) roomCalendar {
	rc := roomCalendar{index: make(map[calendar.Date]int, len(days)), open: make([]bool, len(days)), byRoom: map[int64][]traegerview.RoomVisitDay{}}
	for i, day := range days {
		rc.index[day] = i
	}
	for _, visit := range visits.Days {
		if i, ok := rc.index[visit.Day]; ok && !visit.Day.Before(*visits.From) {
			rc.open[i] = true
			rc.byRoom[visit.RoomID] = append(rc.byRoom[visit.RoomID], visit)
		}
	}
	return rc
}

// figures gives one room's children and peak per day: nil on a day without
// any visit at the school, 0 on a day the room stayed empty.
func (rc roomCalendar) figures(roomDays []traegerview.RoomVisitDay) (children, peak []*int) {
	children, peak = make([]*int, len(rc.open)), make([]*int, len(rc.open))
	for i, open := range rc.open {
		if open {
			children[i], peak[i] = new(int), new(int)
		}
	}
	for _, visit := range roomDays {
		i := rc.index[visit.Day]
		*children[i], *peak[i] = visit.Children, visit.Peak
	}
	return children, peak
}
