package daychangesview

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
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
	// SourceChildren is Kinder: sick or excused children, changed pickup
	// times, children who go home alone and dated pickup notes (#7665).
	SourceChildren Source = "children"
	// SourceNotices is Hinweise der Leitung: the notices that apply today.
	SourceNotices Source = "notices"
	// SourceClosingDays is Schule: the closing days of the school and of its
	// current Träger (#7664) and the opening changes of the school (#8170).
	SourceClosingDays Source = "closing_days"
	// SourceActivities is Stundenplan: cancelled, reinstated, moved and
	// covered activity blocks (#7662).
	SourceActivities Source = "activities"
	// SourceClasses is Stundenplan der Klassen: a class whose
	// Unterrichtsschluss changes today (#7681).
	SourceClasses Source = "classes"
	// SourceAppointments is Termine im Kalender: today's exceptions of the
	// caller's calendar appointments (#7663).
	SourceAppointments Source = "appointments"
	// SourceMealPlan is Essen: whether today's menu changed (#7666).
	SourceMealPlan Source = "meal_plan"
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
	// KindBlockStaffAbsent: a staff member misses one block of the day
	// (terminbezogene Abwesenheit, #7675) and nobody covers. Never a reason.
	KindBlockStaffAbsent Kind = "block_staff_absent"
	// KindBlockSubstitution: somebody covers one block of the day
	// (Terminvertretung, #7675), for the absent supervisors it names.
	KindBlockSubstitution Kind = "block_substitution"
	// KindBlockChangeCount: on how many further blocks somebody is absent or
	// covers, for a caller who may see the number but not the names.
	KindBlockChangeCount Kind = "block_change_count"
	// KindChildAbsent: a child is reported sick or excused today; Child
	// carries the status, never a reason.
	KindChildAbsent Kind = "child_absent"
	// KindChildPickupChanged: a child leaves at another time today, or does
	// not come (no pickup time).
	KindChildPickupChanged Kind = "child_pickup_changed"
	// KindChildGoesAlone: a child goes home alone today.
	KindChildGoesAlone Kind = "child_goes_alone"
	// KindChildPickupNote: a pickup note for today ("Oma holt ab").
	KindChildPickupNote Kind = "child_pickup_note"
	// KindChildPickupPerson: someone else collects a child today (#7655);
	// Child.PickupPerson names the person.
	KindChildPickupPerson Kind = "child_pickup_person"
	// KindChildSummary: the children of one group or class outside the
	// caller's groups, with the numbers and the rows to unfold.
	KindChildSummary Kind = "child_summary"
	// KindStaffNotice: a Hinweis der Leitung applies today.
	KindStaffNotice Kind = "staff_notice"
	// KindClosingDay: the school is closed today, by its own closing day or
	// one of its Träger (#7664).
	KindClosingDay Kind = "closing_day"
	// KindOpeningChanged: the school opens or closes at another time today,
	// by an opening change of the school (#8170). Opening carries the name
	// and the times; from the Schule source like the closing days.
	KindOpeningChanged Kind = "opening_changed"
	// KindActivityCancelled: an activity block does not take place today.
	KindActivityCancelled Kind = "activity_cancelled"
	// KindActivityReinstated: its cancellation was taken back.
	KindActivityReinstated Kind = "activity_reinstated"
	// KindActivityRoomChanged: it lies in another room than its series plans.
	KindActivityRoomChanged Kind = "activity_room_changed"
	// KindActivityLeadChanged: somebody covers for a planned supervisor.
	KindActivityLeadChanged Kind = "activity_lead_changed"
	// KindClassTrip: children of a class are on a trip today (#7681), from
	// the Kinder source. Class.Time is the return time of a day outing, nil
	// for a trip over the whole day. Never a child's name or a reason.
	KindClassTrip Kind = "class_trip"
	// KindClassDismissalChanged: a class ends school at another time today
	// (#7681); Class.Time is the new Unterrichtsschluss. Never a reason.
	KindClassDismissalChanged Kind = "class_dismissal_changed"
	// KindAppointmentCancelled: a calendar appointment of the caller does not
	// take place today, as a single date of a series or as a whole (#7663).
	KindAppointmentCancelled Kind = "appointment_cancelled"
	// KindAppointmentChanged: today's date of a calendar appointment of the
	// caller takes place at another location or another time (#7663).
	KindAppointmentChanged Kind = "appointment_changed"
	// KindMealPlanChanged: today's menu changed after it was published
	// (#7666). Never the dishes; the meal plan page shows them.
	KindMealPlanChanged Kind = "meal_plan_changed"
	// KindMealCancelled: lunch does not take place today although the school
	// is open (#7656); MealCancellation carries the school's reason.
	KindMealCancelled Kind = "meal_cancelled"
)

// ChildStatus is the status of an absent child, as on the detail page.
type ChildStatus string

const (
	ChildSick    ChildStatus = "sick"
	ChildExcused ChildStatus = "excused"
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
	// LinkStudent is a child's detail page.
	LinkStudent LinkTarget = "student"
	// LinkStaffNotices is the page of the Hinweise der Leitung.
	LinkStaffNotices LinkTarget = "staff_notices"
	// LinkCalendarPeriods is the page of the school year with the closing
	// days.
	LinkCalendarPeriods LinkTarget = "calendar_periods"
	// LinkDayPlan is the day plan of today, where the blocks stand.
	LinkDayPlan LinkTarget = "day_plan"
	// LinkSubstitutionPlan is the Vertretungsplan of the day with the block
	// (Link.InstanceID) open (#7675).
	LinkSubstitutionPlan LinkTarget = "substitution_plan"
	// LinkCalendar is the caller's own calendar ("Mein Kalender", #7663).
	LinkCalendar LinkTarget = "calendar"
	// LinkMealPlan is the meal plan page of the week.
	LinkMealPlan LinkTarget = "meal_plan"
)

// Person is somebody an entry names. The ID is the staff record.
type Person struct {
	StaffID ident.ID   `json:"staff_id"`
	Name    string     `json:"name"`
	Role    PersonRole `json:"role"`
	// IsSelf marks the caller, so the frontend can say "du".
	IsSelf bool `json:"is_self"`
}

// Group is the group an entry concerns.
type Group struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// Link is the target of an entry; StaffID is set for the staff pages,
// StudentID for a child's page, InstanceID for the block of the
// Vertretungsplan.
type Link struct {
	Target     LinkTarget `json:"target"`
	StaffID    *ident.ID  `json:"staff_id,omitempty"`
	StudentID  *ident.ID  `json:"student_id,omitempty"`
	InstanceID *ident.ID  `json:"instance_id,omitempty"`
	// RoomID is set for the room's page (#8161).
	RoomID *ident.ID `json:"room_id,omitempty"`
}

// Child is the child an entry concerns, with what is different today:
// Status for child_absent, PickupTime ("15:04"; nil: the child does not
// come) for child_pickup_changed, Note for child_pickup_note, PickupPerson
// for child_pickup_person.
type Child struct {
	StudentID  ident.ID     `json:"student_id"`
	FirstName  string       `json:"first_name"`
	LastName   string       `json:"last_name"`
	Status     *ChildStatus `json:"status"`
	PickupTime *string      `json:"pickup_time"`
	Note       *string      `json:"note"`
	// AfterClosing marks a pickup time after today's changed closing time
	// (#8170): the pickup stays as entered, the child's day of the parents
	// shows the conflict. Not on the staff wire yet: its sources read no
	// opening change (follow-up of #8170).
	AfterClosing bool `json:"-"`
	// PickupPerson is who collects the child today (#7655).
	PickupPerson *ChildPickupPerson `json:"pickup_person"`
}

// ChildPickupPerson is who collects a child on the day. OneTime marks a
// person without a standing pickup permission: the staff check the ID card.
type ChildPickupPerson struct {
	Name    string `json:"name"`
	OneTime bool   `json:"one_time"`
	// PermissionWithdrawn: the contact's pickup permission no longer holds
	// on the day (#8206); the name is no valid pickup person.
	PermissionWithdrawn bool `json:"permission_withdrawn,omitempty"`
}

// ChildItem is one row of a child summary.
type ChildItem struct {
	Kind  Kind  `json:"kind"`
	Child Child `json:"child"`
	Link  *Link `json:"link"`
}

// ChildCounts are the numbers of a child summary, one per kind.
type ChildCounts struct {
	Sick          int `json:"sick"`
	Excused       int `json:"excused"`
	PickupChanged int `json:"pickup_changed"`
	GoesAlone     int `json:"goes_alone"`
	PickupNote    int `json:"pickup_note"`
	PickupPerson  int `json:"pickup_person"`
}

// ChildSummary sums up the children of one group (Entry.Group) or, for
// children without a group, of one school class.
type ChildSummary struct {
	SchoolClass string      `json:"school_class"`
	Counts      ChildCounts `json:"counts"`
	Items       []ChildItem `json:"items"`
}

// NoticePriority is how important a Hinweis der Leitung is.
type NoticePriority string

const (
	NoticeInfo      NoticePriority = "info"
	NoticeImportant NoticePriority = "important"
)

// DayNotice is a Hinweis der Leitung. Title and body are the leadership's own
// text. Acknowledged is the caller's own acknowledgement; the caller confirms
// through the notices' existing write path, never through this read.
type DayNotice struct {
	ID                      ident.ID       `json:"id"`
	Title                   string         `json:"title"`
	Body                    string         `json:"body"`
	Priority                NoticePriority `json:"priority"`
	RequiresAcknowledgement bool           `json:"requires_acknowledgement"`
	Acknowledged            bool           `json:"acknowledged"`
}

// DayClosing is a closing day of the day. Name is the school's or the
// Träger's own name for it ("Pädagogischer Tag"); Traeger marks one the
// Träger planned.
type DayClosing struct {
	Name    string `json:"name"`
	Traeger bool   `json:"traeger"`
}

// DayClass is the school class an entry concerns (#7681). Name is the class
// as the school entered it; Time ("15:04", the school's wall clock) is the
// return time of a day outing or the changed Unterrichtsschluss; Children
// is the number of children on a class trip.
type DayClass struct {
	Name     string  `json:"name"`
	Time     *string `json:"time"`
	Children int     `json:"children"`
}

// DayMealCancellation is today's cancelled lunch (#7656). Reason is the
// school's own text ("Der Caterer liefert nicht").
type DayMealCancellation struct {
	Reason string `json:"reason"`
}

// BlockRoom is the room an entry names.
type BlockRoom struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// BlockActivity is the activity block an entry concerns; its time of day
// travels in StartsAt and EndsAt.
type BlockActivity struct {
	ID    ident.ID `json:"id"`
	Title string   `json:"title"`
}

// DayAppointment is today's date of a calendar appointment of the caller
// (#7663). Title and Location are the organizer's own text, as the date
// takes place today. The new time travels in the entry's StartsAt and
// EndsAt.
type DayAppointment struct {
	ID              ident.ID      `json:"id"`
	OccurrenceDate  calendar.Date `json:"occurrence_date"`
	Title           string        `json:"title"`
	Location        *string       `json:"location"`
	LocationChanged bool          `json:"location_changed"`
	TimeChanged     bool          `json:"time_changed"`
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
	// Child is set on the child kinds, ChildSummary on child_summary.
	Child        *Child
	ChildSummary *ChildSummary
	// Notice is set on KindStaffNotice only.
	Notice *DayNotice
	// Closing is set on KindClosingDay only.
	Closing *DayClosing
	// Opening is set on KindOpeningChanged only (#8170).
	Opening *DayOpening
	// Activity is set on the activity kinds (#7662) and on the block kinds of
	// the Personal source (#7675). Room is where the block
	// takes place, PreviousRoom where its series plans it when it moved.
	Activity     *BlockActivity
	Room         *BlockRoom
	PreviousRoom *BlockRoom
	// Class is set on the class kinds (#7681).
	Class *DayClass
	// Appointment is set on the appointment kinds only (#7663).
	Appointment *DayAppointment
	// MealCancellation is set on KindMealCancelled only (#7656).
	MealCancellation *DayMealCancellation
	// RoomClosure is set on KindRoomClosed only (#8161); Room names the room.
	RoomClosure *DayRoomClosure
	// EnteredByYou marks a change the reading guardian entered itself, in
	// the child's day of the parents portal (#7671).
	EnteredByYou bool
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
	// clock (a shift's time, #7661) and folds a change whose end has passed into
	// "erledigt" (#7660).
	StartsAt *time.Time  `json:"starts_at"`
	EndsAt   *time.Time  `json:"ends_at"`
	People   []Person    `json:"people"`
	Group    *Group      `json:"group"`
	Link     *Link       `json:"link"`
	Count    *int        `json:"count"`
	Notice   *DayNotice  `json:"notice"`
	Closing  *DayClosing `json:"closing"`
	// Opening: see SourceEntry. Only the child's day of the parents reads
	// opening changes so far (#8170); the staff wire does not carry it.
	Opening *DayOpening `json:"-"`
	// Child is set on the child kinds, ChildSummary on child_summary.
	Child        *Child        `json:"child"`
	ChildSummary *ChildSummary `json:"child_summary"`
	// Activity, Room and PreviousRoom: see SourceEntry.
	Activity     *BlockActivity `json:"activity"`
	Room         *BlockRoom     `json:"room"`
	PreviousRoom *BlockRoom     `json:"previous_room"`
	// Class: see SourceEntry.
	Class *DayClass `json:"class"`
	// Appointment is set on the appointment kinds only (#7663).
	Appointment *DayAppointment `json:"appointment"`
	// MealCancellation is set on KindMealCancelled only (#7656).
	MealCancellation *DayMealCancellation `json:"meal_cancellation"`
	// RoomClosure is set on KindRoomClosed only (#8161).
	RoomClosure *DayRoomClosure `json:"room_closure"`
	// EnteredByYou: see SourceEntry. Never set in the staff overview.
	EnteredByYou bool `json:"-"`
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

// StaffChanges is the Personal port: full-day absences, group substitutions,
// changed or cancelled shifts and the absences and covers of single blocks
// (#7675) of the day as the caller may see them. It never carries a
// reason for an absence; the port has no field for one.
type StaffChanges interface {
	StaffChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// ChildChanges is the Kinder port: the children with something different
// today as the caller may see them. A caller who may not see the status of
// a child gets none, without a statement.
type ChildChanges interface {
	ChildChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// ActivityChanges is the Stundenplan port: the activity blocks of the day
// that do not run as planned, as the caller may see them on the day plan.
// It carries no reason for a cancellation or an absence.
type ActivityChanges interface {
	ActivityChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// StaffNotices is the Hinweise der Leitung port: the notices that apply on
// the day for the caller, with the caller's own acknowledgement. A caller who
// may not read the notices gets none.
type StaffNotices interface {
	StaffNotices(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// ClosingDays is the Schule port for the closing days: those of the school
// and of its current Träger that cover the day, as the caller may see them.
type ClosingDays interface {
	ClosingDays(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// ClassChanges is the port of the Stundenplan der Klassen (#7681): the
// classes whose Unterrichtsschluss changes on the day, as the caller may see
// them, and whether the caller belongs to the staff of the class.
type ClassChanges interface {
	ClassChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// AppointmentChanges is the Termine port (#7663): today's cancelled and
// changed dates of the calendar appointments the caller may see in the own
// calendar. A caller without the calendar gets none.
type AppointmentChanges interface {
	AppointmentChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// MealPlanChanges is the Essen port: whether the menu of the day changed
// (#7666) or lunch is cancelled (#7656), for every staff account of the
// school. It carries no dish.
type MealPlanChanges interface {
	MealPlanChanges(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}

// Isolation runs source reads so that a failure leaves the request's
// transaction usable (a savepoint). It returns the source's own error
// unchanged and reports a failure of the isolation itself as fatal.
// Consecutive sources share one isolation, so a source must only read: a
// later source's failure rolls back everything since the isolation began.
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
	Children  ChildChanges
	Notices   StaffNotices
	Closing   ClosingDays
	// Activities is the Stundenplan source (#7662).
	Activities ActivityChanges
	// Classes is the Stundenplan der Klassen (#7681).
	Classes ClassChanges
	// Appointments is the Termine source (#7663).
	Appointments AppointmentChanges
	// MealPlan is the Essen source (#7666).
	MealPlan MealPlanChanges
	// RoomClosures is the Räume source (#8161).
	RoomClosures RoomClosures
	Logger       *slog.Logger
}

// Query reads the overview of the session's school: today, or on a day
// that must be today or tomorrow of the school (#7657, day.go).
type Query interface {
	Today(ctx context.Context) (Overview, error)
	On(ctx context.Context, day calendar.Date) (Overview, error)
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
	if deps.Today == nil || deps.Isolation == nil || deps.Staff == nil || deps.Children == nil || deps.Notices == nil || deps.Closing == nil || deps.Activities == nil || deps.Classes == nil || deps.Appointments == nil || deps.MealPlan == nil || deps.RoomClosures == nil {
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
			{source: SourceChildren, read: deps.Children.ChildChanges},
			{source: SourceNotices, read: deps.Notices.StaffNotices},
			{source: SourceClosingDays, read: deps.Closing.ClosingDays},
			{source: SourceActivities, read: deps.Activities.ActivityChanges},
			{source: SourceClasses, read: deps.Classes.ClassChanges},
			{source: SourceAppointments, read: deps.Appointments.AppointmentChanges},
			{source: SourceMealPlan, read: deps.MealPlan.MealPlanChanges},
			{source: SourceRoomClosures, read: deps.RoomClosures.RoomClosures},
		},
	}, nil
}

// overview reads every source separately for day. A failed source leaves
// its entries out and is marked failed; only a failure of the isolation
// itself fails the request.
//
// The sources only read, so consecutive sources share one isolation while
// they succeed: rolling a failed source back also rolls back the reads before
// it, which changes nothing, and their entries are already held. After a
// failure the remaining sources get a fresh isolation. Every source still
// runs isolated from a failed statement of another (ADR 0299 point 7,
// addendum of #7667), at two statements per request instead of two per
// source.
func (v *view) overview(ctx context.Context, day calendar.Date) (Overview, error) {
	results := make([][]SourceEntry, len(v.sources))
	failed := make([]bool, len(v.sources))
	for start := 0; start < len(v.sources); {
		failedAt, err := v.readFrom(ctx, day, start, results)
		if err == nil {
			break
		}
		if v.isolation.IsFatal(err) || failedAt < 0 {
			return Overview{}, fmt.Errorf("day changes sources: %w", err)
		}
		// The source and the error; source reads name no person in their errors.
		v.logger.ErrorContext(ctx, "day changes source failed",
			"source", string(v.sources[failedAt].source),
			"error", err.Error(),
		)
		failed[failedAt] = true
		start = failedAt + 1
	}
	overview := Overview{Date: day, Sources: make([]SourceStatus, 0, len(v.sources)), Entries: []Entry{}}
	for i, source := range v.sources {
		if failed[i] {
			overview.Sources = append(overview.Sources, SourceStatus{Source: source.source, Status: SourceFailed})
			continue
		}
		overview.Sources = append(overview.Sources, SourceStatus{Source: source.source, Status: SourceLoaded})
		for _, entry := range results[i] {
			overview.Entries = append(overview.Entries, toEntry(entry))
		}
	}
	overview.Entries = foldCoveredBlocks(overview.Entries)
	markPickupsAfterClosing(overview.Entries)
	sortEntries(overview.Entries)
	return overview, nil
}

// foldCoveredBlocks folds the Stundenplan's "andere Leitung" of a block into
// the Personal source's absence or cover of the same block (#7675): both say
// who takes over, the Personal entry under its own rule. The block's room
// moves over. Without the Personal entry (another rule, a failed source) the
// Stundenplan's line stays.
func foldCoveredBlocks(entries []Entry) []Entry {
	covering := map[int64]int{}
	for i, entry := range entries {
		if (entry.Kind == KindBlockSubstitution || entry.Kind == KindBlockStaffAbsent) && entry.Activity != nil {
			covering[entry.Activity.ID.Int64()] = i
		}
	}
	if len(covering) == 0 {
		return entries
	}
	for _, entry := range entries {
		if at, found := foldTarget(entry, covering); found && entries[at].Room == nil {
			entries[at].Room = entry.Room
		}
	}
	kept := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		if _, found := foldTarget(entry, covering); !found {
			kept = append(kept, entry)
		}
	}
	return kept
}

func foldTarget(entry Entry, covering map[int64]int) (int, bool) {
	if entry.Kind != KindActivityLeadChanged || entry.Activity == nil {
		return 0, false
	}
	at, found := covering[entry.Activity.ID.Int64()]
	return at, found
}

// readFrom reads the sources from start on inside one isolation until one
// fails. It returns the index of the failed source, or -1.
func (v *view) readFrom(ctx context.Context, day calendar.Date, start int, results [][]SourceEntry) (int, error) {
	failedAt := -1
	err := v.isolation.Run(ctx, func(ctx context.Context) error {
		for i := start; i < len(v.sources); i++ {
			entries, err := v.sources[i].read(ctx, day)
			if err != nil {
				failedAt = i
				return err
			}
			results[i] = entries
		}
		return nil
	})
	return failedAt, err
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
		People: people, Group: entry.Group, Link: entry.Link, Count: entry.Count, Notice: entry.Notice,
		Closing: entry.Closing, Opening: entry.Opening, Child: entry.Child, ChildSummary: entry.ChildSummary,
		Activity: entry.Activity, Room: entry.Room, PreviousRoom: entry.PreviousRoom,
		Class: entry.Class, Appointment: entry.Appointment, MealCancellation: entry.MealCancellation, EnteredByYou: entry.EnteredByYou,
		RoomClosure: entry.RoomClosure,
	}
}

// sortEntries puts "Betrifft dich" before "Schule". Inside a section (#7660),
// new full-day changes stand first, the changes with a time of day follow by
// their start, then the long ones that began before today compactly, and the
// summaries close the section. An unacknowledged Hinweis der Leitung stands
// above everything. The frontend folds what has ended into "erledigt". Ties
// sort by kind, first name and group, so the order is stable.
func sortEntries(entries []Entry) {
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.Section != b.Section {
			return a.Section == SectionYou
		}
		if ra, rb := rank(a), rank(b); ra != rb {
			return ra < rb
		}
		if a.StartsAt != nil && b.StartsAt != nil && !a.StartsAt.Equal(*b.StartsAt) {
			return a.StartsAt.Before(*b.StartsAt)
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
	// The school is closed or opens at other times: that stands above every
	// other change (#7664, #8170).
	case entry.Kind == KindClosingDay, entry.Kind == KindOpeningChanged:
		return -2
	case entry.Notice != nil && entry.Notice.RequiresAcknowledgement && !entry.Notice.Acknowledged:
		return -1
	case entry.Count != nil || entry.ChildSummary != nil:
		return 3
	case entry.Since != nil:
		return 2
	case entry.StartsAt != nil:
		return 1
	default:
		return 0
	}
}

func firstName(entry Entry) string {
	if entry.Child != nil {
		return entry.Child.FirstName + " " + entry.Child.LastName
	}
	if len(entry.People) == 0 {
		return ""
	}
	return entry.People[0].Name
}

func groupName(entry Entry) string {
	if entry.Group == nil && entry.Class != nil {
		return entry.Class.Name
	}
	if entry.Group == nil && entry.ChildSummary != nil {
		return entry.ChildSummary.SchoolClass
	}
	if entry.Group == nil {
		return ""
	}
	return entry.Group.Name
}
