package planning

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SeriesNonWorkingDays are the days of one materialization window a series
// may not plan on (#3820). Statutory holidays are always free; breaks (Ferien
// and closing days) only for a series that did not opt in with
// IncludeSchoolBreaks. The zero value skips nothing.
type SeriesNonWorkingDays struct {
	Holidays map[calendar.Date]bool
	Breaks   map[calendar.Date]bool
}

// skips reports whether an occurrence on day is left out.
func (d SeriesNonWorkingDays) skips(day calendar.Date, includeSchoolBreaks bool) bool {
	return d.Holidays[day] || (d.Breaks[day] && !includeSchoolBreaks)
}

// SeriesNonWorkingDayReader answers the non-working days of [from, to] for a
// series bounded by the calendar period seriesPeriodID.
type SeriesNonWorkingDayReader interface {
	SeriesNonWorkingDays(ctx context.Context, from, to calendar.Date, seriesPeriodID int64) (SeriesNonWorkingDays, error)
}

func (s *staffShiftSeriesService) loadNonWorkingDays(ctx context.Context, series *StaffShiftSeries, from, to calendar.Date) (SeriesNonWorkingDays, error) {
	if s.nonWorkingDays == nil {
		return SeriesNonWorkingDays{}, nil
	}
	return s.nonWorkingDays.SeriesNonWorkingDays(ctx, from, to, series.CalendarPeriodID)
}

// SeriesCalendarReads is the School Calendar read behind the non-working
// days: the statutory holidays of the tenant's federal state, the school's
// closing days and its calendar periods. The School Calendar capability
// satisfies it.
type SeriesCalendarReads interface {
	TenantHolidayDates(ctx context.Context, from, to string) (map[string]bool, error)
	ClosingDayDates(ctx context.Context, from, to string) (map[string]bool, error)
	ListCalendarPeriods(ctx context.Context, filter schoolcalendar.CalendarPeriodFilter) ([]schoolcalendar.CalendarPeriod, error)
}

// SchoolCalendarNonWorkingDays binds the series' non-working days to the
// School Calendar.
func SchoolCalendarNonWorkingDays(calendar SeriesCalendarReads) SeriesNonWorkingDayReader {
	if calendar == nil {
		return nil
	}
	return schoolCalendarNonWorkingDays{calendar: calendar}
}

// SchoolCalendarBreaks binds the break-day follow-up's calendar read to the
// School Calendar (#8205).
func SchoolCalendarBreaks(calendar SeriesCalendarReads) SchoolBreakCalendarReader {
	if calendar == nil {
		return nil
	}
	return schoolCalendarNonWorkingDays{calendar: calendar}
}

type schoolCalendarNonWorkingDays struct{ calendar SeriesCalendarReads }

// SeriesNonWorkingDays reads holidays, closing days and the active Ferien
// periods once per materialization. The series' own calendar period is never
// a break for it: a series planned over a Ferien period exists for that
// holiday care.
func (c schoolCalendarNonWorkingDays) SeriesNonWorkingDays(ctx context.Context, from, to calendar.Date, seriesPeriodID int64) (SeriesNonWorkingDays, error) {
	breaks, err := c.read(ctx, from, to, seriesPeriodID)
	if err != nil {
		return SeriesNonWorkingDays{}, err
	}
	return breaks.ForSeries(seriesPeriodID), nil
}

// SchoolBreakCalendar reads the window once for every series (#8205).
func (c schoolCalendarNonWorkingDays) SchoolBreakCalendar(ctx context.Context, from, to calendar.Date) (SchoolBreakCalendar, error) {
	return c.read(ctx, from, to, 0)
}

func (c schoolCalendarNonWorkingDays) read(ctx context.Context, from, to calendar.Date, excludePeriodID int64) (SchoolBreakCalendar, error) {
	holidays, err := c.calendar.TenantHolidayDates(ctx, from.String(), to.String())
	if err != nil {
		return SchoolBreakCalendar{}, fmt.Errorf("load holidays for series: %w", err)
	}
	closing, err := c.calendar.ClosingDayDates(ctx, from.String(), to.String())
	if err != nil {
		return SchoolBreakCalendar{}, fmt.Errorf("load closing days for series: %w", err)
	}
	ferien, err := c.calendar.ListCalendarPeriods(ctx, schoolcalendar.CalendarPeriodFilter{
		PeriodType: schoolcalendar.PeriodTypeHoliday, ActiveOnly: true,
		OverlappingFrom: from.String(), OverlappingTo: to.String(), ExcludeID: excludePeriodID,
	})
	if err != nil {
		return SchoolBreakCalendar{}, fmt.Errorf("load holiday periods for series: %w", err)
	}
	result := SchoolBreakCalendar{From: from, To: to, Holidays: dateSet(holidays), ClosingDays: dateSet(closing)}
	for _, period := range ferien {
		result.HolidayPeriods = append(result.HolidayPeriods, BreakPeriod{
			ID: period.ID, StartDate: calendar.Date(period.StartDate), EndDate: calendar.Date(period.EndDate),
		})
	}
	return result, nil
}

// SchoolBreakCalendar is the school calendar of one window, read once for
// every series that plans in it (#8205): the statutory holidays, the closing
// days of the school and its Träger and the active Ferien periods.
type SchoolBreakCalendar struct {
	From, To       calendar.Date
	Holidays       map[calendar.Date]bool
	ClosingDays    map[calendar.Date]bool
	HolidayPeriods []BreakPeriod
}

// BreakPeriod is one active Ferien period of the school calendar.
type BreakPeriod struct {
	ID                 int64
	StartDate, EndDate calendar.Date
}

// SchoolBreakCalendarReader reads the school calendar of [from, to] once.
type SchoolBreakCalendarReader interface {
	SchoolBreakCalendar(ctx context.Context, from, to calendar.Date) (SchoolBreakCalendar, error)
}

// ForSeries is the window's non-working days of a series bound to the
// calendar period seriesPeriodID: its own period is never a break for it.
func (c SchoolBreakCalendar) ForSeries(seriesPeriodID int64) SeriesNonWorkingDays {
	days := SeriesNonWorkingDays{Holidays: c.Holidays, Breaks: make(map[calendar.Date]bool, len(c.ClosingDays))}
	for day := range c.ClosingDays {
		days.Breaks[day] = true
	}
	for _, period := range c.HolidayPeriods {
		if period.ID == seriesPeriodID {
			continue
		}
		start, end := period.StartDate, period.EndDate
		if start.Before(c.From) {
			start = c.From
		}
		if end.After(c.To) {
			end = c.To
		}
		for day := start; !day.After(end); day = day.AddDays(1) {
			days.Breaks[day] = true
		}
	}
	return days
}

// breakKind names why a series bound to seriesPeriodID leaves day out as a
// break: a closing day wins over the Ferien. Empty when it does not.
func (c SchoolBreakCalendar) breakKind(day calendar.Date, seriesPeriodID int64) string {
	if c.ClosingDays[day] {
		return workforce.BreakDayClosingDay
	}
	for _, period := range c.HolidayPeriods {
		if period.ID != seriesPeriodID && !day.Before(period.StartDate) && !day.After(period.EndDate) {
			return workforce.BreakDayHolidayPeriod
		}
	}
	return ""
}

func dateSet(values map[string]bool) map[calendar.Date]bool {
	result := make(map[calendar.Date]bool, len(values))
	for day, set := range values {
		if set {
			result[calendar.Date(day)] = true
		}
	}
	return result
}
