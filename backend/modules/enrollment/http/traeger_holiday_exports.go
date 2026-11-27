package enrollmenthttp

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The lists of the holiday care in the Träger-Portal as PDF, Excel or CSV
// (#4718): the periods, the places of a period's weeks and its allocation
// by criteria. Each export reads what its list reads, under the same right,
// and the places and the allocation record the read in the period's trail
// like their lists.

func (rs *HolidayPeriodResource) exportRoutes(r chi.Router, withTx common.Middleware) {
	named := r.With(rs.requireManage, rs.withSchoolNames, withTx)
	named.Get("/export", rs.exportPeriods)
	named.Get("/{id}/places/export", rs.exportPlaces)
	named.Get("/{id}/allocation/export", rs.exportAllocation)
}

const holidayDay = "02.01.2006"

// holidayDate is „04.01.2027“, empty for no day.
func holidayDate(day calendar.Date) string {
	if day.IsZero() {
		return ""
	}
	return day.Format(holidayDay)
}

// holidayNames returns the school names withSchoolNames read.
func holidayNames(r *http.Request) func(int64) string {
	names, _ := r.Context().Value(holidaySchoolNamesKey{}).(map[int64]string)
	return func(id int64) string {
		if name, ok := names[id]; ok {
			return name
		}
		return "Schule nicht mehr vorhanden"
	}
}

// exportPeriods answers GET /traeger/holiday-periods/export: one row per
// holiday period, the newest first like the list. The periods name no
// child, so the export is not written to a trail, like the list.
func (rs *HolidayPeriodResource) exportPeriods(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	periods, err := rs.periods.ListHolidayPeriods(r.Context(), organizationID)
	if err != nil {
		renderHolidayPeriodError(w, r, err)
		return
	}
	school := holidayNames(r)
	kind := r.URL.Query().Get("kind")
	switch kind {
	case "", capability.HolidayPeriodKindHoliday, capability.HolidayPeriodKindExtraDay:
	default:
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("kind must be holiday or extra_day")))
		return
	}
	if kind == capability.HolidayPeriodKindExtraDay {
		common.WriteList(w, r, rs.lists, format, extraDayTable(periods, school))
		return
	}
	rows := make([][]string, 0, len(periods))
	for _, period := range periods {
		if kind == "" || period.Kind == kind {
			rows = append(rows, holidayPeriodRow(period, school))
		}
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Ferienbetreuung", Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "name", Label: "Ferienzeitraum"}, {ID: "opens", Label: "Anmeldung ab"}, {ID: "closes", Label: "Anmeldung bis"},
			{ID: "weeks", Label: "Wochen"}, {ID: "first", Label: "Erster Tag"}, {ID: "last", Label: "Letzter Tag"},
			{ID: "schools", Label: "Schulen"}, {ID: "registrations", Label: "Anmeldungen"}, {ID: "status", Label: "Status"},
		},
		Rows: rows, Filename: "ferienzeitraeume",
	})
}

// extraDayTable lists the extra care days of the Träger (#4817): one row per
// day and school, so the figures of each school stand side by side.
func extraDayTable(periods []capability.HolidayPeriod, school func(int64) string) common.ListTable {
	var rows [][]string
	for _, period := range periods {
		if period.Kind != capability.HolidayPeriodKindExtraDay {
			continue
		}
		status := "Entwurf"
		if period.Status == capability.HolidayPeriodPublished {
			status = "Veröffentlicht"
		}
		for _, week := range period.Weeks {
			rows = append(rows, []string{
				period.Name, week.StartsOn.Format(holidayDay), school(week.HostSchoolID.Int64()), extraDayCareTime(week),
				period.RegistrationClosesOn.Format(holidayDay), extraDayFee(period, week), strconv.Itoa(week.Placed), extraDayCapacity(week), status,
			})
		}
	}
	return common.ListTable{
		Title: "Zusatztage", Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "name", Label: "Zusatztag"}, {ID: "day", Label: "Tag"}, {ID: "school", Label: "Schule"},
			{ID: "care", Label: "Betreuungszeit"}, {ID: "closes", Label: "Anmeldung bis"}, {ID: "fee", Label: "Beitrag"},
			{ID: "placed", Label: "Kinder mit Platz"}, {ID: "capacity", Label: "Plätze"}, {ID: "status", Label: "Status"},
		},
		Rows: rows, Filename: "zusatztage",
	}
}

// extraDayCapacity names the places of a school's extra day.
func extraDayCapacity(week capability.HolidayWeek) string {
	if week.Capacity == nil {
		return "Ohne Grenze"
	}
	return strconv.Itoa(*week.Capacity)
}

// extraDayCareTime names the care time of a school's extra day, the first
// time model that is still offered.
func extraDayCareTime(week capability.HolidayWeek) string {
	for _, model := range week.TimeModels {
		if !model.Archived {
			return model.StartsAt + " bis " + model.EndsAt + " Uhr"
		}
	}
	return ""
}

// extraDayFee says what a school's extra day costs: nothing beyond the
// monthly contribution, or the price of its time model.
func extraDayFee(period capability.HolidayPeriod, week capability.HolidayWeek) string {
	if period.IncludedInFee {
		return "Im Monatsbeitrag enthalten"
	}
	for _, model := range week.TimeModels {
		if !model.Archived {
			return fmt.Sprintf("%d,%02d € pro Tag", model.PriceCents/100, model.PriceCents%100)
		}
	}
	return ""
}

// holidayPeriodRow counts weeks on the same days once, as the list does, and
// names the host schools.
func holidayPeriodRow(period capability.HolidayPeriod, school func(int64) string) []string {
	days := map[[2]calendar.Date]bool{}
	hosts := map[string]bool{}
	var first, last calendar.Date
	for i, week := range period.Weeks {
		days[[2]calendar.Date{week.StartsOn, week.EndsOn}] = true
		hosts[school(week.HostSchoolID.Int64())] = true
		if i == 0 || week.StartsOn.Before(first) {
			first = week.StartsOn
		}
		if i == 0 || week.EndsOn.After(last) {
			last = week.EndsOn
		}
	}
	names := make([]string, 0, len(hosts))
	for name := range hosts {
		names = append(names, name)
	}
	sort.Strings(names)
	status := "Entwurf"
	if period.Status == capability.HolidayPeriodPublished {
		status = "Veröffentlicht"
	}
	return []string{
		period.Name, period.RegistrationOpensOn.Format(holidayDay), period.RegistrationClosesOn.Format(holidayDay),
		strconv.Itoa(len(days)), holidayDate(first), holidayDate(last), strings.Join(names, ", "), strconv.Itoa(period.RegistrationCount), status,
	}
}

// exportedPeriod reads the format and the period of an export by the ID of
// the route; ok is false once the answer is rendered.
func (rs *HolidayPeriodResource) exportedPeriod(w http.ResponseWriter, r *http.Request) (string, capability.HolidayReviewer, capability.HolidayPeriod, bool) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return "", capability.HolidayReviewer{}, capability.HolidayPeriod{}, false
	}
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return "", capability.HolidayReviewer{}, capability.HolidayPeriod{}, false
	}
	periodID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return "", capability.HolidayReviewer{}, capability.HolidayPeriod{}, false
	}
	period, err := rs.periods.HolidayPeriod(r.Context(), reviewer.OrganizationID, periodID)
	if err != nil {
		renderHolidayPeriodError(w, r, err)
		return "", capability.HolidayReviewer{}, capability.HolidayPeriod{}, false
	}
	return format, reviewer, period, true
}

// holidayWeekLabel is „04.01.2027 bis 08.01.2027“, or the one day of a week
// of a single day (#4817).
func holidayWeekLabel(startsOn, endsOn calendar.Date) string {
	return capability.HolidayWeekSpan(startsOn, endsOn)
}

// holidayDays is „04.01., 05.01.“: the wanted days of a booking by days.
func holidayDays(days []calendar.Date) string {
	labels := make([]string, len(days))
	for i, day := range days {
		labels[i] = day.Format("02.01.")
	}
	return strings.Join(labels, ", ")
}

// holidayInstant is „04.01.2027, 08:15“ in Berlin time.
func holidayInstant(at time.Time) string {
	return common.ListInstant(at)
}

// exportPlaces answers GET /traeger/holiday-periods/{id}/places/export: per
// week its places, then the children on its waiting list in their order.
// The waiting list names children, so the file carries the personal data
// note, and the read lands in the period's trail like the list's.
func (rs *HolidayPeriodResource) exportPlaces(w http.ResponseWriter, r *http.Request) {
	format, reviewer, period, ok := rs.exportedPeriod(w, r)
	if !ok {
		return
	}
	weeks, err := rs.places.HolidayWeekPlaces(r.Context(), reviewer, period.ID.Int64())
	if err != nil {
		renderHolidayReviewError(w, r, err)
		return
	}
	school := holidayNames(r)
	var rows [][]string
	for _, week := range weeks {
		label, host := holidayWeekLabel(week.StartsOn, week.EndsOn), school(week.HostSchoolID.Int64())
		capacity := "Ohne Grenze"
		if week.Capacity != nil {
			capacity = strconv.Itoa(*week.Capacity)
		}
		rows = append(rows, []string{label, host, "Woche", capacity, strconv.Itoa(week.Placed), strconv.Itoa(week.Pending), "", "", "", "", "", "", ""})
		for _, entry := range week.Waitlist {
			hint := ""
			if entry.Deferred {
				hint = "Ohne Ferienwunsch"
			}
			rows = append(rows, []string{
				label, host, "Warteliste", "", "", "", strconv.Itoa(entry.Position), entry.ChildLastName, entry.ChildFirstName,
				entry.TimeModelName, holidayDays(entry.Days), holidayInstant(entry.SubmittedAt), hint,
			})
		}
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Plätze und Warteliste", Subtitle: period.Name, Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "week", Label: "Woche"}, {ID: "school", Label: "Schule"}, {ID: "kind", Label: "Art"},
			{ID: "capacity", Label: "Plätze"}, {ID: "placed", Label: "Vergeben"}, {ID: "pending", Label: "Offen"},
			{ID: "position", Label: "Platz auf der Warteliste"}, {ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"},
			{ID: "time_model", Label: "Zeitmodell"}, {ID: "days", Label: "Tage"}, {ID: "submitted", Label: "Eingang"}, {ID: "hint", Label: "Hinweis"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter, Filename: "plaetze-" + period.Name,
	})
}

// exportAllocation answers GET /traeger/holiday-periods/{id}/allocation/export:
// the open registrations of every week in the order of the proposal, then
// every decision of the Büro. It names children, so the file carries the
// personal data note, and the read lands in the period's trail like the
// list's.
func (rs *HolidayPeriodResource) exportAllocation(w http.ResponseWriter, r *http.Request) {
	format, reviewer, period, ok := rs.exportedPeriod(w, r)
	if !ok {
		return
	}
	board, err := rs.allocation.HolidayAllocationBoard(r.Context(), reviewer, period.ID.Int64())
	if err != nil {
		renderHolidayAllocationError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, holidayAllocationTable(period, board, holidayNames(r)))
}

// holidayAllocationTable is one row per open registration of a week, with
// the criteria it meets, then one row per decision.
func holidayAllocationTable(period capability.HolidayPeriod, board capability.HolidayAllocationBoard, school func(int64) string) common.ListTable {
	criteria := make(map[int64]string, len(board.Criteria))
	for _, criterion := range board.Criteria {
		criteria[criterion.ID.Int64()] = criterion.Name
	}
	hosts := make(map[int64]string, len(period.Weeks))
	for _, week := range period.Weeks {
		hosts[week.ID.Int64()] = school(week.HostSchoolID.Int64())
	}
	var rows [][]string
	for _, week := range board.Weeks {
		for _, entry := range week.Pending {
			met := make([]string, 0, len(entry.Criteria))
			for _, value := range entry.Criteria {
				if value.Value == capability.HolidayCriterionYes {
					met = append(met, criteria[value.CriterionID.Int64()])
				}
			}
			rows = append(rows, []string{
				holidayWeekLabel(week.StartsOn, week.EndsOn), hosts[week.WeekID.Int64()], "Offen", strconv.Itoa(entry.Rank), entry.ChildLastName, entry.ChildFirstName,
				entry.TimeModelName, holidayPlacementLabels[entry.Proposal], "", strings.Join(met, ", "), "", holidayInstant(entry.SubmittedAt),
			})
		}
	}
	for _, decision := range board.Decisions {
		rows = append(rows, []string{
			holidayWeekLabel(decision.WeekStartsOn, decision.WeekEndsOn), hosts[decision.WeekID.Int64()], "Entschieden", strconv.Itoa(decision.Rank),
			decision.ChildLastName, decision.ChildFirstName, "", holidayPlacementLabels[decision.Proposal], holidayPlacementLabels[decision.Placement],
			strings.Join(decision.CriteriaMet, ", "), decision.Reason, holidayInstant(decision.DecidedAt),
		})
	}
	return common.ListTable{
		Title: "Vergabe nach Kriterien", Subtitle: period.Name, Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "week", Label: "Woche"}, {ID: "school", Label: "Schule"}, {ID: "kind", Label: "Art"}, {ID: "rank", Label: "Rang"},
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "time_model", Label: "Zeitmodell"},
			{ID: "proposal", Label: "Vorschlag"}, {ID: "placement", Label: "Entscheidung"}, {ID: "criteria", Label: "Kriterien"},
			{ID: "reason", Label: "Begründung"}, {ID: "time", Label: "Zeit"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter, Filename: "vergabe-" + period.Name,
	}
}
