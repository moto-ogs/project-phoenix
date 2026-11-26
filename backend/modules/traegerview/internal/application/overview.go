// Package application answers the Träger-Portal reads of the Träger
// projection (ADR 0084 section 1): it resolves the schools of the Träger at
// Organisation & Tenancy and reads them in one administrative transaction.
package application

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// SchoolRows reads the rows of a school set; the Postgres adapter serves it.
type SchoolRows interface {
	Schools(ctx context.Context, schools []int64) ([]traegerview.TraegerSchool, error)
	SchoolContacts(ctx context.Context, schools []int64) ([]traegerview.SchoolContact, error)
}

// Overview answers the reads of one Träger.
type Overview struct {
	schoolIDs   traegerview.SchoolIDs
	rows        SchoolRows
	trail       traegerview.AccessTrail
	persons     traegerview.PersonDirectory
	staff       traegerview.StaffDirectory
	bureau      traegerview.BureauAddresses
	recorder    traegerview.AccessRecorder
	holiday     traegerview.HolidayTrail
	rosters     traegerview.SchoolRosters
	present     traegerview.PresentStudents
	sick        traegerview.SickStudents
	onSite      traegerview.OnSiteStaff
	enrollments traegerview.OpenEnrollments
	alerts      traegerview.AlertSettings
	occupancy   traegerview.OccupancyPorts
	known       traegerview.KnownChildrenPorts
	times       traegerview.ArrivalPickupCounts
	utilization traegerview.UtilizationPorts
	reports     traegerview.ReportPorts
	renderer    ReportRenderer
	daily       traegerview.DailyAttendancePorts
	dayChanges  traegerview.DayChangePorts
	children    traegerview.ChildrenPorts
	now         func() time.Time
	withinAdmin func(context.Context, func(context.Context) error) error
}

var (
	_ traegerview.Overview            = (*Overview)(nil)
	_ traegerview.ArrivalPickupReport = (*Overview)(nil)
	_ traegerview.KeyDateReports      = (*Overview)(nil)
)

// New builds the overview. renderer renders the key-date report export.
// withinAdmin opens the administrative transaction the projection reads in;
// it is the Träger-Portal's only one (ADR 0084).
func New(ports traegerview.Ports, rows SchoolRows, renderer ReportRenderer, withinAdmin func(context.Context, func(context.Context) error) error) (*Overview, error) {
	if ports.SchoolIDs == nil || rows == nil || ports.Trail == nil || ports.Persons == nil || ports.Staff == nil || ports.Bureau == nil || ports.Recorder == nil || ports.Holiday == nil || ports.Rosters == nil || ports.Present == nil || ports.Sick == nil || ports.OnSite == nil ||
		ports.Enrollments == nil || ports.Alerts == nil || !occupancyPortsBound(ports.Occupancy) || ports.Known.Children == nil || ports.Known.Namesakes == nil || !utilizationPortsBound(ports.Utilization) || ports.Times == nil || !reportPortsBound(ports.Reports) || renderer == nil ||
		ports.Daily.Days == nil || ports.Daily.Absences == nil || ports.Daily.States == nil || ports.DayChanges.Closings == nil || ports.DayChanges.Blocks == nil || !childrenPortsBound(ports.Children) || ports.Now == nil || withinAdmin == nil {
		return nil, errors.New("traeger view: school IDs, rows, access trail, persons, staff, Träger-Büro addresses, access recorder, holiday trail, school figures, open enrollments, alert thresholds, occupancy reads, known child reads, utilization reads, arrival and pickup times, report reads, the report renderer, the daily attendance reads, the day change reads, the children reads, the clock and the administrative transaction are required")
	}
	return &Overview{
		schoolIDs: ports.SchoolIDs, rows: rows, trail: ports.Trail, persons: ports.Persons, staff: ports.Staff, bureau: ports.Bureau,
		recorder: ports.Recorder, holiday: ports.Holiday, rosters: ports.Rosters, present: ports.Present, sick: ports.Sick, onSite: ports.OnSite,
		enrollments: ports.Enrollments, alerts: ports.Alerts, occupancy: ports.Occupancy, known: ports.Known, utilization: ports.Utilization, times: ports.Times, reports: ports.Reports, renderer: renderer, daily: ports.Daily, dayChanges: ports.DayChanges, children: ports.Children, now: ports.Now, withinAdmin: withinAdmin,
	}, nil
}

// Schools lists the schools of the Träger. A Träger that is deactivated or
// deleted reaches no school.
func (o *Overview) Schools(ctx context.Context, organizationID int64) ([]traegerview.TraegerSchool, error) {
	if organizationID <= 0 {
		return nil, traegerview.ErrTraegerRequired
	}
	var schools []traegerview.TraegerSchool
	err := o.withinAdmin(ctx, func(adminCtx context.Context) error {
		ids, err := o.schoolIDs.ListTraegerSchoolIDs(adminCtx, organizationID)
		if err != nil {
			return err
		}
		schools, err = o.rows.Schools(adminCtx, ids)
		return err
	})
	if err != nil {
		return nil, err
	}
	return schools, nil
}

// School returns one school of the Träger with its figures (#5686). Figures
// are aggregated numbers, so the read is not written to the access log (ADR
// 0084 section 7).
func (o *Overview) School(ctx context.Context, organizationID, schoolID int64) (traegerview.SchoolView, error) {
	if organizationID <= 0 {
		return traegerview.SchoolView{}, traegerview.ErrTraegerRequired
	}
	var view traegerview.SchoolView
	err := o.read(ctx, organizationID, func(adminCtx context.Context, schools []int64) error {
		if !slices.Contains(schools, schoolID) {
			return traegerview.ErrSchoolOutsideTraeger
		}
		var err error
		view, err = o.schoolView(adminCtx, schoolID)
		return err
	})
	if err != nil {
		return traegerview.SchoolView{}, err
	}
	return view, nil
}

// schoolView reads one school the caller has checked against the Träger.
func (o *Overview) schoolView(ctx context.Context, schoolID int64) (traegerview.SchoolView, error) {
	scope := []int64{schoolID}
	contacts, err := o.rows.SchoolContacts(ctx, scope)
	if err != nil {
		return traegerview.SchoolView{}, err
	}
	if len(contacts) == 0 {
		return traegerview.SchoolView{}, traegerview.ErrSchoolOutsideTraeger
	}
	figures, err := o.schoolFigures(ctx, scope)
	if err != nil {
		return traegerview.SchoolView{}, err
	}
	return traegerview.SchoolView{SchoolContact: contacts[0], Figures: figures[schoolID]}, nil
}

// schoolFigures reads the figures of the schools at their owners, one read per
// owner for the whole set, and applies the definitions of
// traegerview.SchoolFigures: only children and staff members the school
// counts enter the sick and on-site figures. The caller has checked the
// schools against the Träger.
func (o *Overview) schoolFigures(ctx context.Context, scope []int64) (map[int64]traegerview.SchoolFigures, error) {
	result := make(map[int64]traegerview.SchoolFigures, len(scope))
	if len(scope) == 0 {
		return result, nil
	}
	now := o.now()
	students, err := o.rosters.ActiveStudentMembershipsByTenant(ctx, scope, now)
	if err != nil {
		return nil, err
	}
	staff, err := o.rosters.ActiveStaffIDsByTenant(ctx, scope, now)
	if err != nil {
		return nil, err
	}
	present, err := o.present.PresentStudentIDsByTenant(ctx, scope, now)
	if err != nil {
		return nil, err
	}
	sickDays, err := o.sick.SickDayStudentIDsByTenant(ctx, scope, now)
	if err != nil {
		return nil, err
	}
	sickFlags, err := o.sick.SickFlagMembershipIDsByTenant(ctx, scope)
	if err != nil {
		return nil, err
	}
	onSite, err := o.onSite.OnSiteStaffIDsByTenant(ctx, scope, now)
	if err != nil {
		return nil, err
	}
	for _, schoolID := range scope {
		figures := traegerview.SchoolFigures{
			ChildrenTotal: len(students[schoolID]), ChildrenPresent: countStudents(students[schoolID], present[schoolID]),
			ChildrenSick: countSick(students[schoolID], sickDays[schoolID], sickFlags[schoolID], present[schoolID]),
			StaffTotal:   len(staff[schoolID]), StaffPresent: countMembers(staff[schoolID], onSite[schoolID]),
			AsOf: now,
		}
		figures.CareRatio = careRatio(figures.ChildrenPresent, figures.StaffPresent)
		result[schoolID] = figures
	}
	return result, nil
}

// careRatio is the present children per present staff member; nil without
// present staff.
func careRatio(childrenPresent, staffPresent int) *float64 {
	if staffPresent <= 0 {
		return nil
	}
	ratio := float64(childrenPresent) / float64(staffPresent)
	return &ratio
}

// countStudents counts the present children who belong to the active roster.
func countStudents(roster map[int64]int64, ids []int64) int {
	count := 0
	for _, id := range ids {
		if _, ok := roster[id]; ok {
			count++
		}
	}
	return count
}

// countSick counts the children of the roster (student ID to membership ID)
// with a sick day or the sick flag, each child once. Place before status
// (#6371), as on the school's dashboard: a present child counts as present
// only, its sick mark is no sick figure.
func countSick(students map[int64]int64, sickDays, sickFlags, present []int64) int {
	sick := make(map[int64]struct{}, len(sickDays))
	for _, student := range sickDays {
		if _, active := students[student]; active {
			sick[student] = struct{}{}
		}
	}
	if len(sickFlags) > 0 {
		flagged := figureIDSet(sickFlags)
		for student, membership := range students {
			if _, ok := flagged[membership]; ok {
				sick[student] = struct{}{}
			}
		}
	}
	for _, student := range present {
		delete(sick, student)
	}
	return len(sick)
}

// countMembers counts each occurrence in ids, not each distinct roster entry.
func countMembers(roster, ids []int64) int {
	members := figureIDSet(roster)
	count := 0
	for _, id := range ids {
		if _, ok := members[id]; ok {
			count++
		}
	}
	return count
}

func figureIDSet(ids []int64) map[int64]struct{} {
	set := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	return set
}

// read runs fn with the school set of the Träger in the projection's
// administrative unit (ADR 0109, #5686).
func (o *Overview) read(ctx context.Context, organizationID int64, fn func(adminCtx context.Context, schools []int64) error) error {
	return o.withinAdmin(ctx, func(adminCtx context.Context) error {
		ids, err := o.schoolIDs.ListTraegerSchoolIDs(adminCtx, organizationID)
		if err != nil {
			return err
		}
		return fn(adminCtx, ids)
	})
}

// Traeger returns the Träger of the session with its test mark (#4658). The
// session's account must still be an active member of an active Träger; a
// membership that ended, or a Träger that is deactivated or deleted, makes
// the Träger unavailable and ends the session.
func (o *Overview) Traeger(ctx context.Context, organizationID, accountID int64) (traegerview.Traeger, error) {
	if organizationID <= 0 || accountID <= 0 {
		return traegerview.Traeger{}, traegerview.ErrTraegerRequired
	}
	memberships, err := o.schoolIDs.ListAccountTraeger(ctx, accountID)
	if err != nil {
		return traegerview.Traeger{}, err
	}
	index := slices.IndexFunc(memberships, func(traeger traegerview.Traeger) bool {
		return traeger.ID == ident.ID(organizationID)
	})
	if index < 0 {
		return traegerview.Traeger{}, traegerview.ErrTraegerUnavailable
	}
	return memberships[index], nil
}
