package api

// The root binds the source ports of "Heute anders" (ADR 0299, #7659). The
// Personal source reads Workforce's absences and group substitutions,
// School Membership's group teachers, the People Directory's staff names and
// the group names, and applies the visibility rule of this one read: the
// care staff sees names for its own groups and itself, a number for the rest
// of the school; the lead sees every name. The changed and cancelled shifts
// of Workforce's Dienstplan (#7661) are part of the same source: the care
// staff sees only its own, the lead of the Dienstplan every one. So are the
// absences and covers of single blocks of Timetable (#7675). The projection names none of
// these owners; the translation is cross-owner glue and lives here.

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	peoplePorts "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	schoolstructureCompose "github.com/moto-ogs/project-phoenix/modules/schoolstructure/compose"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// dayChangesCaller is the Identity & Access read of the caller's staff
// record and classes. The caller's teacher groups come from School
// Membership by staff record (#7681); the groups it covers on the day from
// the day's Gruppenübergaben the source reads anyway (#7661, #7664): fewer
// reads, and the same day as the overview.
type dayChangesCaller interface {
	CurrentStaffID(ctx context.Context) (int64, bool, error)
	// MySchoolClasses are the classes the caller is staff of (#7681).
	MySchoolClasses(ctx context.Context) ([]string, error)
}

// dayChangesWorkforce is the Workforce read of the caller's covers and the
// planned shifts.
type dayChangesWorkforce interface {
	ListGroupSubstitutions(context.Context, workforce.GroupSubstitutionFilter) ([]workforce.GroupSubstitution, error)
	ListStaffShifts(context.Context, workforce.StaffShiftFilter) ([]workforce.StaffShift, error)
}

// dayChangesStaffDay is Workforce's read of the day's absences with plan
// effect and group handovers in one statement (#7903).
type dayChangesStaffDay interface {
	StaffDay(ctx context.Context, day string) (workforce.StaffDay, error)
}

// dayChangesStaffNames maps staff ids to display names in one read.
type dayChangesStaffNames interface {
	StaffNames(ctx context.Context, staffIDs []int64) (map[int64]string, error)
}

// newDayChangesStaffNames names staff members from their membership and
// person only: the overview needs no employment profile, which the full staff
// read loads in a statement of its own (#7667, the query budget of the route).
func newDayChangesStaffNames(persons peoplePorts.PersonDirectory) dayChangesStaffNames {
	staff := owners.NewTimetableStaff(persons.StaffRows())
	return dayChangesStaffNameFunc(func(ctx context.Context, staffIDs []int64) (map[int64]string, error) {
		members, err := staff.FindWithPersonByIDs(ctx, staffIDs)
		if err != nil {
			return nil, err
		}
		names := make(map[int64]string, len(members))
		for id, member := range members {
			if name := member.DisplayName(); name != "" {
				names[id] = name
			}
		}
		return names, nil
	})
}

// dayChangesStaffNameFunc lets a function serve as dayChangesStaffNames.
type dayChangesStaffNameFunc func(ctx context.Context, staffIDs []int64) (map[int64]string, error)

func (f dayChangesStaffNameFunc) StaffNames(ctx context.Context, staffIDs []int64) (map[int64]string, error) {
	return f(ctx, staffIDs)
}

// dayChangesGroups reads the groups by id in one read.
type dayChangesGroups interface {
	FindByIDs(ctx context.Context, ids []int64) (map[int64]*schoolstructureCompose.Group, error)
}

// DayChangesSources are the owner reads of "Heute anders"; all required.
type DayChangesSources struct {
	Caller dayChangesCaller
	// Workforce is the work-time composition; it serves the staff day too.
	Workforce dayChangesWorkforce
	Names     dayChangesStaffNames
	Groups    dayChangesGroups
	CarePlan  dayChangesCarePlan
	// DayPickups is Care Plan's read of the day's Abholart and pickup
	// person (#7655).
	DayPickups dayChangesDayPickups
	Students   dayChangesStudents
	// Notices is Timetable's read of the Hinweise der Leitung (#7667).
	Notices dayChangesNoticeReads
	// ClosingDays is School Calendar's read of the closing days (#7664).
	ClosingDays dayChangesClosingDayReads
	// Blocks is Timetable's read of the day's changed blocks (#7662).
	Blocks dayChangesBlocks
	// BlockStaff is Timetable's read of the day's blocks with an absent or
	// covering supervisor, for the Personal source (#7675).
	BlockStaff dayChangesBlockStaff
	// Assignments is School Membership's read of the caller's teacher
	// groups by staff record (#7681).
	Assignments dayChangesAssignments
	// ClassArrivals is Timetable's class arrival query; its day read gives
	// the class-wide arrival exceptions of the day (#7681).
	ClassArrivals timetable.ClassArrivalQuery
	// MealPlan is Meal Plan's change mark of a day (#7666).
	MealPlan dayChangesMenuChanges
	// Appointments is Appointments' read of the own calendar (#7663, #7903).
	Appointments dayChangesAppointmentReads
	Today        func() calendar.Date
	Logger       *slog.Logger
}

// NewDayChanges binds the sources to the projection's ports.
func NewDayChanges(sources DayChangesSources) (daychangesview.Query, error) {
	if sources.Caller == nil || sources.Workforce == nil || sources.Names == nil || sources.Groups == nil || sources.BlockStaff == nil {
		return nil, fmt.Errorf("%w: personal sources", daychangesview.ErrDependencies)
	}
	if sources.CarePlan == nil || sources.DayPickups == nil || sources.Students == nil {
		return nil, fmt.Errorf("%w: children sources", daychangesview.ErrDependencies)
	}
	if sources.Notices == nil {
		return nil, fmt.Errorf("%w: notice source", daychangesview.ErrDependencies)
	}
	if sources.ClosingDays == nil {
		return nil, fmt.Errorf("%w: closing day source", daychangesview.ErrDependencies)
	}
	if sources.Blocks == nil {
		return nil, fmt.Errorf("%w: timetable source", daychangesview.ErrDependencies)
	}
	if sources.MealPlan == nil {
		return nil, fmt.Errorf("%w: meal plan source", daychangesview.ErrDependencies)
	}
	if sources.Assignments == nil || sources.ClassArrivals == nil {
		return nil, fmt.Errorf("%w: class sources", daychangesview.ErrDependencies)
	}
	if sources.Appointments == nil {
		return nil, fmt.Errorf("%w: appointment source", daychangesview.ErrDependencies)
	}
	classDay, err := timetable.ClassArrivalDayOf(sources.ClassArrivals)
	if err != nil {
		return nil, err
	}
	if _, ok := sources.Workforce.(dayChangesStaffDay); !ok {
		return nil, fmt.Errorf("%w: workforce staff day", daychangesview.ErrDependencies)
	}
	// One name read per request for the sources that name staff (#7675).
	sources.Names = memoStaffNames{inner: sources.Names}
	return daychangesview.New(daychangesview.Dependencies{
		Today:        sources.Today,
		Isolation:    dayChangesSavepoints{},
		Staff:        dayChangesStaff{sources: sources},
		Children:     dayChangesChildren{sources: sources},
		Notices:      dayChangesNotices{reads: sources.Notices},
		Closing:      dayChangesClosingDays{reads: sources.ClosingDays},
		Activities:   dayChangesActivities{sources: sources},
		Classes:      dayChangesClasses{sources: sources, classDay: classDay},
		MealPlan:     dayChangesMealPlan{reads: sources.MealPlan},
		Appointments: dayChangesAppointments{caller: sources.Caller, reads: sources.Appointments},
		Logger:       sources.Logger,
	})
}

// dayChangesSavepoints runs every source in a savepoint of the request's
// school transaction, so a failed statement of one source leaves the
// transaction usable for the next (ADR 0299 point 7).
type dayChangesSavepoints struct{}

func (dayChangesSavepoints) Run(ctx context.Context, read func(context.Context) error) error {
	// The sources of one savepoint read the staff names once (#7675).
	return tenant.WithSavepoint(ctx, func(ctx context.Context) error {
		// Timetable's block reads share the day's staff rows (#7666).
		return read(timetable.WithDayStaffShare(withDayChangesGroupMemo(withDayChangesNameMemo(ctx))))
	})
}

func (dayChangesSavepoints) IsFatal(err error) bool { return tenant.IsSavepointControlFailure(err) }

// mountDayChanges serves GET /api/day-changes/today (#7659).
func mountDayChanges(tenant chi.Router, sources DayChangesSources) error {
	view, err := NewDayChanges(sources)
	if err != nil {
		return err
	}
	tenant.Mount("/day-changes", dayChangesHTTP.NewResource(view).Router(ProtectedTenantRoutes))
	return nil
}

// dayChangesStaff is the Personal source.
type dayChangesStaff struct{ sources DayChangesSources }

// staffViewer is what the Personal rule needs to know about the caller.
type staffViewer struct {
	selfID int64
	// lead may open the absence detail page: admin, vacation:approve or
	// time_tracking:manage. It sees every name.
	lead bool
	// counts may read the team numbers ("Personal heute", users:read).
	counts bool
	// ownAbsences may open the caller's own time tracking absences.
	// A staff record alone does not grant that destination.
	ownAbsences bool
	// staffRecords may open the staff list and a staff record.
	staffRecords bool
	// groupHandovers may open the group substitutions overview.
	groupHandovers bool
	// shiftPlan may open the Dienstplan of the school (admin or
	// time_tracking:manage). It sees every changed shift with its name; the
	// others see only their own.
	shiftPlan bool
	// substitutionPlan may open the Vertretungsplan (admin or
	// schedules:manage); dayPlan may open the day plan (schedules:read).
	substitutionPlan bool
	dayPlan          bool
	// groups are the caller's own groups and those it covers today; team
	// are the staff of these groups (teachers and today's substitutes).
	groups map[int64]bool
	team   map[int64]bool
}

func (s dayChangesStaff) StaffChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	viewer, err := s.viewer(ctx)
	if err != nil {
		return nil, err
	}
	if viewer.selfID == 0 && !viewer.lead && !viewer.counts {
		// Nothing of this source is visible to the account.
		return nil, nil
	}
	// The reported and approved absences and the group handovers of the day
	// in one Workforce statement (#7903).
	// NewDayChanges checked that the work-time composition serves it.
	staffDay, err := s.sources.Workforce.(dayChangesStaffDay).StaffDay(ctx, day.String())
	if err != nil {
		return nil, fmt.Errorf("list staff absences and group handovers: %w", err)
	}
	handovers, absences := staffDay.Handovers, staffDay.Absences
	blocks, err := s.blockStaffChanges(ctx, day)
	if err != nil {
		return nil, err
	}
	// The team decides only which absences, handovers and block changes
	// involve the caller; a day without them reads no team (#7666, the query
	// budget of the route).
	if len(handovers) > 0 || len(absences) > 0 || len(blocks) > 0 {
		if err := s.addTeam(ctx, &viewer, handovers); err != nil {
			return nil, err
		}
		viewer.addSubstitutes(handovers)
	}
	builder := newStaffEntryBuilder(viewer, day)
	absentToday := map[int64]bool{}
	for _, absence := range mergeAbsences(absences, day) {
		builder.absence(absence)
		// A half day leaves the other half: its block absences stay entries.
		absentToday[absence.staffID] = !absence.half
	}
	for _, handover := range handovers {
		builder.handover(handover)
	}
	if err := s.addShifts(ctx, builder, day); err != nil {
		return nil, err
	}
	for _, change := range blocks {
		builder.block(change, absentToday)
	}
	return builder.finish(ctx, s.sources.Names, s.sources.Groups)
}

func (s dayChangesStaff) viewer(ctx context.Context) (staffViewer, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	admin := securityruntime.HasAdminWildcard(granted)
	roles := sessiontoken.ClaimsFromCtx(ctx).Roles
	viewer := staffViewer{
		lead: admin || securityruntime.HasPermission(permissions.VacationApprove, granted) ||
			securityruntime.HasPermission(permissions.TimeTrackingManage, granted),
		ownAbsences:      securityruntime.HasPermission(permissions.TimeTrackingOwn, granted),
		staffRecords:     admin || hasStaffRecordAccess(granted),
		groupHandovers:   admin || hasGroupHandoverAccess(roles, granted),
		shiftPlan:        admin || securityruntime.HasPermission(permissions.TimeTrackingManage, granted),
		substitutionPlan: admin || securityruntime.HasPermission(permissions.SchedulesManage, granted),
		dayPlan:          readsDayPlan(ctx),
		groups:           map[int64]bool{}, team: map[int64]bool{},
	}
	viewer.counts = viewer.lead || securityruntime.HasPermission(permissions.UsersRead, granted)
	staffID, isStaff, err := s.sources.Caller.CurrentStaffID(ctx)
	if err != nil {
		return staffViewer{}, fmt.Errorf("resolve caller staff: %w", err)
	}
	if !isStaff {
		return viewer, nil
	}
	viewer.selfID = staffID
	return viewer, nil
}

func hasStaffRecordAccess(granted []string) bool {
	return securityruntime.HasPermission(permissions.UsersRead, granted) ||
		securityruntime.HasPermission(permissions.StaffManage, granted) ||
		securityruntime.HasPermission(permissions.StaffStammdaten, granted) ||
		securityruntime.HasPermission(permissions.TimeTrackingManage, granted)
}

func hasGroupHandoverAccess(roles, granted []string) bool {
	return containsRole(roles, "user") || containsRole(roles, "teacher") ||
		securityruntime.HasPermission(permissions.SubstitutionsRead, granted)
}

func containsRole(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}

// addTeam reads the caller's teacher groups, completes them with those it
// covers on the day and names the teachers of all of them, in one School
// Membership statement (#7666, the query budget of the route). Today's
// substitutes are added after.
func (s dayChangesStaff) addTeam(ctx context.Context, viewer *staffViewer, handovers []workforce.GroupSubstitution) error {
	if viewer.selfID == 0 {
		return nil
	}
	covered := map[int64]bool{}
	for _, cover := range handovers {
		if cover.SubstituteStaffID == viewer.selfID {
			covered[cover.GroupID] = true
		}
	}
	own, teachers, err := s.sources.groupTeam(ctx, viewer.selfID, sortedIDs(covered))
	if err != nil {
		return err
	}
	for _, id := range own {
		viewer.groups[id] = true
	}
	for id := range covered {
		viewer.groups[id] = true
	}
	for groupID, staffIDs := range teachers {
		if !viewer.groups[groupID] {
			continue
		}
		for _, id := range staffIDs {
			viewer.team[id] = true
		}
	}
	return nil
}

// addSubstitutes completes the caller's team with today's covers, as the team
// notice of #7138 does.
func (viewer *staffViewer) addSubstitutes(handovers []workforce.GroupSubstitution) {
	for _, cover := range handovers {
		if viewer.groups[cover.GroupID] {
			viewer.team[cover.SubstituteStaffID] = true
		}
	}
}

// staffAbsenceSpan is one staff member's absence over the day: overlapping
// entries of the same person merge to the widest span.
type staffAbsenceSpan struct {
	staffID    int64
	start, end string
	half       bool
}

func mergeAbsences(rows []workforce.StaffAbsence, day calendar.Date) []staffAbsenceSpan {
	byStaff := map[int64]*staffAbsenceSpan{}
	order := []int64{}
	for _, row := range rows {
		span, ok := byStaff[row.StaffID.Int64()]
		if !ok {
			span = &staffAbsenceSpan{staffID: row.StaffID.Int64(), start: row.DateStart, end: row.DateEnd, half: true}
			byStaff[row.StaffID.Int64()] = span
			order = append(order, row.StaffID.Int64())
		}
		span.start = min(span.start, row.DateStart)
		span.end = max(span.end, row.DateEnd)
		span.half = span.half && halfOn(row, day)
	}
	spans := make([]staffAbsenceSpan, 0, len(order))
	for _, id := range order {
		spans = append(spans, *byStaff[id])
	}
	return spans
}

// halfOn reports whether the absence covers only half of the day.
func halfOn(row workforce.StaffAbsence, day calendar.Date) bool {
	startHalf, endHalf := row.HalfBoundaryDays()
	return (startHalf && row.DateStart == day.String()) || (endHalf && row.DateEnd == day.String())
}

// staffEntryBuilder applies the Personal rule entry by entry and resolves
// the names of the visible people and groups in one read each.
type staffEntryBuilder struct {
	viewer        staffViewer
	day           calendar.Date
	entries       []daychangesview.SourceEntry
	absentCount   int
	handoverCount int
	blockCount    int
	staffIDs      map[int64]bool
	groupIDs      map[int64]bool
}

func newStaffEntryBuilder(viewer staffViewer, day calendar.Date) *staffEntryBuilder {
	return &staffEntryBuilder{viewer: viewer, day: day, staffIDs: map[int64]bool{}, groupIDs: map[int64]bool{}}
}

func (b *staffEntryBuilder) absence(span staffAbsenceSpan) {
	self := span.staffID == b.viewer.selfID
	involved := self || b.viewer.team[span.staffID]
	if !involved && !b.viewer.lead {
		if b.viewer.counts {
			b.absentCount++
		}
		return
	}
	since, until := b.span(span.start, span.end)
	b.staffIDs[span.staffID] = true
	b.entries = append(b.entries, daychangesview.SourceEntry{
		Kind: daychangesview.KindStaffAbsent, Involved: involved, HalfDay: span.half,
		Since: since, Until: until,
		People: []daychangesview.Person{{StaffID: ident.ID(span.staffID), Role: daychangesview.RoleAbsent, IsSelf: self}},
		Link:   b.absenceLink(span.staffID, self),
	})
}

func (b *staffEntryBuilder) absenceLink(staffID int64, self bool) *daychangesview.Link {
	switch {
	case self && b.viewer.ownAbsences:
		return &daychangesview.Link{Target: daychangesview.LinkOwnAbsences}
	case self:
		return nil
	case b.viewer.lead:
		return &daychangesview.Link{Target: daychangesview.LinkStaffAbsences, StaffID: (*ident.ID)(&staffID)}
	case b.viewer.staffRecords:
		return &daychangesview.Link{Target: daychangesview.LinkStaffMember, StaffID: (*ident.ID)(&staffID)}
	default:
		return nil
	}
}

func (b *staffEntryBuilder) handover(row workforce.GroupSubstitution) {
	self := b.viewer.selfID != 0 && (row.SubstituteStaffID == b.viewer.selfID ||
		(row.RegularStaffID != nil && *row.RegularStaffID == b.viewer.selfID))
	involved := self || b.viewer.groups[row.GroupID]
	if !involved && !b.viewer.lead {
		if b.viewer.counts {
			b.handoverCount++
		}
		return
	}
	people := []daychangesview.Person{{StaffID: ident.ID(row.SubstituteStaffID), Role: daychangesview.RoleSubstitute, IsSelf: row.SubstituteStaffID == b.viewer.selfID}}
	b.staffIDs[row.SubstituteStaffID] = true
	if row.RegularStaffID != nil {
		people = append(people, daychangesview.Person{StaffID: ident.ID(*row.RegularStaffID), Role: daychangesview.RoleReplaced, IsSelf: *row.RegularStaffID == b.viewer.selfID})
		b.staffIDs[*row.RegularStaffID] = true
	}
	b.groupIDs[row.GroupID] = true
	since, until := b.span(row.StartDate, row.EndDate)
	entry := daychangesview.SourceEntry{
		Kind: daychangesview.KindGroupSubstitution, Involved: involved, Since: since, Until: until,
		People: people, Group: &daychangesview.Group{ID: ident.ID(row.GroupID)},
	}
	if b.viewer.groupHandovers {
		entry.Link = &daychangesview.Link{Target: daychangesview.LinkGroupHandovers}
	}
	b.entries = append(b.entries, entry)
}

// span keeps "seit" and "bis" only where the change reaches past the day.
// The owners store the days as text; they become calendar days here.
func (b *staffEntryBuilder) span(start, end string) (since, until *calendar.Date) {
	if first, err := calendar.ParseDate(start); err == nil && first.Before(b.day) {
		since = &first
	}
	if last, err := calendar.ParseDate(end); err == nil && last.After(b.day) {
		until = &last
	}
	return since, until
}

func (b *staffEntryBuilder) finish(ctx context.Context, names dayChangesStaffNames, groups dayChangesGroups) ([]daychangesview.SourceEntry, error) {
	if err := b.resolveNames(ctx, names, groups); err != nil {
		return nil, err
	}
	b.appendCount(daychangesview.KindStaffAbsentCount, b.absentCount, daychangesview.LinkStaffList, b.viewer.staffRecords)
	b.appendCount(daychangesview.KindGroupSubstitutionCount, b.handoverCount, daychangesview.LinkGroupHandovers, b.viewer.groupHandovers)
	switch {
	case b.viewer.substitutionPlan:
		b.appendCount(daychangesview.KindBlockChangeCount, b.blockCount, daychangesview.LinkSubstitutionPlan, true)
	case b.viewer.dayPlan:
		b.appendCount(daychangesview.KindBlockChangeCount, b.blockCount, daychangesview.LinkDayPlan, true)
	default:
		b.appendCount(daychangesview.KindBlockChangeCount, b.blockCount, daychangesview.LinkDayPlan, false)
	}
	return b.entries, nil
}

func (b *staffEntryBuilder) appendCount(kind daychangesview.Kind, count int, target daychangesview.LinkTarget, canOpen bool) {
	if count == 0 {
		return
	}
	entry := daychangesview.SourceEntry{Kind: kind, Count: &count}
	if canOpen {
		entry.Link = &daychangesview.Link{Target: target}
	}
	b.entries = append(b.entries, entry)
}

func (b *staffEntryBuilder) resolveNames(ctx context.Context, names dayChangesStaffNames, groups dayChangesGroups) error {
	if len(b.staffIDs) == 0 {
		return nil
	}
	staffNames, err := names.StaffNames(ctx, sortedIDs(b.staffIDs))
	if err != nil {
		return fmt.Errorf("resolve staff names: %w", err)
	}
	groupNames := map[int64]string{}
	if len(b.groupIDs) > 0 {
		rows, err := groups.FindByIDs(ctx, sortedIDs(b.groupIDs))
		if err != nil {
			return fmt.Errorf("resolve group names: %w", err)
		}
		for id, row := range rows {
			if row != nil {
				groupNames[id] = row.Name
			}
		}
	}
	for i := range b.entries {
		for j := range b.entries[i].People {
			b.entries[i].People[j].Name = staffNames[b.entries[i].People[j].StaffID.Int64()]
		}
		if group := b.entries[i].Group; group != nil {
			group.Name = groupNames[group.ID.Int64()]
		}
	}
	return nil
}

func sortedIDs(set map[int64]bool) []int64 {
	ids := make([]int64, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}
