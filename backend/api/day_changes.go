package api

// The root binds the source ports of "Heute anders" (ADR 0299, #7659). The
// Personal source reads Workforce's absences and group substitutions,
// School Membership's group teachers, the People Directory's staff names and
// the group names, and applies the visibility rule of this one read: the
// care staff sees names for its own groups and itself, a number for the rest
// of the school; the lead sees every name. The projection names none of
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
	schoolstructureCompose "github.com/moto-ogs/project-phoenix/modules/schoolstructure/compose"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// dayChangesCaller is the Identity & Access read of the caller's staff
// record and groups (own groups and the ones the caller covers today).
type dayChangesCaller interface {
	CurrentStaffID(ctx context.Context) (int64, bool, error)
	MyGroupIDs(ctx context.Context) ([]int64, error)
}

// dayChangesWorkforce is the Workforce read of absences and substitutions.
type dayChangesWorkforce interface {
	ListStaffAbsences(context.Context, workforce.StaffAbsenceFilter) ([]workforce.StaffAbsence, error)
	ListGroupSubstitutions(context.Context, workforce.GroupSubstitutionFilter) ([]workforce.GroupSubstitution, error)
}

// dayChangesStaffNames maps staff ids to display names in one read.
type dayChangesStaffNames interface {
	StaffNames(ctx context.Context, staffIDs []int64) (map[int64]string, error)
}

// dayChangesGroups reads the groups by id in one read.
type dayChangesGroups interface {
	FindByIDs(ctx context.Context, ids []int64) (map[int64]*schoolstructureCompose.Group, error)
}

// DayChangesSources are the owner reads of "Heute anders"; all required.
type DayChangesSources struct {
	Caller    dayChangesCaller
	Workforce dayChangesWorkforce
	Teachers  owners.GroupTeacherStaff
	Names     dayChangesStaffNames
	Groups    dayChangesGroups
	Today     func() calendar.Date
	Logger    *slog.Logger
}

// NewDayChanges binds the sources to the projection's ports.
func NewDayChanges(sources DayChangesSources) (daychangesview.Query, error) {
	if sources.Caller == nil || sources.Workforce == nil || sources.Teachers == nil || sources.Names == nil || sources.Groups == nil {
		return nil, fmt.Errorf("%w: personal sources", daychangesview.ErrDependencies)
	}
	return daychangesview.New(daychangesview.Dependencies{
		Today:     sources.Today,
		Isolation: dayChangesSavepoints{},
		Staff:     dayChangesStaff{sources: sources},
		Logger:    sources.Logger,
	})
}

// dayChangesSavepoints runs every source in a savepoint of the request's
// school transaction, so a failed statement of one source leaves the
// transaction usable for the next (ADR 0299 point 7).
type dayChangesSavepoints struct{}

func (dayChangesSavepoints) Run(ctx context.Context, read func(context.Context) error) error {
	return tenant.WithSavepoint(ctx, read)
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
	handovers, err := s.handovers(ctx, day)
	if err != nil {
		return nil, err
	}
	viewer.addSubstitutes(handovers)
	absences, err := s.sources.Workforce.ListStaffAbsences(ctx, workforce.StaffAbsenceFilter{
		Statuses:    []string{workforce.AbsenceStatusReported, workforce.AbsenceStatusApproved},
		OverlapFrom: day.String(), OverlapTo: day.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("list staff absences: %w", err)
	}
	builder := newStaffEntryBuilder(viewer, day)
	for _, absence := range mergeAbsences(absences, day) {
		builder.absence(absence)
	}
	for _, handover := range handovers {
		builder.handover(handover)
	}
	return builder.finish(ctx, s.sources.Names, s.sources.Groups)
}

func (s dayChangesStaff) handovers(ctx context.Context, day calendar.Date) ([]workforce.GroupSubstitution, error) {
	rows, err := s.sources.Workforce.ListGroupSubstitutions(ctx, workforce.GroupSubstitutionFilter{
		TargetType: workforce.GroupSubstitutionTypeGroupHandover, On: day.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("list group substitutions: %w", err)
	}
	return rows, nil
}

func (s dayChangesStaff) viewer(ctx context.Context) (staffViewer, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	admin := securityruntime.HasAdminWildcard(granted)
	viewer := staffViewer{
		lead: admin || securityruntime.HasPermission(permissions.VacationApprove, granted) ||
			securityruntime.HasPermission(permissions.TimeTrackingManage, granted),
		ownAbsences: securityruntime.HasPermission(permissions.TimeTrackingOwn, granted),
		groups:      map[int64]bool{}, team: map[int64]bool{},
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
	groupIDs, err := s.sources.Caller.MyGroupIDs(ctx)
	if err != nil {
		return staffViewer{}, fmt.Errorf("resolve caller groups: %w", err)
	}
	if len(groupIDs) == 0 {
		return viewer, nil
	}
	return viewer, s.addTeam(ctx, &viewer, groupIDs)
}

// addTeam names the teachers of the caller's groups. Today's substitutes are
// added after their source query succeeds.
func (s dayChangesStaff) addTeam(ctx context.Context, viewer *staffViewer, groupIDs []int64) error {
	for _, id := range groupIDs {
		viewer.groups[id] = true
	}
	teachers, err := s.sources.Teachers.GroupTeacherStaffIDs(ctx, groupIDs)
	if err != nil {
		return fmt.Errorf("resolve group teachers: %w", err)
	}
	for _, staffIDs := range teachers {
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
		span, ok := byStaff[row.StaffID]
		if !ok {
			span = &staffAbsenceSpan{staffID: row.StaffID, start: row.DateStart, end: row.DateEnd, half: true}
			byStaff[row.StaffID] = span
			order = append(order, row.StaffID)
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
		People: []daychangesview.Person{{StaffID: span.staffID, Role: daychangesview.RoleAbsent, IsSelf: self}},
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
		return &daychangesview.Link{Target: daychangesview.LinkStaffAbsences, StaffID: &staffID}
	default:
		return &daychangesview.Link{Target: daychangesview.LinkStaffMember, StaffID: &staffID}
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
	people := []daychangesview.Person{{StaffID: row.SubstituteStaffID, Role: daychangesview.RoleSubstitute, IsSelf: row.SubstituteStaffID == b.viewer.selfID}}
	b.staffIDs[row.SubstituteStaffID] = true
	if row.RegularStaffID != nil {
		people = append(people, daychangesview.Person{StaffID: *row.RegularStaffID, Role: daychangesview.RoleReplaced, IsSelf: *row.RegularStaffID == b.viewer.selfID})
		b.staffIDs[*row.RegularStaffID] = true
	}
	b.groupIDs[row.GroupID] = true
	since, until := b.span(row.StartDate, row.EndDate)
	b.entries = append(b.entries, daychangesview.SourceEntry{
		Kind: daychangesview.KindGroupSubstitution, Involved: involved, Since: since, Until: until,
		People: people, Group: &daychangesview.Group{ID: row.GroupID},
		Link: &daychangesview.Link{Target: daychangesview.LinkGroupHandovers},
	})
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
	b.appendCount(daychangesview.KindStaffAbsentCount, b.absentCount, daychangesview.LinkStaffList)
	b.appendCount(daychangesview.KindGroupSubstitutionCount, b.handoverCount, daychangesview.LinkGroupHandovers)
	return b.entries, nil
}

func (b *staffEntryBuilder) appendCount(kind daychangesview.Kind, count int, target daychangesview.LinkTarget) {
	if count == 0 {
		return
	}
	b.entries = append(b.entries, daychangesview.SourceEntry{
		Kind: kind, Count: &count, Link: &daychangesview.Link{Target: target},
	})
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
			b.entries[i].People[j].Name = staffNames[b.entries[i].People[j].StaffID]
		}
		if group := b.entries[i].Group; group != nil {
			group.Name = groupNames[group.ID]
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
