package traegerviewhttp

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// comparison answers GET /traeger/schools/comparison?from=&to=&schools=: the
// key figures of the chosen schools of the Träger side by side, with their
// average and their figure together (#4715, ADR 0245). The answer holds
// counts only, so the read is not written to the access log (ADR 0084
// section 7).
func (rs *Resource) comparison(w http.ResponseWriter, r *http.Request) {
	comparison, ok := rs.readComparison(w, r)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, comparison, "School comparison retrieved successfully")
}

// comparisonExport answers GET /traeger/schools/comparison/export: the same
// comparison as PDF, Excel or CSV (format=, CSV without one; #4718), one row
// per school, then the average and the figure together. metrics=a,b keeps
// those figures in that order; without it the file holds every figure.
func (rs *Resource) comparisonExport(w http.ResponseWriter, r *http.Request) {
	format, err := common.ParseListFormat(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	metrics, err := comparisonMetrics(r.URL.Query().Get("metrics"))
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	comparison, ok := rs.readComparison(w, r)
	if !ok {
		return
	}
	common.WriteList(w, r, rs.lists, format, comparisonTable(comparison, metrics))
}

func (rs *Resource) readComparison(w http.ResponseWriter, r *http.Request) (traegerview.SchoolComparison, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.SchoolComparison{}, false
	}
	from, to, err := utilizationWindow(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return traegerview.SchoolComparison{}, false
	}
	schools, err := comparisonSchools(r.URL.Query().Get("schools"))
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return traegerview.SchoolComparison{}, false
	}
	comparison, err := rs.reports.SchoolComparison(r.Context(), principal.OrganizationID(),
		traegerview.ComparisonFilter{From: from, To: to, SchoolIDs: schools})
	switch {
	case errors.Is(err, traegerview.ErrSchoolOutsideTraeger):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerSchoolNotFound))
	case errors.Is(err, traegerview.ErrInvalidUtilizationWindow):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		return comparison, true
	}
	return traegerview.SchoolComparison{}, false
}

// comparisonSchools reads the optional comma-separated school IDs.
func comparisonSchools(raw string) ([]int64, error) {
	if raw == "" {
		return nil, nil
	}
	var ids []int64
	for part := range strings.SplitSeq(raw, ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || id <= 0 {
			return nil, errors.New("schools must be positive IDs separated by commas")
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// comparisonMetrics reads the optional comma-separated figure keys; none
// keeps every figure.
func comparisonMetrics(raw string) ([]string, error) {
	if raw == "" {
		return traegerview.ComparisonKeys, nil
	}
	var keys []string
	for key := range strings.SplitSeq(raw, ",") {
		key = strings.TrimSpace(key)
		if !slices.Contains(traegerview.ComparisonKeys, key) {
			return nil, fmt.Errorf("unknown metric %q", key)
		}
		if !slices.Contains(keys, key) {
			keys = append(keys, key)
		}
	}
	return keys, nil
}

// comparisonColumn is the CSV head of a figure and how its value is written.
type comparisonColumn struct {
	head    string
	decimal bool
	percent bool
}

var comparisonColumns = map[string]comparisonColumn{
	traegerview.ComparisonPlaces:         {head: "Plätze"},
	traegerview.ComparisonPlacesRate:     {head: "Plätze belegt (%)", decimal: true, percent: true},
	traegerview.ComparisonFreePlaces:     {head: "Freie Plätze (Ø je Tag)", decimal: true},
	traegerview.ComparisonBooked:         {head: "Kinder gebucht (Ø je Tag)", decimal: true},
	traegerview.ComparisonBookedChange:   {head: "Veränderung gebucht"},
	traegerview.ComparisonPresent:        {head: "Kinder anwesend (Ø je Tag)", decimal: true},
	traegerview.ComparisonPresentPeak:    {head: "Höchstens anwesend"},
	traegerview.ComparisonActiveStudents: {head: "Aktive Kinder am Stichtag"},
}

// The names of the two rows under the schools.
const (
	comparisonRowAverage  = "Schnitt je Schule"
	comparisonRowTogether = "Alle zusammen"
)

// comparisonTable is one row per school, then the average and the figure
// together. A missing figure stays empty, so a spreadsheet never reads a gap
// as 0; decimals carry a comma, as German spreadsheets expect.
func comparisonTable(comparison traegerview.SchoolComparison, metrics []string) common.ListTable {
	columns := []common.ListColumn{{ID: "school", Label: "Schule"}, {ID: "city", Label: "Ort"}}
	for _, key := range metrics {
		columns = append(columns, common.ListColumn{ID: key, Label: comparisonColumns[key].head})
	}
	row := func(name, city string, values traegerview.ComparisonValues) []string {
		line := []string{name, city}
		for _, key := range metrics {
			line = append(line, comparisonValue(comparisonColumns[key], values, key))
		}
		return line
	}
	rows := make([][]string, 0, len(comparison.Schools)+2)
	names := make([]string, 0, len(comparison.Schools))
	for _, school := range comparison.Schools {
		rows = append(rows, row(school.Name, school.City, school.Values))
		names = append(names, school.Name)
	}
	rows = append(rows, row(comparisonRowAverage, "", comparison.Average), row(comparisonRowTogether, "", comparison.Together))
	from, to := comparison.From.Format("02.01.2006"), comparison.To.Format("02.01.2006")
	return common.ListTable{
		Title: "Standortvergleich", Subtitle: from + " bis " + to,
		Filters: []string{"Schulen: " + strings.Join(names, ", "), common.ListPeriodLabel(from, to)},
		Columns: columns, Rows: rows,
		Filename: fmt.Sprintf("standortvergleich-%s-bis-%s", comparison.From, comparison.To),
	}
}

func comparisonValue(column comparisonColumn, values traegerview.ComparisonValues, key string) string {
	value, ok := values[key]
	if !ok {
		return ""
	}
	if column.percent {
		value *= 100
	}
	// A value that rounds to zero is written without a sign, never "-0,0".
	if math.Abs(value) < 0.05 {
		value = 0
	}
	// A count stays whole; its average over schools may not be.
	if !column.decimal && value == math.Trunc(value) {
		return strconv.FormatFloat(value, 'f', 0, 64)
	}
	return strings.Replace(strconv.FormatFloat(value, 'f', 1, 64), ".", ",", 1)
}
