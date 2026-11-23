package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// careEnrollmentDraft is one roster row a child's bookings plan on one
// activity group before it is written. A group can carry several: one row
// has one weekday set and one window, so bookings that end on different days
// plan one row per stretch (#7908).
type careEnrollmentDraft struct {
	activityGroupID  int64
	calendarPeriodID *int64
	selectedWeekday  map[int]bool
	allWeekdays      bool
	// validFrom/validUntil bound the row within the phase (until exclusive,
	// nil = the phase's own bound). A sourced draft stops at its template
	// segment's recurrence envelope, clipped to the phase's overlap with the
	// template's period, and at the window the child's offering link is valid
	// in (#2147 review): a split predecessor gets no row past its capped
	// valid_until, and a dated switch into or out of the offering plans no
	// day outside it. A draft of the legacy ActivityGroupID feed starts with
	// the phase, its dated flows start rows via the adjustment split, and
	// ends with its booking (#7908).
	validFrom  *calendar.Date
	validUntil *calendar.Date
	// studentValidUntil is the child's exclusive care end. It bounds every
	// draft, so a later resync cannot recreate rows after a completed care
	// exit.
	studentValidUntil *calendar.Date
}

// careDraftPlan collects what a child's booking links plan before the rows
// are cut: per activity group one draft per link of the legacy
// ActivityGroupID feed (#1651), each ending with its link, and the one draft
// of the sourced feed (#2137).
type careDraftPlan struct {
	legacy  map[int64][]*careEnrollmentDraft
	sourced map[int64]*careEnrollmentDraft
}

// draftSources are the templates and schedules the sourced feed drafts on,
// loaded once per selection.
type draftSources struct {
	byOffering map[int64][]ports.SourcedTemplate
	schedules  map[int64][]careplan.LinkedSchedule
}

func (m *BookingMaterialization) buildCareEnrollmentDrafts(
	ctx context.Context,
	requestChildID, studentID int64,
	links []*careplan.BookedOffering,
	offerings []careplan.CareOffering,
	phase careplan.OfferingPhase,
) (map[int64][]*careEnrollmentDraft, map[int64]ports.SourcedTemplate, error) {
	offeringByID := offeringsByID(offerings)
	student, studentValidUntil, err := m.studentCareDraftBounds(ctx, studentID)
	if err != nil {
		return nil, nil, err
	}
	sources, err := m.loadSourcedTemplateDraftInputs(ctx, bookedOfferingIDs(links))
	if err != nil {
		return nil, nil, err
	}
	plan := careDraftPlan{legacy: make(map[int64][]*careEnrollmentDraft), sourced: make(map[int64]*careEnrollmentDraft)}
	// Templates sourcing several offerings are not drafted per link — see
	// addSourcedTemplateDrafts — the caller resyncs them after persisting.
	multiSource := make(map[int64]ports.SourcedTemplate)
	for _, link := range links {
		offering := offeringByID[link.CareOfferingID]
		if offering == nil {
			m.deps.Logger.Warn("decision: care offering missing for child link",
				slog.Int64("request_child_id", requestChildID),
				slog.Int64("care_offering_id", link.CareOfferingID))
			continue
		}
		if err := m.addLegacyLinkedGroupDrafts(ctx, plan.legacy, offering, link, phase); err != nil {
			return nil, nil, err
		}
		feed := sourcedDraftFeed{offering: offering, link: link, phase: phase, gradeLevel: student.GradeLevel, schoolClass: student.SchoolClass}
		if err := m.addSourcedTemplateDrafts(ctx, plan.sourced, multiSource, feed, sources); err != nil {
			return nil, nil, err
		}
	}
	drafts := plan.rows(phase)
	for _, rows := range drafts {
		for _, draft := range rows {
			draft.studentValidUntil = cloneOptionalDate(studentValidUntil)
		}
	}
	return drafts, multiSource, nil
}

func (m *BookingMaterialization) loadSourcedTemplateDraftInputs(ctx context.Context, offeringIDs []int64) (draftSources, error) {
	templates, err := m.deps.Templates.TemplatesSourcedFrom(ctx, offeringIDs)
	if err != nil {
		return draftSources{}, fmt.Errorf("decision: list sourced templates: %w", err)
	}
	groupIDs := make([]int64, 0, len(templates))
	for _, template := range templates {
		groupIDs = append(groupIDs, template.ID)
	}
	var schedules []careplan.LinkedSchedule
	if len(groupIDs) > 0 {
		schedules, err = m.catalog.deps.Timetable.GroupSchedules(ctx, groupIDs)
		if err != nil {
			return draftSources{}, fmt.Errorf("decision: load sourced template schedules: %w", err)
		}
	}
	return draftSources{byOffering: sourcedTemplatesByOffering(templates), schedules: linkedSchedulesByGroup(schedules)}, nil
}

func sourcedTemplatesByOffering(templates []ports.SourcedTemplate) map[int64][]ports.SourcedTemplate {
	result := make(map[int64][]ports.SourcedTemplate)
	for _, template := range templates {
		for _, offeringID := range template.SourceCareOfferingIDs {
			result[offeringID] = append(result[offeringID], template)
		}
	}
	return result
}

// studentCareDraftBounds reads the child's Jahrgang and school class the
// sources' filters match on, and derives its exclusive care end. A missing
// row yields open bounds for legacy compatibility.
func (m *BookingMaterialization) studentCareDraftBounds(ctx context.Context, studentID int64) (ports.BookingStudent, *calendar.Date, error) {
	if studentID <= 0 {
		return ports.BookingStudent{}, nil, nil
	}
	student, err := m.deps.Students.Student(ctx, studentID, false)
	if err != nil {
		if errors.Is(err, ports.ErrBookingRowNotFound) {
			return ports.BookingStudent{}, nil, nil
		}
		return ports.BookingStudent{}, nil, fmt.Errorf("decision: load student for care draft bounds: %w", err)
	}
	var validUntil *calendar.Date
	if student.EnrolledUntil != nil {
		end := student.EnrolledUntil.AddDays(1)
		validUntil = &end
	}
	return student, validUntil, nil
}

// addLegacyLinkedGroupDrafts is the pre-#2137 offering→template feed: the one
// activity group the offering points at via ActivityGroupID.
func (m *BookingMaterialization) addLegacyLinkedGroupDrafts(
	ctx context.Context,
	drafts map[int64][]*careEnrollmentDraft,
	offering *careplan.CareOffering,
	link *careplan.BookedOffering,
	phase careplan.OfferingPhase,
) error {
	if offering.ActivityGroupID == nil || *offering.ActivityGroupID == 0 {
		return nil
	}
	segments, err := m.catalog.ResolveLinkedSegments(ctx, *offering.ActivityGroupID, phase)
	if err != nil {
		return fmt.Errorf("decision: validate linked activity group for care offering %d: %w", link.CareOfferingID, err)
	}
	isTemplate := len(segments) > 0 && segments[0].Group.IsTemplate
	if isTemplate && len(offering.AvailableDays) == 0 && len(link.SelectedDays) == 0 {
		return fmt.Errorf("decision: care offering %d links to a timetable template but has no selected or available days", link.CareOfferingID)
	}
	days, err := effectiveOfferingDaysForEnrollment(offering, link)
	if err != nil {
		return fmt.Errorf("decision: resolve selected days for care offering %d: %w", link.CareOfferingID, err)
	}
	if err := m.catalog.ValidateMaterializable(ctx, segments, phase, days); err != nil {
		return fmt.Errorf("decision: care offering %d is not materializable: %w", link.CareOfferingID, err)
	}
	return addLegacySegmentDrafts(drafts, segments, days, link)
}

// addLegacySegmentDrafts drafts the legacy link's days on every segment of
// its series, phase-wide on every overlapping segment (pre-#2137 behavior),
// ending with the link (#7908). Each link keeps a draft of its own until
// legacyLinkRows cuts the rows: links that end on different days cannot
// share one row.
func addLegacySegmentDrafts(drafts map[int64][]*careEnrollmentDraft, segments []careplan.LinkedSegment, days []string, link *careplan.BookedOffering) error {
	for _, segment := range segments {
		groupID := segment.Group.ID
		own := make(map[int64]*careEnrollmentDraft, 1)
		if err := mergeCareEnrollmentDraft(own, segment, days, link.CareOfferingID); err != nil {
			return err
		}
		draft := own[groupID]
		if others := drafts[groupID]; len(others) > 0 && !sameOptionalInt64(others[0].calendarPeriodID, draft.calendarPeriodID) {
			return fmt.Errorf("decision: care offering %d resolves to conflicting calendar_period_id", link.CareOfferingID)
		}
		draft.validUntil = cloneOptionalDate(link.ValidUntil)
		drafts[groupID] = append(drafts[groupID], draft)
	}
	return nil
}

// rows cuts the plan into the roster rows to write, per activity group.
//
// The legacy links of a group share rows as far as they run together and
// split where one of them ends (legacyLinkRows). The sourced draft of a
// template without legacy rows is its one row, as before. Beside legacy rows
// it contributes what they do not plan already: other weekdays, and the days
// after a legacy link ended. The legacy rows are never merged with it, and
// the remainder is cut exactly as the roster resync cuts it
// (subtractTargetCoverage), so the resync finds the legacy rows protected
// and the source rows servable, and leaves both alone (#7908). Before, the
// legacy row replaced the sourced draft, and a child whose direct link
// ended early would have dropped off a roster its source still booked.
func (p careDraftPlan) rows(phase careplan.OfferingPhase) map[int64][]*careEnrollmentDraft {
	rows := make(map[int64][]*careEnrollmentDraft, len(p.legacy)+len(p.sourced))
	for groupID, links := range p.legacy {
		if cut := legacyLinkRows(links, phase); len(cut) > 0 {
			rows[groupID] = cut
		}
	}
	for groupID, draft := range p.sourced {
		legacy := rows[groupID]
		if len(legacy) == 0 {
			rows[groupID] = []*careEnrollmentDraft{draft}
			continue
		}
		rows[groupID] = append(legacy, sourcedRowsBesideLegacy(draft, legacy, phase)...)
	}
	return rows
}

// legacyLinkRows cuts the legacy links of one activity group into rows: one
// per stretch between two link ends, carrying the weekdays of the links
// that still run there. Links that end together, or all run to the end of
// the phase, share the one phase-wide row the feed has always written; a
// link that ends earlier ends its weekdays with it. A link that ended before
// the phase began plans nothing.
func legacyLinkRows(links []*careEnrollmentDraft, phase careplan.OfferingPhase) []*careEnrollmentDraft {
	ends := make([]calendar.Date, 0, len(links))
	for _, link := range links {
		if end := careDraftValidUntil(link, phase); end.After(phase.ServiceStart) && !slices.Contains(ends, end) {
			ends = append(ends, end)
		}
	}
	slices.SortFunc(ends, func(a, b calendar.Date) int { return a.Compare(b) })
	rows := make([]*careEnrollmentDraft, 0, len(ends))
	var from *calendar.Date
	for i := range ends {
		end := ends[i]
		row := legacyRowUntil(links, phase, end)
		row.validFrom = from
		if last := len(rows) - 1; last >= 0 && sameSourcedDraftDays(rows[last], row) {
			rows[last].validUntil = &end
		} else {
			rows = append(rows, row)
		}
		from = &end
	}
	return rows
}

// legacyRowUntil is the row of the stretch that ends on end: the weekdays
// of every link that runs at least that long.
func legacyRowUntil(links []*careEnrollmentDraft, phase careplan.OfferingPhase, end calendar.Date) *careEnrollmentDraft {
	row := &careEnrollmentDraft{
		activityGroupID: links[0].activityGroupID, calendarPeriodID: links[0].calendarPeriodID,
		selectedWeekday: make(map[int]bool), validUntil: &end,
	}
	for _, link := range links {
		if careDraftValidUntil(link, phase).Before(end) {
			continue
		}
		row.allWeekdays = row.allWeekdays || link.allWeekdays
		for weekday := range link.selectedWeekday {
			row.selectedWeekday[weekday] = true
		}
	}
	return row
}

// sourcedRowsBesideLegacy is what the sourced draft of a template still
// plans beside the template's legacy rows.
func sourcedRowsBesideLegacy(draft *careEnrollmentDraft, legacy []*careEnrollmentDraft, phase careplan.OfferingPhase) []*careEnrollmentDraft {
	target := careDraftTarget(draft, phase)
	if !target.validFrom.Before(target.validUntil) {
		return nil
	}
	planned := make([]*sourcedRosterTarget, 0, len(legacy))
	for _, row := range legacy {
		planned = append(planned, careDraftTarget(row, phase))
	}
	remaining := subtractTargetCoverage([]*sourcedRosterTarget{target}, coverageFromSourcedTargets(planned))
	rows := make([]*careEnrollmentDraft, 0, len(remaining))
	for _, part := range remaining {
		from, until := part.validFrom, part.validUntil
		rows = append(rows, &careEnrollmentDraft{
			activityGroupID: draft.activityGroupID, calendarPeriodID: draft.calendarPeriodID,
			selectedWeekday: part.draft.selectedWeekday, allWeekdays: part.draft.allWeekdays,
			validFrom: &from, validUntil: &until,
		})
	}
	return rows
}

// careDraftTarget is the draft with the window it plans within the phase.
func careDraftTarget(draft *careEnrollmentDraft, phase careplan.OfferingPhase) *sourcedRosterTarget {
	return &sourcedRosterTarget{draft: draft, validFrom: careDraftValidFrom(draft, phase, nil), validUntil: careDraftValidUntil(draft, phase)}
}

// sourcedDraftFeed is one booking link feeding the templates that source its
// offering.
type sourcedDraftFeed struct {
	offering    *careplan.CareOffering
	link        *careplan.BookedOffering
	phase       careplan.OfferingPhase
	gradeLevel  *int16
	schoolClass string
}

// addSourcedTemplateDrafts is the #2137 feed: every template that declares
// this offering as its roster source pulls the child in when the template's
// Jahrgang or Klassen filter matches. Misconfigured templates (no schedules, no
// resolvable period, period drifted away from the phase) are skipped with a
// warning instead of failing the approval — the editor surfaces the mismatch,
// and blocking every approval on one broken template would be worse.
//
// Templates sourcing SEVERAL offerings are not drafted here: the per-link
// draft merge cannot express the union's subtraction shape (a child linked to
// two of the template's sources would get one row mixing both links' weekdays
// under the first link's window). They are collected into multiSource and
// reconciled through ResyncTemplateOfferingRoster after the drafts persist —
// one authoritative union writer instead of two diverging ones.
func (m *BookingMaterialization) addSourcedTemplateDrafts(
	ctx context.Context,
	drafts map[int64]*careEnrollmentDraft,
	multiSource map[int64]ports.SourcedTemplate,
	feed sourcedDraftFeed,
	sources draftSources,
) error {
	templates := sources.byOffering[feed.offering.ID]
	if len(templates) == 0 {
		return nil
	}
	days, err := effectiveOfferingDaysForEnrollment(feed.offering, feed.link)
	if err != nil {
		return fmt.Errorf("decision: resolve selected days for care offering %d: %w", feed.link.CareOfferingID, err)
	}
	for _, tmpl := range templates {
		// The two filters are mutually exclusive by validation, as in the
		// resync (wantedSourcedRosterTargets).
		if !gradeFilterMatches(tmpl.SourceGradeLevels, feed.gradeLevel) || !sourceClassFilterMatches(tmpl.SourceSchoolClasses, feed.schoolClass) {
			continue
		}
		if len(tmpl.SourceCareOfferingIDs) > 1 {
			multiSource[tmpl.ID] = tmpl
			continue
		}
		segment, phase, ok := m.sourcedTemplateSegment(ctx, tmpl, feed, sources.schedules[tmpl.ID])
		if !ok {
			continue
		}
		if err := addSourcedSegmentDraft(drafts, segment, sources.schedules[tmpl.ID], feed, phase, days); err != nil {
			return err
		}
	}
	return nil
}

// sourcedTemplateSegment resolves a single-source template into the segment
// the feed drafts on and the feed's phase clipped to the template's period,
// as every resync clips it. ok is false for a template the approval skips.
func (m *BookingMaterialization) sourcedTemplateSegment(
	ctx context.Context,
	tmpl ports.SourcedTemplate,
	feed sourcedDraftFeed,
	schedules []careplan.LinkedSchedule,
) (careplan.LinkedSegment, careplan.OfferingPhase, bool) {
	if len(schedules) == 0 || !careplan.SchedulesOverlapPhase(schedules, feed.phase) {
		m.logSkippedSourcedTemplate(tmpl.ID, []int64{feed.offering.ID}, "no schedule overlaps the enrollment phase", nil)
		return careplan.LinkedSegment{}, careplan.OfferingPhase{}, false
	}
	group := careplan.LinkedGroup{ID: tmpl.ID, IsTemplate: true, CalendarPeriodID: tmpl.CalendarPeriodID}
	// The phase is checked against the template's own period and the rows
	// carry the period the instances materialize under (sourcedRowPeriodID),
	// both exactly as every resync does. A template whose schedules name no
	// period or different periods must not be skipped here, or a correction
	// deletes rows it never re-creates (#5114, #5153, #5176).
	checked, err := m.catalog.offeringSourcePeriod(ctx, group.CalendarPeriodID)
	if err != nil {
		m.logSkippedSourcedTemplate(tmpl.ID, []int64{feed.offering.ID}, "calendar period not resolvable", err)
		return careplan.LinkedSegment{}, careplan.OfferingPhase{}, false
	}
	phase, err := careplan.ClipPhaseToPeriod(feed.phase, checked)
	if err != nil {
		m.logSkippedSourcedTemplate(tmpl.ID, []int64{feed.offering.ID}, "phase does not overlap template period", err)
		return careplan.LinkedSegment{}, careplan.OfferingPhase{}, false
	}
	period := checked
	if rowPeriodID := sourcedRowPeriodID(group.CalendarPeriodID, schedules); !sameOptionalInt64(rowPeriodID, group.CalendarPeriodID) {
		if period, err = m.catalog.offeringSourcePeriod(ctx, rowPeriodID); err != nil {
			m.logSkippedSourcedTemplate(tmpl.ID, []int64{feed.offering.ID}, "calendar period not resolvable", err)
			return careplan.LinkedSegment{}, careplan.OfferingPhase{}, false
		}
	}
	return careplan.LinkedSegment{Group: group, Period: period, Schedules: schedules}, phase, true
}

func addSourcedSegmentDraft(
	drafts map[int64]*careEnrollmentDraft,
	segment careplan.LinkedSegment,
	schedules []careplan.LinkedSchedule,
	feed sourcedDraftFeed,
	phase careplan.OfferingPhase,
	days []string,
) error {
	templateID := segment.Group.ID
	_, existed := drafts[templateID]
	if err := mergeCareEnrollmentDraft(drafts, segment, days, feed.link.CareOfferingID); err != nil {
		return err
	}
	if existed {
		return nil
	}
	// Every segment of a split series sources the offering, so the drafted
	// rows must stop at each segment's schedule envelope — otherwise an
	// approval after a split plans the capped predecessor for dates after it
	// ended (#2147 review). The child's offering-link window bounds the rows
	// the same way: a link ending mid-phase must not plan the child after
	// leaving the offering.
	draft := drafts[templateID]
	envelopeFrom, envelopeUntil := scheduleValidityBounds(schedules)
	from, until := clipBoundsToPhase(envelopeFrom, envelopeUntil, phase)
	if feed.link.ValidFrom != nil && feed.link.ValidFrom.After(*from) {
		from = cloneOptionalDate(feed.link.ValidFrom)
	}
	if feed.link.ValidUntil != nil && feed.link.ValidUntil.Before(*until) {
		until = cloneOptionalDate(feed.link.ValidUntil)
	}
	draft.validFrom, draft.validUntil = from, until
	return nil
}

func mergeCareEnrollmentDraft(
	drafts map[int64]*careEnrollmentDraft,
	segment careplan.LinkedSegment,
	days []string,
	offeringID int64,
) error {
	var periodID *int64
	if segment.Period != nil {
		periodID = &segment.Period.ID
	}
	draft := drafts[segment.Group.ID]
	if draft != nil && !sameOptionalInt64(draft.calendarPeriodID, periodID) {
		return fmt.Errorf("decision: care offering %d resolves to conflicting calendar_period_id", offeringID)
	}
	if draft == nil {
		draft = &careEnrollmentDraft{
			activityGroupID:  segment.Group.ID,
			calendarPeriodID: periodID,
			selectedWeekday:  make(map[int]bool),
		}
		drafts[segment.Group.ID] = draft
	}
	if !segment.Group.IsTemplate || len(days) == 0 {
		draft.allWeekdays = true
		return nil
	}
	if draft.allWeekdays {
		return nil
	}
	for _, day := range days {
		weekday, ok := offeringDayWeekday(day)
		if !ok {
			return fmt.Errorf("decision: invalid selected day %q for care offering %d", day, offeringID)
		}
		draft.selectedWeekday[weekday] = true
	}
	return nil
}

func sameOptionalInt64(left, right *int64) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func effectiveOfferingDaysForEnrollment(offering *careplan.CareOffering, link *careplan.BookedOffering) ([]string, error) {
	if len(link.SelectedDays) > 0 {
		return link.SelectedDays, nil
	}
	switch offering.DaysOfWeekMode {
	case daysOfWeekModeFixed:
		return offering.AvailableDays, nil
	case daysOfWeekModeParentChoice:
		return nil, fmt.Errorf("parent-choice offering has no selected_days")
	default:
		return nil, fmt.Errorf("unknown days_of_week_mode %q", offering.DaysOfWeekMode)
	}
}

func sortedWeekdaySet(days map[int]bool) []int {
	out := make([]int, 0, len(days))
	for day := 1; day <= 7; day++ {
		if days[day] {
			out = append(out, day)
		}
	}
	return out
}

// scheduleValidityBounds returns the union recurrence envelope of a template's
// schedule rows. A side is nil (open) when any row is open on that side;
// otherwise the widest bound wins. Segment rows share one envelope per the
// split-series invariant — the union keeps drifted rows honest instead of
// trusting an arbitrary one.
func scheduleValidityBounds(schedules []careplan.LinkedSchedule) (validFrom, validUntil *calendar.Date) {
	fromOpen, untilOpen := false, false
	for _, sch := range schedules {
		switch {
		case sch.ValidFrom == nil:
			fromOpen, validFrom = true, nil
		case !fromOpen && (validFrom == nil || sch.ValidFrom.Before(*validFrom)):
			validFrom = cloneOptionalDate(sch.ValidFrom)
		}
		switch {
		case sch.ValidUntil == nil:
			untilOpen, validUntil = true, nil
		case !untilOpen && (validUntil == nil || sch.ValidUntil.After(*validUntil)):
			validUntil = cloneOptionalDate(sch.ValidUntil)
		}
	}
	return validFrom, validUntil
}

// gradeFilterMatches reports whether a child with the given grade level (nil
// = not derivable from the school class) passes a template's Jahrgang
// filter. An empty filter admits every child; a set filter never admits a
// child without grade data.
func gradeFilterMatches(levels []int, grade *int16) bool {
	if len(levels) == 0 {
		return true
	}
	if grade == nil {
		return false
	}
	for _, level := range levels {
		if level == int(*grade) {
			return true
		}
	}
	return false
}

// sourceClassFilterMatches reports whether a child's school class passes a
// template's Klassenfilter (#2482). An empty filter admits every child; a set
// filter matches case- and whitespace-insensitively and never admits a child
// without a class — silently planning a child with no class data into a
// Klassen-Termin would hide data problems, the same rule the Jahrgang filter
// applies to a missing grade.
func sourceClassFilterMatches(classes []string, schoolClass string) bool {
	if len(classes) == 0 {
		return true
	}
	wanted := strings.ToLower(strings.TrimSpace(schoolClass))
	if wanted == "" {
		return false
	}
	for _, class := range classes {
		if strings.ToLower(strings.TrimSpace(class)) == wanted {
			return true
		}
	}
	return false
}

// clipBoundsToPhase narrows a segment's schedule envelope (from inclusive,
// until exclusive, nil open) to the phase window clipped to the template's
// period, so an approval row stops where the period does, as a resync row
// does.
func clipBoundsToPhase(from, until *calendar.Date, phase careplan.OfferingPhase) (*calendar.Date, *calendar.Date) {
	start, end := phase.ServiceStart, phase.ServiceEnd.AddDays(1)
	if from == nil || from.Before(start) {
		from = &start
	}
	if until == nil || until.After(end) {
		until = &end
	}
	return from, until
}
