package timetracking

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/workforce"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// overviewErrorRules classifies the overview sentinels (#1417): caller
// mistakes → 400. ErrAccountStartTooOld stays a 500 on purpose — it means the
// tenant's account-start setting is misconfigured, the same way the per-staff
// Monatskarte fails.
var overviewErrorRules = []common.ErrorRule{
	{Target: workforce.ErrOverviewInvalid, Render: common.ErrorInvalidRequest},
}

func renderOverviewError(w http.ResponseWriter, r *http.Request, err error) {
	common.RenderError(w, r, common.RenderWithRules(err, overviewErrorRules, common.ErrorInternalServer))
}

// parseDashboardPeriod validates ?period=. Empty means month.
func parseDashboardPeriod(r *http.Request) (string, error) {
	period := r.URL.Query().Get("period")
	switch period {
	case "", workforce.OverviewPeriodMonth:
		return workforce.OverviewPeriodMonth, nil
	case workforce.OverviewPeriodWeek:
		return workforce.OverviewPeriodWeek, nil
	default:
		return "", errors.New("period must be week or month")
	}
}

// parseOverviewFilters reads the list filters. saldo_min/saldo_max are pointers
// so "0" stays distinguishable from "not set"; negative values are valid (a
// minus balance is a normal state). Unknown sort keys and employment types are
// rejected in the service rather than silently defaulted.
func parseOverviewFilters(r *http.Request) (workforce.OverviewFilters, error) {
	query := r.URL.Query()
	filters := workforce.OverviewFilters{
		EmploymentType: query.Get("employment_type"),
		SortBy:         query.Get("sort"),
	}
	switch order := query.Get("order"); order {
	case "", "asc":
	case "desc":
		filters.Descending = true
	default:
		return filters, errors.New("order must be asc or desc")
	}
	var err error
	filters.Year, filters.Month, err = parseOverviewPeriod(query.Get("year"), query.Get("month"))
	if err != nil {
		return filters, err
	}
	for _, bound := range []struct {
		name   string
		target **int
	}{
		{"saldo_min", &filters.SaldoMin},
		{"saldo_max", &filters.SaldoMax},
	} {
		raw := query.Get(bound.name)
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil {
			return filters, errors.New(bound.name + " must be an integer number of minutes")
		}
		*bound.target = &value
	}
	return filters, nil
}

// parseOverviewPeriod reads the optional year and month as a pair.
func parseOverviewPeriod(rawYear, rawMonth string) (int, int, error) {
	if rawYear == "" && rawMonth == "" {
		return 0, 0, nil
	}
	if rawYear == "" || rawMonth == "" {
		return 0, 0, errors.New("year and month must be given together")
	}
	year, err := strconv.Atoi(rawYear)
	if err != nil {
		return 0, 0, errors.New("year must be an integer")
	}
	month, err := strconv.Atoi(rawMonth)
	if err != nil {
		return 0, 0, errors.New("month must be an integer")
	}
	if year == 0 || month == 0 {
		return 0, 0, errors.New("year and month must be greater than zero")
	}
	return year, month, nil
}

// getDashboardSummary handles GET /api/staff/dashboard-summary?period=week|month
func (rs *StaffAdminResource) getDashboardSummary(w http.ResponseWriter, r *http.Request) {
	period, err := parseDashboardPeriod(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	summary, err := rs.StaffOverviewService.DashboardSummary(r.Context(), period)
	if err != nil {
		renderOverviewError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, summary, "Dashboard summary retrieved")
}

// getTimeTrackingOverview handles GET /api/staff/time-tracking/overview
func (rs *StaffAdminResource) getTimeTrackingOverview(w http.ResponseWriter, r *http.Request) {
	filters, err := parseOverviewFilters(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	overview, err := rs.StaffOverviewService.TimeTrackingOverview(r.Context(), filters)
	if err != nil {
		renderOverviewError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, overview, "Time tracking overview retrieved")
}

// getTargetCoverage handles GET /api/staff/time-tracking/target-coverage with
// the overview's optional year/month pair.
func (rs *StaffAdminResource) getTargetCoverage(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	year, month, err := parseOverviewPeriod(query.Get("year"), query.Get("month"))
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	coverage, err := rs.StaffOverviewService.TargetCoverage(r.Context(), year, month)
	if err != nil {
		renderOverviewError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, coverage, "Target coverage retrieved")
}
