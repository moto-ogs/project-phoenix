package api

// "Heute anders" of one child in the parents portal (#7671, ADR 0299). The
// parents portal resolved the child through the guardian's relationship
// permission (parent_portal.access) and opened the child's school; these
// bindings read the owners for that one child and carry nothing else: no
// name of a staff member, no reason, no note, no free text of the school
// besides the name of a closing day. The projection's staff rules
// (permissions of a staff session) do not apply to a parent session; the
// child filter is the rule here.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// dayChangesChildBlocks is Timetable's read of the changed blocks one child
// is planned on.
type dayChangesChildBlocks interface {
	ChildBlockDayChanges(ctx context.Context, studentID int64, date calendar.Date) ([]timetable.BlockDayChange, error)
}

// ChildDayChangesSources are the owner reads of the child's day; all
// required.
type ChildDayChangesSources struct {
	CarePlan dayChangesCarePlan
	// DayPickups reads the child's Abholart and pickup person of the day
	// (#8162) in one statement.
	DayPickups  dayChangesDayPickups
	Students    dayChangesStudents
	ClosingDays dayChangesClosingDayReads
	// OpeningChanges is School Calendar's read of the opening changes (#8170).
	OpeningChanges dayChangesOpeningChangeReads
	// WeeklyPickups is Care Plan's weekly pickups, read on a day with an
	// opening change only (#8173).
	WeeklyPickups dayChangesWeeklyPickups
	Blocks        dayChangesChildBlocks
	ClassArrivals dayChangesClassArrivals
	// Meals is Meal Plan's read of a cancelled lunch the child is booked
	// for (#8160).
	Meals  dayChangesChildMeals
	Today  func() calendar.Date
	Logger *slog.Logger
}

// dayChangesChildMeals is Meal Plan's read of a cancelled lunch of one
// booked child, in the request's tenant transaction.
type dayChangesChildMeals interface {
	ChildMealCancelledOn(ctx context.Context, studentID int64, date mealplan.Date) (bool, error)
}

// NewChildDayChanges binds the child's sources to the projection and the
// projection to the parents portal's port.
func NewChildDayChanges(sources ChildDayChangesSources) (parentService.ChildDayChanges, error) {
	if sources.CarePlan == nil || sources.DayPickups == nil || sources.Students == nil || sources.ClosingDays == nil || sources.OpeningChanges == nil || sources.WeeklyPickups == nil || sources.Blocks == nil || sources.ClassArrivals == nil || sources.Meals == nil || sources.Logger == nil {
		return nil, fmt.Errorf("%w: child day sources", daychangesview.ErrDependencies)
	}
	query, err := daychangesview.NewChild(daychangesview.ChildDependencies{
		Today: sources.Today, Isolation: dayChangesSavepoints{}, Logger: sources.Logger,
		Children:   childDayChildren{sources: sources},
		Closing:    childDayClosingDays{reads: sources.ClosingDays, openings: sources.OpeningChanges, pickups: sources.WeeklyPickups, logger: sources.Logger},
		Activities: childDayActivities(sources.Blocks),
		Classes:    childDayClasses{sources: sources},
		Meals:      childDayMeals(sources.Meals),
	})
	if err != nil {
		return nil, err
	}
	return childDayChangesPort{query: query}, nil
}

// childClass reads the child's class in one People Directory statement.
func (sources ChildDayChangesSources) childClass(ctx context.Context, studentID ident.ID) (string, error) {
	names, err := sources.Students.ListStudentNamesByID(ctx, []int64{studentID.Int64()})
	if err != nil {
		return "", fmt.Errorf("read child class: %w", err)
	}
	for _, name := range names {
		if name.StudentID == studentID.Int64() && !name.PersonDeleted {
			return strings.TrimSpace(name.SchoolClass), nil
		}
	}
	return "", nil
}

// childDayChildren is the Kinder source of the child: its status, its
// changed pickup, whether it goes home alone, who collects it (#8162) and
// its class trip. The pickup notes stay out: they are free text.
type childDayChildren struct{ sources ChildDayChangesSources }

func (s childDayChildren) ChildDayChanges(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error) {
	date := careplan.Date(day.String())
	ids := []int64{child.StudentID.Int64()}
	statusDays, err := s.sources.CarePlan.ListStudentStatusDays(ctx, careplan.StudentStatusDayFilter{StudentIDs: ids, Date: date, ActiveOnly: true})
	if err != nil {
		return nil, fmt.Errorf("list status days: %w", err)
	}
	exceptions, err := s.sources.CarePlan.ListPickupExceptions(ctx, careplan.StudentScheduleFilter{StudentIDs: ids, Date: date})
	if err != nil {
		return nil, fmt.Errorf("list pickup exceptions: %w", err)
	}
	pickups, err := s.sources.DayPickups.ListDayPickups(ctx, day, day, ids)
	if err != nil {
		return nil, fmt.Errorf("list day pickups: %w", err)
	}
	arrivals, err := s.sources.CarePlan.ListArrivalExceptions(ctx, careplan.StudentScheduleFilter{StudentIDs: ids, Date: date})
	if err != nil {
		return nil, fmt.Errorf("list arrival exceptions: %w", err)
	}
	statusDays, exceptions, pickups, arrivals = onlyChild(child.StudentID.Int64(), statusDays, exceptions, pickups, arrivals)
	entries := childAbsence(statusDays, child.AccountID)
	entries = append(entries, childPickup(exceptions, len(entries) > 0, child.AccountID)...)
	entries = append(entries, childDayPickups(pickups, child.AccountID)...)
	trips := classTripChildren(statusDays, arrivals)
	if len(trips) == 0 {
		return entries, nil
	}
	class, err := s.sources.childClass(ctx, child.StudentID)
	if err != nil || class == "" {
		return entries, err
	}
	trip := &daychangesview.DayClass{Name: class}
	if trips[0].returnAt != "" {
		at := trips[0].returnAt
		trip.Time = &at
	}
	return append(entries, daychangesview.SourceEntry{Kind: daychangesview.KindClassTrip, Involved: true, Class: trip}), nil
}

// onlyChild keeps the rows of the child, whatever the owner's filter did.
func onlyChild(studentID int64, statusDays []careplan.StudentStatusDay, exceptions []careplan.PickupException, pickups []careplan.DayPickup, arrivals []careplan.ArrivalException) ([]careplan.StudentStatusDay, []careplan.PickupException, []careplan.DayPickup, []careplan.ArrivalException) {
	keep := func(id int64) bool { return id == studentID }
	return filterRows(statusDays, func(r careplan.StudentStatusDay) bool { return keep(r.StudentID) }),
		filterRows(exceptions, func(r careplan.PickupException) bool { return keep(r.StudentID) }),
		filterRows(pickups, func(r careplan.DayPickup) bool { return keep(r.StudentID) }),
		filterRows(arrivals, func(r careplan.ArrivalException) bool { return keep(r.StudentID) })
}

func filterRows[T any](rows []T, keep func(T) bool) []T {
	kept := make([]T, 0, len(rows))
	for _, row := range rows {
		if keep(row) {
			kept = append(kept, row)
		}
	}
	return kept
}

// childAbsence is the child's status of the day, sick before excused, as on
// the detail page. The note never leaves the source.
func childAbsence(days []careplan.StudentStatusDay, accountID int64) []daychangesview.SourceEntry {
	var status *daychangesview.ChildStatus
	byYou := false
	for _, day := range days {
		var next daychangesview.ChildStatus
		switch day.Status {
		case careplan.StudentStatusDaySick:
			next = daychangesview.ChildSick
		case careplan.StudentStatusDayExcused:
			next = daychangesview.ChildExcused
		default:
			continue
		}
		if status == nil || *status != daychangesview.ChildSick {
			status, byYou = &next, enteredBy(accountID, day.GuardianAccountID, day.ReportedByAccountID)
		}
	}
	if status == nil {
		return nil
	}
	return []daychangesview.SourceEntry{{
		Kind: daychangesview.KindChildAbsent, Involved: true, EnteredByYou: byYou,
		Child: &daychangesview.Child{Status: status},
	}}
}

// childPickup is the child's changed pickup of the day. An exception without
// a time says the child does not come; beside a reported absence that says
// nothing new. The reason stays out.
func childPickup(exceptions []careplan.PickupException, absent bool, accountID int64) []daychangesview.SourceEntry {
	entries := make([]daychangesview.SourceEntry, 0, len(exceptions))
	for _, exception := range exceptions {
		if exception.PickupTime == nil && absent {
			continue
		}
		child := &daychangesview.Child{}
		if exception.PickupTime != nil {
			// The TIME column holds the wall clock itself; no zone applies.
			at := exception.PickupTime.Format("15:04")
			child.PickupTime = &at
		}
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindChildPickupChanged, Involved: true, Child: child,
			EnteredByYou: enteredBy(accountID, exception.CreatedByGuardian),
		})
	}
	return entries
}

// childDayPickups is whether the child goes home alone and who collects it
// today (#8162). The guardian reads the name of the person: a family named
// it, or the OGS set it for the child. A person a request of the reading
// guardian named is marked EnteredByYou.
func childDayPickups(pickups []careplan.DayPickup, accountID int64) []daychangesview.SourceEntry {
	entries := make([]daychangesview.SourceEntry, 0, len(pickups))
	for _, pickup := range pickups {
		if pickup.Departure != nil && pickup.Departure.DepartureMode == careplan.DepartureModeAlone {
			entries = append(entries, daychangesview.SourceEntry{Kind: daychangesview.KindChildGoesAlone, Involved: true})
		}
		if person := pickup.Person; person != nil {
			entries = append(entries, daychangesview.SourceEntry{
				Kind: daychangesview.KindChildPickupPerson, Involved: true,
				EnteredByYou: enteredBy(accountID, person.RequestedByGuardian),
				Child:        &daychangesview.Child{PickupPerson: &daychangesview.ChildPickupPerson{Name: person.Name, OneTime: person.OneTime()}},
			})
		}
	}
	return entries
}

// enteredBy reports whether the reading guardian's account wrote the row.
func enteredBy(accountID int64, authors ...*int64) bool {
	for _, author := range authors {
		if author != nil && *author == accountID {
			return true
		}
	}
	return false
}

// childDayClosingDays is the closing days of the child's school and of its
// current Träger, and the opening changes of the school (#8170). The name
// of a closing day or an opening change is the only free text the child's
// day carries.
// The child's day has no sections: every entry concerns the child, so the
// closed school stands above everything, as in the staff overview.
type childDayClosingDays struct {
	reads    dayChangesClosingDayReads
	openings dayChangesOpeningChangeReads
	pickups  dayChangesWeeklyPickups
	logger   *slog.Logger
}

func (s childDayClosingDays) ChildDayChanges(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error) {
	days, err := s.reads.ListClosingDays(ctx, schoolcalendar.ClosingDayFilter{OverlappingFrom: day.String(), OverlappingTo: day.String()})
	if err != nil {
		return nil, fmt.Errorf("list closing days: %w", err)
	}
	// The opening changes of the school (#8170), with the same rule.
	openings, err := s.openings.ListOpeningChanges(ctx, day, day)
	if err != nil {
		return nil, fmt.Errorf("list opening changes: %w", err)
	}
	entries := make([]daychangesview.SourceEntry, 0, len(days)+len(openings))
	for _, closing := range days {
		since, until := closingDaySpan(closing, day)
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindClosingDay, Involved: true, Since: since, Until: until,
			Closing: &daychangesview.DayClosing{Name: closing.Reason, Traeger: closing.Traeger},
		})
	}
	opened := openingChangeEntries(openings, day, nil, true)
	// A closing day already tells the parent that care does not take place.
	// A weekly pickup conflict beside it is neither actionable nor worth a
	// separate Care Plan read.
	if len(days) == 0 {
		if err := markRegularPickupAfterClosing(ctx, s.pickups, child.StudentID.Int64(), day, opened); err != nil {
			// The weekly pickup only adds a conflict hint. Calendar entries remain
			// available when its separate Care Plan read is temporarily unavailable.
			s.logger.WarnContext(ctx, "weekly pickup lookup unavailable; omitted opening-time conflict hint", "error", err)
		}
	}
	return append(entries, opened...), nil
}

// childDaySourceFunc lets a function serve as a source of the child's day.
type childDaySourceFunc func(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error)

func (f childDaySourceFunc) ChildDayChanges(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error) {
	return f(ctx, day, child)
}

// childDayActivities is the Stundenplan of the child: the blocks it is
// planned on that do not run as planned. A covered block says only that
// somebody else leads it; no staff id or name leaves this binding.
func childDayActivities(blocks dayChangesChildBlocks) childDaySourceFunc {
	return func(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error) {
		changes, err := blocks.ChildBlockDayChanges(ctx, child.StudentID.Int64(), day)
		if err != nil {
			return nil, fmt.Errorf("list child blocks: %w", err)
		}
		entries := make([]daychangesview.SourceEntry, 0, len(changes))
		for _, change := range changes {
			for _, entry := range activityEntries(day, change, nil, 0, false) {
				entry.Involved, entry.Link, entry.People = true, nil, nil
				entries = append(entries, entry)
			}
		}
		return entries, nil
	}
}

// childDayClasses is the Unterrichtsschluss of the child's class.
type childDayClasses struct{ sources ChildDayChangesSources }

func (s childDayClasses) ChildDayChanges(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error) {
	rows, err := s.sources.ClassArrivals.ListClassArrivalExceptionsOn(ctx, day)
	if err != nil {
		return nil, fmt.Errorf("list class arrival exceptions: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	class, err := s.sources.childClass(ctx, child.StudentID)
	if err != nil || class == "" {
		return nil, err
	}
	entries := []daychangesview.SourceEntry{}
	for _, row := range rows {
		if classKey(row.SchoolClass) != classKey(class) {
			continue
		}
		at := calendar.NormalizeWallClock(row.ArrivalTime).Format("15:04")
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindClassDismissalChanged, Involved: true,
			Class: &daychangesview.DayClass{Name: class, Time: &at},
		})
	}
	return entries, nil
}

// childDayMeals is Essen of the child (#8160): the school cancelled lunch
// on a day the child is booked for. A child without a booking gets no
// entry. The school's reason stays with the team: the form that takes it
// tells the school that the team sees it.
func childDayMeals(meals dayChangesChildMeals) childDaySourceFunc {
	return func(ctx context.Context, day calendar.Date, child daychangesview.ChildFilter) ([]daychangesview.SourceEntry, error) {
		cancelled, err := meals.ChildMealCancelledOn(ctx, child.StudentID.Int64(), mealplan.Date(day.String()))
		if err != nil {
			return nil, fmt.Errorf("read child meal cancellation: %w", err)
		}
		if !cancelled {
			return nil, nil
		}
		return []daychangesview.SourceEntry{{Kind: daychangesview.KindMealCancelled, Involved: true}}, nil
	}
}

// childDayChangesPort serves the parents portal's port from the projection.
type childDayChangesPort struct{ query daychangesview.ChildQuery }

func (p childDayChangesPort) ChildDayChanges(ctx context.Context, studentID, accountID int64, on *calendar.Date) (parentService.ChildDay, error) {
	child := daychangesview.ChildFilter{StudentID: ident.ID(studentID), AccountID: accountID}
	var overview daychangesview.Overview
	var err error
	if on == nil {
		overview, err = p.query.ChildDay(ctx, child)
	} else {
		overview, err = p.query.ChildDayOn(ctx, *on, child)
	}
	if errors.Is(err, daychangesview.ErrDayOutOfRange) {
		return parentService.ChildDay{}, parentService.ErrDayChangesDayOutOfRange
	}
	if err != nil {
		return parentService.ChildDay{}, err
	}
	day := parentService.ChildDay{
		Date:    overview.Date,
		Sources: make([]parentService.ChildDaySource, 0, len(overview.Sources)),
		Entries: make([]parentService.ChildDayChange, 0, len(overview.Entries)),
	}
	for _, source := range overview.Sources {
		day.Sources = append(day.Sources, parentService.ChildDaySource{Source: string(source.Source), Failed: source.Status == daychangesview.SourceFailed})
	}
	for _, entry := range overview.Entries {
		day.Entries = append(day.Entries, toParentDayChange(entry))
	}
	return day, nil
}

// toParentDayChange copies the fields a parent may read; People, Group,
// Link, Notice, ChildSummary and Appointment never cross.
func toParentDayChange(entry daychangesview.Entry) parentService.ChildDayChange {
	out := parentService.ChildDayChange{
		Kind: string(entry.Kind), AllDay: entry.AllDay, Since: entry.Since, Until: entry.Until,
		StartsAt: entry.StartsAt, EndsAt: entry.EndsAt, EnteredByYou: entry.EnteredByYou,
	}
	if child := entry.Child; child != nil {
		if child.Status != nil {
			status := string(*child.Status)
			out.ChildStatus = &status
		}
		out.PickupTime = child.PickupTime
		if person := child.PickupPerson; person != nil {
			out.PickupPersonName, out.PickupPersonOneTime = &person.Name, person.OneTime
		}
		out.PickupAfterClosing = child.AfterClosing
	}
	if entry.Activity != nil {
		out.ActivityTitle = &entry.Activity.Title
	}
	if entry.Room != nil {
		out.RoomName = &entry.Room.Name
	}
	if entry.PreviousRoom != nil {
		out.PreviousRoomName = &entry.PreviousRoom.Name
	}
	if entry.Closing != nil {
		out.ClosingName, out.ClosingTraeger = &entry.Closing.Name, entry.Closing.Traeger
	}
	if entry.Opening != nil {
		out.OpeningName, out.OpensAt, out.ClosesAt = &entry.Opening.Name, &entry.Opening.OpensAt, &entry.Opening.ClosesAt
		// The child's weekly pickup after the changed closing time (#8173).
		if regular := entry.Opening.RegularPickupAfterClosing; regular != nil {
			out.PickupTime, out.PickupAfterClosing = regular, true
		}
	}
	if entry.Class != nil {
		out.ClassName, out.ClassTime = &entry.Class.Name, entry.Class.Time
	}
	return out
}

// childDayCarePlan is Care Plan as the child's day reads it: the day's
// rows and the weekly pickups (#8173).
type childDayCarePlan interface {
	dayChangesCarePlan
	dayChangesWeeklyPickups
}

// mustBuildChildDayChanges binds the child's day over the owners the serve
// root builds anyway: Care Plan, People Directory, School Calendar, the class
// arrivals and the operational day of Timetable. A failure is a wiring error
// of the root, so the serve root stops at it.
func mustBuildChildDayChanges(carePlan childDayCarePlan, dayPickups dayChangesDayPickups, students dayChangesStudents, closing dayChangesClosingDayReads, classArrivals timetable.ClassArrivalQuery, lifecycle owners.TimetableLifecycle, meals dayChangesChildMeals, today func() calendar.Date, logger *slog.Logger) parentService.ChildDayChanges {
	port, err := buildChildDayChanges(carePlan, dayPickups, students, closing, classArrivals, lifecycle, meals, today, logger)
	if err != nil {
		panic(fmt.Sprintf("compose the child's day changes: %v", err))
	}
	return port
}

func buildChildDayChanges(carePlan childDayCarePlan, dayPickups dayChangesDayPickups, students dayChangesStudents, closing dayChangesClosingDayReads, classArrivals timetable.ClassArrivalQuery, lifecycle owners.TimetableLifecycle, meals dayChangesChildMeals, today func() calendar.Date, logger *slog.Logger) (parentService.ChildDayChanges, error) {
	classDay, err := timetable.ClassArrivalDayOf(classArrivals)
	if err != nil {
		return nil, err
	}
	blocks, err := timetable.ChildBlockDayChangesOf(lifecycle.Operations)
	if err != nil {
		return nil, err
	}
	return NewChildDayChanges(ChildDayChangesSources{
		CarePlan: carePlan, DayPickups: dayPickups, Students: students, ClosingDays: closing,
		OpeningChanges: schoolCalendarCompose.NewOpeningChanges(), WeeklyPickups: carePlan,
		Blocks: blocks, ClassArrivals: classDay, Meals: meals, Today: today, Logger: logger,
	})
}
