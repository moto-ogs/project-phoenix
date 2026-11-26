package care

import (
	"context"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// attendanceCultureLookbackDays bestimmt, ueber wie viele Kalendertage
// zurueckgeschaut wird, um zu erkennen, ob die Schule ueberhaupt Anwesenheit
// pflegt. Ohne diese Pruefung wuerde ein Kind an einer Schule ohne
// Anwesenheitserfassung den ganzen Tag als "nicht angekommen" erscheinen und
// Eltern grundlos beunruhigen. Gemessen wird SCHULWEIT (irgendeine
// Anwesenheitszeile des Tenants im Fenster), nicht am einzelnen Kind: ein neu
// aufgenommenes oder laenger abwesendes Kind hat selbst keine Historie, die
// Schule erfasst aber trotzdem. Hat die ganze Schule in 14 Kalendertagen
// keine einzige Zeile, gilt "unknown" statt einer erfundenen Aussage.
const attendanceCultureLookbackDays = 14

// GetChildTodayStatus liefert den auf Elternsicht reduzierten Betreuungsstatus
// des laufenden Berliner Kalendertages.
//
// Die Antwort ist bewusst arm: kein Raum, keine Besuchshistorie, keine
// Rohereignisse, keine Mitarbeitendennamen. active.visits wird nie gelesen,
// damit kein Raumbezug nach aussen gelangen kann; die einzige Praesenzquelle
// ist active.attendance, die sowohl der Kiosk-Scan als auch die manuelle
// Erfassung im Personal-Portal fuellt.
//
// Ein Fehler beim Aufloesen der Fakten fuehrt zu DayStateUnknown statt zu
// einem 500er: fuer Eltern ist "Status derzeit nicht verfuegbar" die richtige
// Aussage, ein Serverfehler waere nur verwirrend.
func (s *Service) GetChildTodayStatus(ctx context.Context, accountID, studentID int64) (*TodayStatus, error) {
	child, err := s.ResolvePermittedChild(ctx, accountID, studentID, GuardianPermissionPortalAccess)
	if err != nil {
		return nil, err
	}
	statuses, err := s.todayForSchool(ctx, child.TenantID, []schoolChild{{id: studentID, child: child}}, s.now())
	if err != nil {
		return &TodayStatus{State: DayStateUnknown}, nil
	}
	return statuses[studentID], nil
}

// schoolChild is one authorized child of a set read of its school. The
// relationship check stays per child; only the school's reads are shared.
type schoolChild struct {
	id    int64
	child *Child
}

// todayForSchool derives the day of the children of one school from one
// tenant transaction. Its statement count does not grow with the children:
// every read takes the whole set (Rule 15). A read error fails the day of the
// children it read, which the caller shows as unknown, never as "not
// arrived"; the returned map still holds what needs no read, the no-care day
// of a child without an OGS place.
func (s *Service) todayForSchool(ctx context.Context, tenantID int64, children []schoolChild, now time.Time) (map[int64]*TodayStatus, error) {
	out := make(map[int64]*TodayStatus, len(children))
	today := calendar.DateFromTime(now)
	facts := make(map[int64]*todayStatusFacts, len(children))
	ids := make([]int64, 0, len(children))
	for _, c := range children {
		if c.child.WithoutCarePlace {
			// A child without an OGS place (#4803) has no OGS day: no
			// arrival, pickup or care day is read for it.
			out[c.id] = &TodayStatus{State: DayStateNoCare}
			continue
		}
		facts[c.id] = &todayStatusFacts{NowHHMM: berlinHHMM(now)}
		ids = append(ids, c.id)
	}
	if len(ids) == 0 {
		return out, nil
	}
	txErr := s.Runtime.WithinTenant(ctx, tenantID, func(txCtx context.Context) error {
		return s.loadTodayFacts(withSchoolWeekendPlan(txCtx), ids, today, facts)
	})
	if txErr != nil {
		s.Logger.Warn("parent_today_status_resolve_failed",
			"school_id", tenantID,
			"student_ids", ids,
			"error", txErr.Error(),
		)
		return out, txErr
	}
	for id, f := range facts {
		status := deriveTodayStatus(*f)
		out[id] = &status
	}
	return out, nil
}

// withSchoolWeekendPlan reads the school's weekend setting at most once per
// transaction: the calendar and the Care Plan readers all consult it.
func withSchoolWeekendPlan(txCtx context.Context) context.Context {
	var (
		loaded  bool
		follows bool
		err     error
	)
	schoolCtx := txCtx
	return calendar.WithWeekendPlan(txCtx, func(context.Context) (bool, error) {
		if !loaded {
			follows, err = calendar.WeekendFollowsFriday(schoolCtx)
			loaded = true
		}
		return follows, err
	})
}

func (s *Service) loadTodayFacts(txCtx context.Context, ids []int64, today calendar.Date, facts map[int64]*todayStatusFacts) error {
	absent, err := s.absentToday(txCtx, ids, today)
	if err != nil {
		return err
	}
	for id, f := range facts {
		f.HasAbsence = absent[id]
	}
	if s.Attendance == nil {
		return nil
	}
	rows, err := s.Attendance.ListAttendance(txCtx, AttendanceFilter{StudentIDs: ids, FromDate: today.String(), UntilDate: today.String()})
	if err != nil {
		return err
	}
	byChild := make(map[int64][]Attendance, len(ids))
	for _, row := range rows {
		byChild[row.StudentID] = append(byChild[row.StudentID], row)
	}
	for id, f := range facts {
		f.AttendanceLoaded = true
		applyAttendanceRows(f, byChild[id])
	}
	tracks, err := s.Attendance.HasAttendance(txCtx, AttendanceFilter{
		FromDate: today.AddDays(-attendanceCultureLookbackDays).String(), UntilDate: today.String(),
	})
	if err != nil {
		return err
	}
	for _, f := range facts {
		f.SchoolTracksAttendance = tracks
	}
	s.loadTodayPlan(txCtx, ids, today, facts)
	return nil
}

// loadTodayPlan reads the care plan of the day: expected arrival and pickup.
// Ein nicht lesbarer Betreuungsplan darf die bereits geladene Anwesenheit
// nicht entwerten: wer nachweislich da ist, ist da, auch wenn wir seinen Plan
// nicht kennen. Deshalb ist dieser Fehler nicht fatal, er laesst nur
// CareDayResolved auf false.
func (s *Service) loadTodayPlan(txCtx context.Context, ids []int64, today calendar.Date, facts map[int64]*todayStatusFacts) {
	arrivals, withoutPlan, planErr := s.resolveExpectedArrivals(txCtx, ids, today)
	departing := make([]int64, 0, len(ids))
	for _, id := range ids {
		if f := facts[id]; !f.HasAbsence && f.HasAttendanceToday && f.CheckOut == "" {
			departing = append(departing, id)
		}
	}
	pickups, pickupErr := s.todayPickups(txCtx, slices.Concat(departing, withoutPlan), today)
	s.applyTodayPickups(departing, pickups, pickupErr, facts)
	if planErr != nil {
		// What was read stays: a child's own day exception holds even when
		// the weekly plan of its siblings could not be read. The others keep
		// CareDayResolved false.
		s.Logger.Warn("parent_today_status_care_plan_unreadable",
			"student_ids", ids,
			"error", planErr.Error(),
		)
	} else {
		s.arrivalsWithoutPlan(withoutPlan, pickups, pickupErr, arrivals)
	}
	for id, f := range facts {
		expected := arrivals[id]
		f.CareDayResolved = expected.resolved
		f.IsCareDay = expected.isCareDay
		f.ExpectedArrival = expected.hhmm
	}
}

// applyTodayPickups shows the pickup time of the children still in care. An
// unreadable pickup only leaves the time out.
func (s *Service) applyTodayPickups(departing []int64, pickups map[int64]*EffectivePickupTime, pickupErr error, facts map[int64]*todayStatusFacts) {
	if pickupErr != nil {
		s.Logger.Warn("parent_today_status_pickup_unreadable",
			"student_ids", departing,
			"error", pickupErr.Error(),
		)
		return
	}
	for _, id := range departing {
		if pickup := pickups[id]; pickup != nil && pickup.PickupTime != nil {
			facts[id].PickupTime = hhmm(*pickup.PickupTime)
		}
	}
}

// arrivalsWithoutPlan beantwortet Tage ohne Ankunftsplan: Eine Abholzeit fuer
// heute macht sie trotzdem zum Betreuungstag.
func (s *Service) arrivalsWithoutPlan(withoutPlan []int64, pickups map[int64]*EffectivePickupTime, pickupErr error, arrivals map[int64]expectedArrival) {
	for _, id := range withoutPlan {
		switch {
		case s.PickupSchedules == nil:
			arrivals[id] = expectedArrival{resolved: true}
		case pickupErr != nil:
			s.Logger.Warn("parent_today_status_care_plan_unreadable",
				"student_id", id,
				"error", pickupErr.Error(),
			)
			arrivals[id] = expectedArrival{}
		default:
			pickup := pickups[id]
			arrivals[id] = expectedArrival{resolved: true, isCareDay: pickup != nil && pickup.PickupTime != nil}
		}
	}
}

// todayPickups reads the effective pickups of the children in one statement
// set; no child, no read.
func (s *Service) todayPickups(txCtx context.Context, ids []int64, today calendar.Date) (map[int64]*EffectivePickupTime, error) {
	if s.PickupSchedules == nil || len(ids) == 0 {
		return map[int64]*EffectivePickupTime{}, nil
	}
	return s.PickupSchedules.GetBulkEffectivePickupTimesForDate(txCtx, slices.Compact(slices.Sorted(slices.Values(ids))), today)
}

// expectedArrival buendelt die beiden Fakten aus dem Betreuungsplan, die die
// Ableitung braucht: ist heute ueberhaupt ein Betreuungstag, und ab wann wird
// das Kind erwartet.
type expectedArrival struct {
	// resolved ist false, wenn der Betreuungsplan gar nicht befragt werden
	// konnte. Das ist etwas anderes als "heute kein Betreuungstag": ohne
	// Auskunft duerfen wir weder "keine Betreuung" noch "nicht angekommen"
	// behaupten.
	resolved  bool
	isCareDay bool
	hhmm      string
}

// resolveExpectedArrivals liest den Betreuungsplan der Kinder fuer heute. Eine
// Ausnahme fuer den Tag schlaegt den Wochenplan. withoutPlan names the
// children with neither: their pickup decides whether today is a care day.
// On an error the map keeps every child already resolved; a child missing
// from it is unresolved.
func (s *Service) resolveExpectedArrivals(ctx context.Context, ids []int64, today calendar.Date) (map[int64]expectedArrival, []int64, error) {
	out := make(map[int64]expectedArrival, len(ids))
	if s.ArrivalSchedules == nil {
		return out, nil, nil
	}

	// Wochenenden sind nie Betreuungstage, und der Wochenplan kennt nur Montag
	// bis Freitag: eine Anfrage mit Weekday 6 oder 7 quittiert er mit
	// "invalid weekday". Also gar nicht erst fragen. Eine Ferienbetreuung am
	// Wochenende faellt trotzdem nicht durchs Raster, weil eine vorhandene
	// Anwesenheit in deriveTodayStatus vor dem Betreuungstag geprueft wird.
	// Ausnahme: Folgt das Wochenende der Schule dem Freitagsplan (#3921),
	// gilt der Wochenplan vom Freitag.
	planWeekday, careWeekday, err := planWeekdayOf(ctx, today)
	if err != nil {
		return out, nil, err
	}
	if !careWeekday {
		for _, id := range ids {
			out[id] = expectedArrival{resolved: true}
		}
		return out, nil, nil
	}
	planned, err := s.arrivalExceptionsToday(ctx, ids, today, out)
	if err != nil || len(planned) == 0 {
		return out, nil, err
	}
	withoutPlan, err := s.weeklyArrivals(ctx, planned, planWeekday, out)
	if err != nil {
		return out, nil, err
	}
	return out, withoutPlan, nil
}

// arrivalExceptionsToday applies today's exceptions and returns the children
// without one: for them the weekly plan applies.
func (s *Service) arrivalExceptionsToday(ctx context.Context, ids []int64, today calendar.Date, out map[int64]expectedArrival) ([]int64, error) {
	exceptions, err := s.ArrivalSchedules.GetStudentArrivalExceptionsForDate(ctx, ids, today)
	if err != nil {
		return nil, err
	}
	planned := make([]int64, 0, len(ids))
	for _, id := range ids {
		exception := exceptions[id]
		switch {
		case exception == nil:
			planned = append(planned, id)
		case exception.ExpectedArrival == nil:
			out[id] = expectedArrival{resolved: true, isCareDay: false}
		default:
			out[id] = expectedArrival{resolved: true, isCareDay: true, hhmm: hhmm(*exception.ExpectedArrival)}
		}
	}
	return planned, nil
}

// weeklyArrivals applies the weekly plan of planWeekday and returns the
// children without one.
func (s *Service) weeklyArrivals(ctx context.Context, planned []int64, planWeekday int, out map[int64]expectedArrival) ([]int64, error) {
	rows, err := s.ArrivalSchedules.GetWeeklySchedulesByStudentIDsAndWeekday(ctx, planned, planWeekday)
	if err != nil {
		return nil, err
	}
	plans := make(map[int64]*ArrivalSchedule, len(rows))
	for _, row := range rows {
		if row != nil && row.Weekday == planWeekday {
			plans[row.StudentID] = row
		}
	}
	var withoutPlan []int64
	for _, id := range planned {
		if plan := plans[id]; plan != nil {
			out[id] = expectedArrival{resolved: true, isCareDay: true, hhmm: hhmm(plan.ExpectedArrival)}
			continue
		}
		withoutPlan = append(withoutPlan, id)
	}
	return withoutPlan, nil
}

// planWeekdayOf liefert den Wochentag, dessen Wochenplan heute gilt, und ob
// das ueberhaupt ein Betreuungstag sein kann: Montag bis Freitag, oder ein
// Wochenende, das dem Freitagsplan folgt (#3921).
func planWeekdayOf(ctx context.Context, today calendar.Date) (int, bool, error) {
	weekday, err := calendar.PlanWeekday(ctx, today)
	if err != nil {
		return 0, false, err
	}
	return weekday, weekday <= int(time.Friday), nil
}
