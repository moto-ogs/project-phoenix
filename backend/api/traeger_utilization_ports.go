package api

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	carePlanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	studentPresenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// traegerUtilizationPorts binds the owners' reads behind the Träger's
// utilization over time (#4713, ADR 0241): the bookings of a window at Care
// Plan, the child of each approved enrollment with the running phases at
// Enrollment, the check-ins and room days at Student Presence, the rooms at
// Facilities and the children of one school by name at the Statistik report.
func traegerUtilizationPorts(statistics studentpresence.StatisticsReports) traegerview.UtilizationPorts {
	return traegerview.UtilizationPorts{
		Bookings:   traegerBookingIntervals{bookings: carePlanCompose.NewTraegerCareBookingIntervals()},
		Children:   enrollmentCompose.NewBookedChildren(),
		Presence:   traegerPresenceSeries{series: studentPresenceCompose.NewPresenceSeries()},
		Rooms:      traegerRoomNames{rooms: facilitiesCompose.NewTraegerRooms()},
		Attendance: traegerChildAttendance{statistics: statistics},
	}
}

type traegerBookingIntervals struct {
	bookings careplan.TraegerCareBookingIntervals
}

func (b traegerBookingIntervals) CareOfferingIntervalsByTenant(ctx context.Context, schools []int64, from, to calendar.Date, runningPhases []int64) (map[int64][]traegerview.OfferingBookingIntervals, error) {
	offerings, err := b.bookings.CareOfferingIntervalsByTenant(ctx, schools, from, to, runningPhases)
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]traegerview.OfferingBookingIntervals, len(offerings))
	for school, listed := range offerings {
		for _, offering := range listed {
			bookings := make([]traegerview.BookingInterval, 0, len(offering.Bookings))
			for _, booking := range offering.Bookings {
				bookings = append(bookings, traegerview.BookingInterval{RequestChildID: booking.RequestChildID, ValidFrom: booking.ValidFrom, ValidUntil: booking.ValidUntil})
			}
			result[school] = append(result[school], traegerview.OfferingBookingIntervals{
				ID: offering.ID, Name: offering.Name, Capacity: offering.Capacity, Active: offering.Active, Bookings: bookings,
			})
		}
	}
	return result, nil
}

type traegerPresenceSeries struct {
	series studentpresence.PresenceSeries
}

func (p traegerPresenceSeries) AttendanceCountsByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]traegerview.DailyCounts, error) {
	counts, err := p.series.AttendanceCountsByTenant(ctx, schools, from, to)
	if err != nil {
		return nil, err
	}
	result := make(map[int64]traegerview.DailyCounts, len(counts))
	for school, days := range counts {
		result[school] = traegerview.DailyCounts{From: days.FirstDay, Counts: days.Children}
	}
	return result, nil
}

func (p traegerPresenceSeries) RoomVisitDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) (map[int64]traegerview.SchoolRoomVisits, error) {
	visits, err := p.series.RoomDaysByTenant(ctx, schools, from, to)
	if err != nil {
		return nil, err
	}
	result := make(map[int64]traegerview.SchoolRoomVisits, len(visits))
	for school, rooms := range visits {
		days := make([]traegerview.RoomVisitDay, 0, len(rooms.Days))
		for _, day := range rooms.Days {
			days = append(days, traegerview.RoomVisitDay{RoomID: day.RoomID, Day: day.Day, Children: day.Children, Peak: day.Peak})
		}
		result[school] = traegerview.SchoolRoomVisits{From: rooms.FirstDay, Days: days}
	}
	return result, nil
}

type traegerRoomNames struct {
	rooms facilities.TraegerRooms
}

func (n traegerRoomNames) RoomsByTenant(ctx context.Context, schools []int64) (map[int64][]traegerview.NamedRoom, error) {
	rooms, err := n.rooms.RoomsByTenant(ctx, schools)
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]traegerview.NamedRoom, len(rooms))
	for school, named := range rooms {
		for _, room := range named {
			result[school] = append(result[school], traegerview.NamedRoom{ID: room.ID, Name: room.Name, Capacity: room.Capacity})
		}
	}
	return result, nil
}

// traegerChildAttendance reads the children of one school from its Statistik
// report in the school's tenant transaction. The report writes the read with
// the account of the Träger-Büro to the school's access log (scope
// attendance), as Soll und Ist does for the overruns (ADR 0156).
type traegerChildAttendance struct {
	statistics studentpresence.StatisticsReports
}

func (a traegerChildAttendance) ChildAttendance(ctx context.Context, schoolID, accountID int64, from, to calendar.Date) ([]traegerview.ChildAttendance, error) {
	school, err := tenant.NewTenantID(schoolID)
	if err != nil {
		return nil, err
	}
	var children []traegerview.ChildAttendance
	err = tenant.WithinTenant(ctx, school, func(txCtx context.Context) error {
		report, err := a.statistics.Report(txCtx, studentpresence.StatisticsFilters{
			From: from, To: to, Sections: []studentpresence.StatisticsSection{studentpresence.StatisticsSectionAttendance},
		}, studentpresence.StatisticsActor{AccountID: accountID, Role: traegerAccessActorRole})
		if err != nil {
			return err
		}
		children = make([]traegerview.ChildAttendance, 0, len(report.Students))
		for _, row := range report.Students {
			children = append(children, traegerview.ChildAttendance{
				StudentID: row.StudentID, FirstName: row.FirstName, LastName: row.LastName, SchoolClass: row.SchoolClass,
				GroupName: row.GroupName, CareDays: row.CareDays, PresentDays: row.PresentDays, SickDays: row.SickDays,
				ExcusedDays: row.ExcusedDays, UnexplainedDays: row.UnexplainedDays, AttendanceRate: row.AttendanceRate,
			})
		}
		return nil
	})
	return children, err
}
