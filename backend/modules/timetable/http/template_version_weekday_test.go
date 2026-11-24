package timetablehttp

import (
	"fmt"
	"net/http"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ADR 0311: the weekday rows of a series in a planning period belong to the
// state its editor saves back. A child moved from Monday to Wednesday since
// the read leaves the series' combined roster as it was, yet the editor's
// stale weekday_assignments would put the child back on Monday: the save is
// refused and writes nothing; the version of a fresh read saves.
func TestTemplateUpdateRefusesAWeekdayMoveSinceItsRead(t *testing.T) {
	t.Parallel()

	s := buildTemplateModule(t, &mockMaterializationService{result: &timetable.MaterializationResult{}}, fixedTemplateClock)
	defer s.cleanupFn()
	router := templateRouter(s.ctx, s.res, s.db)
	period := createTemplateTestPeriod(t, s.db, "Tpl-Wochentag-Stand")

	body := func(name string, monday, wednesday []int64) map[string]any {
		b := createTemplateBody(s, name)
		b["calendar_period_id"] = fmt.Sprint(period.ID)
		b["student_ids"] = []string{fmt.Sprint(s.studentA), fmt.Sprint(s.studentB)}
		b["weekday_assignments"] = []map[string]any{
			{"weekday": timetable.WeekdayMonday, "staff_ids": []string{fmt.Sprint(s.staffA), fmt.Sprint(s.staffB)}, "student_ids": testpkg.IDsOf[testpkg.ID](monday), "primary_staff_id": fmt.Sprint(s.staffB)},
			{"weekday": timetable.WeekdayWednesday, "staff_ids": []string{fmt.Sprint(s.staffA), fmt.Sprint(s.staffB)}, "student_ids": testpkg.IDsOf[testpkg.ID](wednesday), "primary_staff_id": fmt.Sprint(s.staffB)},
		}
		return b
	}
	w := doTemplateJSON(t, router, http.MethodPost, "/templates", body("Tpl-Wochentag", []int64{s.studentA}, []int64{s.studentB}))
	require.Equal(t, http.StatusCreated, w.Code, "body=%s", w.Body.String())
	templateID := decodeTemplateData[createTemplateResponse](t, w).TemplateID.Int64()
	path := fmt.Sprintf("/templates/%d", templateID)

	read := func() templateResponse {
		w := doTemplateJSON(t, router, http.MethodGet, fmt.Sprintf("%s?period_id=%d", path, period.ID), nil)
		require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())
		return decodeTemplateData[templateResponse](t, w)
	}
	opened := read()
	require.NotEmpty(t, opened.Version)
	require.Len(t, opened.WeekdayAssignments, 2)
	require.Equal(t, []ident.ID{ident.ID(s.studentA)}, opened.WeekdayAssignments[0].StudentIDs)

	// Another writer moves child A from Monday to Wednesday.
	_, err := s.db.NewRaw(`UPDATE activities.student_enrollments SET weekday = ?
		WHERE activity_group_id = ? AND student_id = ? AND weekday = ? AND valid_until IS NULL`,
		timetable.WeekdayWednesday, templateID, s.studentA, timetable.WeekdayMonday).Exec(s.ctx)
	require.NoError(t, err)
	moved := read()
	require.Equal(t, []ident.ID{ident.ID(s.studentA), ident.ID(s.studentB)}, moved.WeekdayAssignments[1].StudentIDs)
	require.Equal(t, opened.StudentIDs, moved.StudentIDs, "the combined roster stays as it was")

	stale := body("Tpl-Wochentag-Umbenannt", []int64{s.studentA}, []int64{s.studentB})
	stale["expected_version"] = opened.Version
	w = doTemplateJSON(t, router, http.MethodPut, path, stale)
	require.Equal(t, http.StatusConflict, w.Code, "body=%s", w.Body.String())
	assert.Contains(t, w.Body.String(), `"code":"general.changed_since_read"`)
	after := read()
	assert.Equal(t, "Tpl-Wochentag", after.Name, "the refused save wrote nothing")
	assert.Equal(t, moved.WeekdayAssignments, after.WeekdayAssignments, "child A stays on Wednesday")

	current := body("Tpl-Wochentag-Umbenannt", []int64{}, []int64{s.studentA, s.studentB})
	current["expected_version"] = after.Version
	w = doTemplateJSON(t, router, http.MethodPut, path, current)
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())
}
