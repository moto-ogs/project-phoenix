package timetablehttp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// templateWritePath matches the template writes that carry the read-state
// token of the series they edit (ADR 0311).
var templateWritePath = regexp.MustCompile(`^/templates/(\d+)(/split)?$`)

// withTemplateReadVersion gives a template update or split body that names
// no expected_version the version the editing read answers now, read through
// the API the editor reads it from: the period-free list for the series'
// period, then GET /templates/{id}?period_id=. A body that already names a
// version, any other request, and a series the reads do not find stay as
// they are, so the refusals that precede the read check keep their answer.
func withTemplateReadVersion(t *testing.T, router http.Handler, method, path string, body any) any {
	t.Helper()
	match := templateWritePath.FindStringSubmatch(path)
	if match == nil || (method == http.MethodPut) == (match[2] != "") || (method != http.MethodPut && method != http.MethodPost) {
		return body
	}
	fields, ok := templateBodyFields(t, body)
	if !ok {
		return body
	}
	if _, named := fields["expected_version"]; named {
		return body
	}
	periods := make([]string, 0, 2)
	if period, ok := fields["calendar_period_id"]; ok && period != nil {
		periods = append(periods, fmt.Sprint(period))
	}
	periods = append(periods, templatePeriodsFromList(t, router, match[1])...)
	// A series pinned to no period shows in the editing read of every
	// period, so any period id finds it.
	periods = append(periods, "1")
	for _, period := range periods {
		if version := templateVersionFromRead(t, router, match[1], period); version != "" {
			fields["expected_version"] = version
			return fields
		}
	}
	return body
}

// templateBodyFields copies a JSON object body into a map; any other body is
// not a template write the helper completes.
func templateBodyFields(t *testing.T, body any) (map[string]any, bool) {
	t.Helper()
	if body == nil {
		return nil, false
	}
	encoded, err := wire.Marshal(body)
	if err != nil {
		return nil, false
	}
	var fields map[string]any
	if json.Unmarshal(encoded, &fields) != nil || fields == nil {
		return nil, false
	}
	return fields, true
}

// templatePeriodsFromList reads the series' own period and its schedules'
// periods from the period-free list.
func templatePeriodsFromList(t *testing.T, router http.Handler, templateID string) []string {
	t.Helper()
	w := serveTemplateRead(router, "/templates")
	if w.Code != http.StatusOK {
		return nil
	}
	var env struct {
		Data struct {
			Templates []struct {
				ID               string  `json:"id"`
				CalendarPeriodID *string `json:"calendar_period_id"`
				Schedules        []struct {
					CalendarPeriodID *string `json:"calendar_period_id"`
				} `json:"schedules"`
			} `json:"templates"`
		} `json:"data"`
	}
	if json.Unmarshal(w.Body.Bytes(), &env) != nil {
		return nil
	}
	var periods []string
	for _, template := range env.Data.Templates {
		if template.ID != templateID {
			continue
		}
		for _, schedule := range template.Schedules {
			if schedule.CalendarPeriodID != nil {
				periods = append(periods, *schedule.CalendarPeriodID)
			}
		}
		if template.CalendarPeriodID != nil {
			periods = append(periods, *template.CalendarPeriodID)
		}
	}
	return periods
}

// templateVersionFromRead answers the version of the editing read, or ""
// when that read does not find the series in the period.
func templateVersionFromRead(t *testing.T, router http.Handler, templateID, period string) string {
	t.Helper()
	w := serveTemplateRead(router, fmt.Sprintf("/templates/%s?period_id=%s", templateID, period))
	if w.Code != http.StatusOK {
		return ""
	}
	var env struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if json.Unmarshal(w.Body.Bytes(), &env) != nil {
		return ""
	}
	return env.Data.Version
}

func serveTemplateRead(router http.Handler, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	testpkg.MountedQueryBudgetRouter("/api/timetable", router).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

// instanceReadVersion is the version the planner's list answers for a block
// on its date, the token an edit or a conversion of it sends.
func instanceReadVersion(t *testing.T, router http.Handler, date fmt.Stringer, instanceID int64) string {
	t.Helper()
	w := serveTemplateRead(router, fmt.Sprintf("/instances?from=%s&to=%s", date, date))
	if w.Code != http.StatusOK {
		t.Fatalf("read instances of %s: status %d body=%s", date, w.Code, w.Body.String())
	}
	listed := decodeTemplateData[weeklyInstancesResponse](t, w)
	for _, instance := range listed.Instances {
		if instance.ID.Int64() == instanceID {
			return instance.Version
		}
	}
	t.Fatalf("instance %d is not listed on %s", instanceID, date)
	return ""
}
