package application

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func reportPortsBound(ports traegerview.ReportPorts) bool {
	return ports.Templates != nil && ports.Absences != nil && ports.Demand != nil
}

// ReportRenderer renders a key-date report as a file of the format; the
// composition binds it to the projection's export adapter, which knows the
// formats. An unknown format is traegerview.ErrUnsupportedReportFormat.
type ReportRenderer interface {
	SupportsReportFormat(format string) bool
	RenderKeyDateReport(report traegerview.KeyDateReport, format string) (traegerview.ReportFile, error)
}

// KeyDateReportExport draws up the report and renders it. The format is
// checked before any read.
func (o *Overview) KeyDateReportExport(ctx context.Context, organizationID int64, keyDate calendar.Date, templateID int64, format string) (traegerview.ReportFile, error) {
	if !o.renderer.SupportsReportFormat(format) {
		return traegerview.ReportFile{}, fmt.Errorf("%w: %q", traegerview.ErrUnsupportedReportFormat, format)
	}
	report, err := o.KeyDateReport(ctx, organizationID, keyDate, templateID)
	if err != nil {
		return traegerview.ReportFile{}, err
	}
	return o.renderer.RenderKeyDateReport(report, format)
}

// KeyDateReport returns the report of every school of the Träger on the key
// date in the sections of the template (#4716, ADR 0246); templateID 0 is
// the standard report. Every owner is read once for the whole school set and
// only for the sections that need it, so the read costs the same statements
// for 3 and for 100 schools. The answer holds counts and the names of
// schools, Sozialräume and care forms, no child and no staff member, so it is
// not written to the access log (ADR 0084 section 7).
func (o *Overview) KeyDateReport(ctx context.Context, organizationID int64, keyDate calendar.Date, templateID int64) (traegerview.KeyDateReport, error) {
	if organizationID <= 0 {
		return traegerview.KeyDateReport{}, traegerview.ErrTraegerRequired
	}
	if templateID < 0 {
		return traegerview.KeyDateReport{}, traegerview.ErrReportTemplateNotFound
	}
	now := o.now()
	today := calendar.DateFromTime(now)
	if err := validateKeyDate(keyDate, today); err != nil {
		return traegerview.KeyDateReport{}, err
	}
	result := traegerview.KeyDateReport{KeyDate: keyDate, AsOf: now, Sections: traegerview.ReportSections()}
	err := o.read(ctx, organizationID, func(adminCtx context.Context, ids []int64) error {
		return o.drawKeyDateReport(adminCtx, organizationID, templateID, ids, today, &result)
	})
	if err != nil {
		return traegerview.KeyDateReport{}, err
	}
	return result, nil
}

// drawKeyDateReport fills the report of the school set in the projection's
// administrative unit: the template, the absence window, the schools with
// their figures and the sums.
func (o *Overview) drawKeyDateReport(ctx context.Context, organizationID, templateID int64, ids []int64, today calendar.Date, result *traegerview.KeyDateReport) error {
	var districts map[int64]string
	if templateID > 0 {
		template, err := o.reports.Templates.ReportTemplate(ctx, organizationID, templateID)
		if err != nil {
			return err
		}
		result.Template = &traegerview.KeyDateReportTemplate{ID: template.ID, Name: template.Name}
		result.Sections = template.Sections
		districts = template.Districts
	}
	if window, ok := absenceWindow(result.KeyDate, today); ok && slices.Contains(result.Sections, traegerview.ReportSectionAbsences) {
		result.AbsenceWindow = &window
	}
	schools, err := o.rows.Schools(ctx, ids)
	if err != nil {
		return err
	}
	reads, err := o.keyDateReads(ctx, ids, result.KeyDate, result.Sections, result.AbsenceWindow)
	if err != nil {
		return err
	}
	result.Schools = make([]traegerview.KeyDateSchool, 0, len(schools))
	for _, school := range schools {
		result.Schools = append(result.Schools, reads.school(school, districts))
	}
	result.Districts, result.Total = aggregateKeyDateSchools(result.Schools)
	return nil
}

// validateKeyDate admits a key date from traegerview.KeyDateReportEarliest
// to traegerview.KeyDateReportMaxDaysAhead days after today.
func validateKeyDate(keyDate, today calendar.Date) error {
	switch {
	case keyDate.IsZero():
		return fmt.Errorf("%w: key_date is required", traegerview.ErrInvalidKeyDate)
	case keyDate.Before(traegerview.KeyDateReportEarliest):
		return fmt.Errorf("%w: key_date must not be before %s", traegerview.ErrInvalidKeyDate, traegerview.KeyDateReportEarliest)
	case keyDate.After(today.AddDays(traegerview.KeyDateReportMaxDaysAhead)):
		return fmt.Errorf("%w: key_date must not be more than %d days ahead", traegerview.ErrInvalidKeyDate, traegerview.KeyDateReportMaxDaysAhead)
	}
	return nil
}

// absenceWindow is the window of the absences of traegerview.KeyDateReport:
// from 1 August of the school year of the key date, at most 365 days back,
// to the key date, at most yesterday. ok is false when no day of it is over.
func absenceWindow(keyDate, today calendar.Date) (traegerview.ReportWindow, bool) {
	year := keyDate.Year()
	if keyDate.Month() < time.August {
		year--
	}
	from := calendar.NewDate(year, time.August, 1)
	if earliest := keyDate.AddDays(-365); earliest.After(from) {
		from = earliest
	}
	to := keyDate
	if yesterday := today.AddDays(-1); yesterday.Before(to) {
		to = yesterday
	}
	if to.Before(from) {
		return traegerview.ReportWindow{}, false
	}
	return traegerview.ReportWindow{From: from, To: to}, true
}

// keyDateReads are the owners' answers for a school set, keyed by school.
// A section the report does not show leaves its reads empty.
type keyDateReads struct {
	careFormReads
	// withCareForms is set when the bookings were read.
	withCareForms bool
	staff         map[int64][]int64
	attendance    map[int64]traegerview.DailyCounts
	sick          map[int64]map[calendar.Date]int
	excused       map[int64]map[calendar.Date]int
	open          map[int64]int
	waitlisted    map[int64]int
	window        *traegerview.ReportWindow
}

func (o *Overview) keyDateReads(ctx context.Context, scope []int64, keyDate calendar.Date, sections []string, window *traegerview.ReportWindow) (keyDateReads, error) {
	reads := keyDateReads{window: window}
	if len(scope) == 0 {
		return reads, nil
	}
	if err := o.rosterReads(ctx, scope, keyDate, sections, &reads); err != nil {
		return reads, err
	}
	var err error
	if window != nil {
		if reads.attendance, err = o.utilization.Presence.AttendanceCountsByTenant(ctx, scope, window.From, window.To); err != nil {
			return reads, err
		}
		if reads.sick, reads.excused, err = o.reports.Absences.StatusDayCountsByTenant(ctx, scope, window.From, window.To); err != nil {
			return reads, err
		}
	}
	if slices.Contains(sections, traegerview.ReportSectionDemand) {
		reads.open, reads.waitlisted, err = o.reports.Demand.EnrollmentDemandByTenant(ctx, scope)
	}
	return reads, err
}

// rosterReads reads the children with their care forms when the report
// shows children or demand, the staff when it shows staff, and for staff
// alone the roster the care ratio needs, without the bookings.
func (o *Overview) rosterReads(ctx context.Context, scope []int64, keyDate calendar.Date, sections []string, reads *keyDateReads) error {
	staff := slices.Contains(sections, traegerview.ReportSectionStaff)
	var err error
	switch {
	case slices.Contains(sections, traegerview.ReportSectionChildren) || slices.Contains(sections, traegerview.ReportSectionDemand):
		reads.withCareForms = true
		reads.careFormReads, err = o.careFormReads(ctx, scope, keyDate)
	case staff:
		reads.roster, err = o.rosters.ActiveStudentMembershipsByTenant(ctx, scope, keyDate.BerlinMidnight())
	}
	if err != nil || !staff {
		return err
	}
	reads.staff, err = o.rosters.ActiveStaffIDsByTenant(ctx, scope, keyDate.BerlinMidnight())
	return err
}

// school applies the definitions of traegerview.KeyDateReport to one school.
func (r keyDateReads) school(school traegerview.School, districts map[int64]string) traegerview.KeyDateSchool {
	row := traegerview.KeyDateSchool{ID: school.ID, Name: school.Name, City: school.City, CareForms: []traegerview.KeyDateCareForm{}}
	if district, ok := districts[school.ID]; ok {
		row.District = &district
	}
	figures := traegerview.KeyDateFigures{Children: len(r.roster[school.ID]), Staff: len(r.staff[school.ID])}
	if r.withCareForms {
		forms, without := careFormOccupancy(r.roster[school.ID], r.bookings[school.ID], r.children[school.ID])
		figures.WithoutCareForm = without
		for _, form := range forms {
			row.CareForms = append(row.CareForms, traegerview.KeyDateCareForm{Name: form.Name, Children: form.Children, Capacity: form.Capacity, Active: form.Active})
		}
	}
	if r.window != nil {
		attendance := r.attendance[school.ID]
		row.AttendanceFrom = attendance.From
		// Only days with a check-in at the school count: on such a day the
		// school was open and still keeps its attendance, so a sick or excused
		// day on a holiday, a closing day or before the kept attendance
		// raises no absence rate (#4716).
		for day, count := range attendance.Counts {
			if weekday := day.Weekday(); weekday == time.Saturday || weekday == time.Sunday || count == 0 {
				continue
			}
			figures.PresentDays += count
			figures.SickDays += r.sick[school.ID][day]
			figures.ExcusedDays += r.excused[school.ID][day]
		}
	}
	figures.Open, figures.Waitlisted = r.open[school.ID], r.waitlisted[school.ID]
	row.Figures = completeFigures(figures, row.CareForms)
	return row
}

// completeFigures derives the figures that follow from the counts: the care
// ratio, the absence rate and the demand.
func completeFigures(figures traegerview.KeyDateFigures, forms []traegerview.KeyDateCareForm) traegerview.KeyDateFigures {
	figures.Places, figures.BookedPlaces = 0, 0
	for _, form := range forms {
		if form.Active && form.Capacity != nil {
			figures.Places += *form.Capacity
			figures.BookedPlaces += form.Children
		}
	}
	figures.FreePlaces = max(figures.Places-figures.BookedPlaces, 0)
	figures.Booked = figures.Children - figures.WithoutCareForm
	figures.Demand = figures.Booked + figures.Open + figures.Waitlisted
	figures.ChildrenPerStaff = nil
	if figures.Staff > 0 {
		ratio := float64(figures.Children) / float64(figures.Staff)
		figures.ChildrenPerStaff = &ratio
	}
	figures.AbsenceRate = nil
	if absent := figures.SickDays + figures.ExcusedDays; absent+figures.PresentDays > 0 {
		rate := float64(absent) / float64(absent+figures.PresentDays) * 100
		figures.AbsenceRate = &rate
	}
	return figures
}

// aggregateKeyDateSchools sums the schools per Sozialraum and in total.
// Districts stay empty when no school has a Sozialraum; once one has, the
// schools without one form traegerview.UnmappedDistrict, listed last.
func aggregateKeyDateSchools(schools []traegerview.KeyDateSchool) ([]traegerview.KeyDateDistrict, traegerview.KeyDateTotal) {
	total := sumKeyDateSchools(schools)
	districts := []traegerview.KeyDateDistrict{}
	byName := map[string][]traegerview.KeyDateSchool{}
	var unmapped []traegerview.KeyDateSchool
	for _, school := range schools {
		if school.District == nil {
			unmapped = append(unmapped, school)
			continue
		}
		byName[*school.District] = append(byName[*school.District], school)
	}
	if len(byName) == 0 {
		return districts, traegerview.KeyDateTotal(total)
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	slices.SortFunc(names, compareNames)
	for _, name := range names {
		sum := sumKeyDateSchools(byName[name])
		districts = append(districts, traegerview.KeyDateDistrict{Name: name, Schools: sum.Schools, Figures: sum.Figures, CareForms: sum.CareForms})
	}
	if len(unmapped) > 0 {
		sum := sumKeyDateSchools(unmapped)
		districts = append(districts, traegerview.KeyDateDistrict{Name: traegerview.UnmappedDistrict, Unmapped: true, Schools: sum.Schools, Figures: sum.Figures, CareForms: sum.CareForms})
	}
	return districts, traegerview.KeyDateTotal(total)
}

// keyDateSum is the sum of a set of schools.
type keyDateSum struct {
	Schools   int
	Figures   traegerview.KeyDateFigures
	CareForms []traegerview.KeyDateCareForm
}

func sumKeyDateSchools(schools []traegerview.KeyDateSchool) keyDateSum {
	var figures traegerview.KeyDateFigures
	var forms []traegerview.KeyDateCareForm
	for _, school := range schools {
		figures.Children += school.Figures.Children
		figures.WithoutCareForm += school.Figures.WithoutCareForm
		figures.Staff += school.Figures.Staff
		figures.PresentDays += school.Figures.PresentDays
		figures.SickDays += school.Figures.SickDays
		figures.ExcusedDays += school.Figures.ExcusedDays
		figures.Open += school.Figures.Open
		figures.Waitlisted += school.Figures.Waitlisted
		forms = append(forms, school.CareForms...)
	}
	merged := mergeCareForms(forms)
	figures = completeFigures(figures, nil)
	// Places of a sum are the sum of the schools' places; a merged form of
	// an active and an inactive offering must not move them.
	for _, school := range schools {
		figures.Places += school.Figures.Places
		figures.BookedPlaces += school.Figures.BookedPlaces
	}
	figures.FreePlaces = max(figures.Places-figures.BookedPlaces, 0)
	return keyDateSum{Schools: len(schools), Figures: figures, CareForms: merged}
}

// mergeCareForms adds up children and capacity per exact name of a care
// form, ordered by name. A capacity is nil when one form of the name has
// none; a merged form is active when one of its forms is.
func mergeCareForms(forms []traegerview.KeyDateCareForm) []traegerview.KeyDateCareForm {
	merged := []traegerview.KeyDateCareForm{}
	index := map[string]int{}
	for _, form := range forms {
		at, ok := index[form.Name]
		if !ok {
			index[form.Name] = len(merged)
			copied := form
			if form.Capacity != nil {
				capacity := *form.Capacity
				copied.Capacity = &capacity
			}
			merged = append(merged, copied)
			continue
		}
		target := &merged[at]
		target.Children += form.Children
		target.Active = target.Active || form.Active
		if target.Capacity == nil || form.Capacity == nil {
			target.Capacity = nil
		} else {
			*target.Capacity += *form.Capacity
		}
	}
	slices.SortStableFunc(merged, func(a, b traegerview.KeyDateCareForm) int { return compareNames(a.Name, b.Name) })
	return merged
}

// compareNames orders names without case, then by their spelling.
func compareNames(a, b string) int {
	if order := strings.Compare(strings.ToLower(a), strings.ToLower(b)); order != 0 {
		return order
	}
	return strings.Compare(a, b)
}
