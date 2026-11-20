package daychangesview

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Section is the part of the overview an entry belongs to: what concerns
// the caller ("Betrifft dich") or the rest of the school.
type Section string

const (
	SectionYou    Section = "you"
	SectionSchool Section = "school"
)

// Source names one owner read of the overview. Every source has its own
// status; a sister ticket adds its constant, its port and its line in
// Dependencies.sources.
type Source string

const (
	// SourceStaff is Personal: full-day absences, group substitutions and
	// the changed or cancelled shifts of the Dienstplan (#7661).
	SourceStaff Source = "staff"
)

// SourceState says whether a source answered. A source the caller lacks the
// permission for answers with no entries and stays loaded.
type SourceState string

const (
	SourceLoaded SourceState = "loaded"
	SourceFailed SourceState = "failed"
)

// Kind is the type of a change to regular operation. The frontend builds the
// German text from it.
type Kind string

const (
	// KindStaffAbsent: a staff member is not there today. Never a reason.
	KindStaffAbsent Kind = "staff_absent"
	// KindStaffAbsentCount: how many further colleagues are not there, for a
	// caller who may see the number but not the names.
	KindStaffAbsentCount Kind = "staff_absent_count"
	// KindGroupSubstitution: somebody covers a whole group today.
	KindGroupSubstitution Kind = "group_substitution"
	// KindGroupSubstitutionCount: how many further groups are covered today.
	KindGroupSubstitutionCount Kind = "group_substitution_count"
	// KindShiftChanged: a shift of a series runs differently today (other
	// time or day). Never a reason.
	KindShiftChanged Kind = "shift_changed"
	// KindShiftCancelled: a shift does not take place today. A shift the
	// plan cancelled for an absence is not one: the absence is the entry.
	KindShiftCancelled Kind = "shift_cancelled"
	// KindShiftReplacement: somebody covers (part of) a cancelled shift.
	KindShiftReplacement Kind = "shift_replacement"
)

// PersonRole is what a person has to do with an entry.
type PersonRole string

const (
	RoleAbsent     PersonRole = "absent"
	RoleSubstitute PersonRole = "substitute"
	RoleReplaced   PersonRole = "replaced"
	// RoleOnDuty is the staff member whose shift changed or is cancelled.
	RoleOnDuty PersonRole = "on_duty"
)

// LinkTarget names the page an entry leads to; the frontend builds the path.
type LinkTarget string

const (
	// LinkStaffAbsences is the absence tab of a staff member's detail page.
	LinkStaffAbsences LinkTarget = "staff_absences"
	// LinkStaffMember is a staff member's detail page.
	LinkStaffMember LinkTarget = "staff_member"
	// LinkOwnAbsences is the caller's own time tracking with the absences.
	LinkOwnAbsences LinkTarget = "own_absences"
	// LinkStaffList is the list of all staff.
	LinkStaffList LinkTarget = "staff_list"
	// LinkGroupHandovers is the page of the group substitutions.
	LinkGroupHandovers LinkTarget = "group_handovers"
	// LinkOwnShiftPlan is the caller's own Dienstplan.
	LinkOwnShiftPlan LinkTarget = "own_shift_plan"
	// LinkShiftPlan is a staff member's week in the Dienstplan.
	LinkShiftPlan LinkTarget = "shift_plan"
)

// Person is somebody an entry names. The ID is the staff record.
type Person struct {
	StaffID int64      `json:"staff_id,string"`
	Name    string     `json:"name"`
	Role    PersonRole `json:"role"`
	// IsSelf marks the caller, so the frontend can say "du".
	IsSelf bool `json:"is_self"`
}

// Group is the group an entry concerns.
type Group struct {
	ID   int64  `json:"id,string"`
	Name string `json:"name"`
}

// Link is the target of an entry; StaffID is set for the staff pages.
type Link struct {
	Target  LinkTarget `json:"target"`
	StaffID *int64     `json:"staff_id,string,omitempty"`
}

// SourceEntry is what a source port returns: an entry without its section,
// and whether the caller is involved. The source has applied its own
// permission rule already; the projection never filters.
type SourceEntry struct {
	Kind Kind
	// Involved puts the entry under "Betrifft dich".
	Involved bool
	// HalfDay marks an absence that covers only half of today.
	HalfDay bool
	// Since is the first day of a change that began before the day; Until
	// the last day of one that lasts beyond it. Nil otherwise.
	Since *calendar.Date
	Until *calendar.Date
	// StartsAt and EndsAt are the instants of a change with a time of day;
	// both nil for a full-day change. A source sets EndsAt only together
	// with StartsAt.
	StartsAt *time.Time
	EndsAt   *time.Time
	People   []Person
	Group    *Group
	Link     *Link
	// Count is set on the summary kinds only.
	Count *int
}

// Entry is one change to regular operation of the day.
type Entry struct {
	Kind    Kind    `json:"kind"`
	Section Section `json:"section"`
	// AllDay is true for changes without a time of day (StartsAt nil).
	AllDay  bool           `json:"all_day"`
	HalfDay bool           `json:"half_day"`
	Since   *calendar.Date `json:"since"`
	Until   *calendar.Date `json:"until"`
	// StartsAt and EndsAt are instants; the frontend shows the school's wall
	// clock (a shift's time, #7661).
	StartsAt *time.Time `json:"starts_at"`
	EndsAt   *time.Time `json:"ends_at"`
	People   []Person   `json:"people"`
	Group    *Group     `json:"group"`
	Link     *Link      `json:"link"`
	Count    *int       `json:"count"`
}

// SourceStatus reports one source.
type SourceStatus struct {
	Source Source      `json:"source"`
	Status SourceState `json:"status"`
}

// Overview is the answer: the day, the status of every source and the
// entries, sorted.
type Overview struct {
	Date    calendar.Date  `json:"date"`
	Sources []SourceStatus `json:"sources"`
	Entries []Entry        `json:"entries"`
}

// StaffChanges is the Personal port: full-day absences, group substitutions
// and changed or cancelled shifts of the day as the caller may see them. It never carries a
// reason for an absence; the port has no field for one.
type StaffChanges interface {
	StaffChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// Isolation runs one source read so that its failure leaves the request's
// transaction usable (a savepoint). It returns the source's own error
// unchanged and reports a failure of the isolation itself as fatal.
type Isolation interface {
	Run(ctx context.Context, read func(context.Context) error) error
	// IsFatal reports an error of the isolation itself: the state of the
	// transaction is unknown, and the request must fail.
	IsFatal(err error) bool
}

// Dependencies are the ports the root binds. Today, Isolation and every
// source are required; Logger is optional. The root binds Isolation to a
// savepoint of the request's school transaction (ADR 0299 point 7).
type Dependencies struct {
	Today     func() calendar.Date
	Isolation Isolation
	Staff     StaffChanges
	Logger    *slog.Logger
}

// Query reads the overview of the session's school.
type Query interface {
	Today(ctx context.Context) (Overview, error)
}

// ErrDependencies reports missing wiring.
var ErrDependencies = errors.New("day changes view: missing dependency")

type sourceRead struct {
	source Source
	read   func(context.Context, calendar.Date) ([]SourceEntry, error)
}

type view struct {
	today     func() calendar.Date
	isolation Isolation
	sources   []sourceRead
	logger    *slog.Logger
}

// New builds the projection.
func New(deps Dependencies) (Query, error) {
	if deps.Today == nil || deps.Isolation == nil || deps.Staff == nil {
		return nil, ErrDependencies
	}
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &view{
		today:     deps.Today,
		isolation: deps.Isolation,
		logger:    logger,
		// The order is the order of the statuses in the answer.
		sources: []sourceRead{
			{source: SourceStaff, read: deps.Staff.StaffChanges},
		},
	}, nil
}

// Today reads every source separately. A failed source leaves its entries
// out and is marked failed; only a failure of the isolation itself fails the
// request.
func (v *view) Today(ctx context.Context) (Overview, error) {
	day := v.today()
	overview := Overview{Date: day, Sources: make([]SourceStatus, 0, len(v.sources)), Entries: []Entry{}}
	for _, source := range v.sources {
		var entries []SourceEntry
		err := v.isolation.Run(ctx, func(ctx context.Context) error {
			var readErr error
			entries, readErr = source.read(ctx, day)
			return readErr
		})
		if err != nil {
			if v.isolation.IsFatal(err) {
				return Overview{}, fmt.Errorf("day changes source %s: %w", source.source, err)
			}
			// The source and the error; source reads name no person in their errors.
			v.logger.ErrorContext(ctx, "day changes source failed",
				"source", string(source.source),
				"error", err.Error(),
			)
			overview.Sources = append(overview.Sources, SourceStatus{Source: source.source, Status: SourceFailed})
			continue
		}
		overview.Sources = append(overview.Sources, SourceStatus{Source: source.source, Status: SourceLoaded})
		for _, entry := range entries {
			overview.Entries = append(overview.Entries, toEntry(entry))
		}
	}
	sortEntries(overview.Entries)
	return overview, nil
}

func toEntry(entry SourceEntry) Entry {
	section := SectionSchool
	if entry.Involved {
		section = SectionYou
	}
	people := entry.People
	if people == nil {
		people = []Person{}
	}
	return Entry{
		Kind: entry.Kind, Section: section, AllDay: entry.StartsAt == nil, HalfDay: entry.HalfDay,
		Since: entry.Since, Until: entry.Until, StartsAt: entry.StartsAt, EndsAt: entry.EndsAt,
		People: people, Group: entry.Group, Link: entry.Link, Count: entry.Count,
	}
}

// sortEntries puts "Betrifft dich" before "Schule". Inside a section, new
// changes stand first, the long ones that began before today follow
// compactly, and the summaries close the section. Ties sort by kind, first
// name and group, so the order is stable.
func sortEntries(entries []Entry) {
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.Section != b.Section {
			return a.Section == SectionYou
		}
		if ra, rb := rank(a), rank(b); ra != rb {
			return ra < rb
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if na, nb := firstName(a), firstName(b); na != nb {
			return na < nb
		}
		return groupName(a) < groupName(b)
	})
}

func rank(entry Entry) int {
	switch {
	case entry.Count != nil:
		return 2
	case entry.Since != nil:
		return 1
	default:
		return 0
	}
}

func firstName(entry Entry) string {
	if len(entry.People) == 0 {
		return ""
	}
	return entry.People[0].Name
}

func groupName(entry Entry) string {
	if entry.Group == nil {
		return ""
	}
	return entry.Group.Name
}
