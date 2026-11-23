//go:build testhooks

package worktimemodels_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// assignmentToday is the school day every assignment test runs on.
const assignmentToday = "2026-10-14"

func assignmentClock() time.Time {
	return calendar.NewDate(2026, time.October, 14).BerlinMidnight().Add(10 * time.Hour)
}

type assignmentFact struct {
	StaffID           testpkg.ID  `json:"staff_id"`
	WorkTimeModelID   *testpkg.ID `json:"work_time_model_id"`
	HasSchedule       bool        `json:"has_schedule"`
	SollKeptByTraeger bool        `json:"soll_kept_by_traeger"`
	ClosedThrough     *string     `json:"closed_through"`
}

type assignmentResult struct {
	Assigned  []testpkg.ID `json:"assigned_staff_ids"`
	Unchanged []testpkg.ID `json:"unchanged_staff_ids"`
	ValidFrom string       `json:"valid_from"`
}

type scheduleVersion struct {
	TargetMinutes int            `bun:"target_minutes"`
	ValidFrom     calendar.Date  `bun:"valid_from"`
	ValidUntil    *calendar.Date `bun:"valid_until"`
}

type assignmentHarness struct {
	t        *testing.T
	db       *bun.DB
	models   workforceCompose.WorkTime
	router   chi.Router
	notified int
}

func newAssignmentHarness(t *testing.T, db *bun.DB) *assignmentHarness {
	t.Helper()
	models := api.NewAbsenceTypeTestCapability(testpkg.NewDatabase(t, db), assignmentClock)
	harness := &assignmentHarness{t: t, db: db, models: models}
	harness.router = testpkg.MountedQueryBudgetRouter("/api/work-time-models",
		api.NewWorkTimeModelsRouterForBudgetTest(models, func(context.Context) { harness.notified++ }))
	return harness
}

func (h *assignmentHarness) request(method, path string, body any) (int, json.RawMessage, string) {
	h.t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.Permissions = []string{"time_tracking:manage"}
	claims.IsAdmin = false
	request := testutil.NewAuthenticatedRequest(h.t, method, path, body, testutil.WithJWTBearer(testutil.MintTestJWT(h.t, claims)))
	recorder := testutil.ExecuteRequestForTest(h.t, h.router, request)
	var envelope struct {
		Data json.RawMessage `json:"data"`
		Code string          `json:"code"`
	}
	require.NoError(h.t, json.Unmarshal(recorder.Body.Bytes(), &envelope), recorder.Body.String())
	return recorder.Code, envelope.Data, envelope.Code
}

func (h *assignmentHarness) model(name string, fields workforce.WorkTimeModelFields) workforce.WorkTimeModel {
	h.t.Helper()
	fields.Name = name
	model, err := h.models.CreateWorkTimeModel(testpkg.Ctx(h.t), workforce.CreateWorkTimeModel{WorkTimeModelFields: fields})
	require.NoError(h.t, err)
	testpkg.OwnTestWorkTimeModel(h.t, h.db, model.ID)
	return model
}

func (h *assignmentHarness) assign(modelID int64, validFrom string, staffIDs ...int64) (int, assignmentResult, string) {
	h.t.Helper()
	status, data, code := h.request(http.MethodPost, fmt.Sprintf("/%d/assignments", modelID), map[string]any{"staff_ids": staffIDs, "valid_from": validFrom})
	var result assignmentResult
	if status == http.StatusOK {
		require.NoError(h.t, json.Unmarshal(data, &result))
	}
	return status, result, code
}

func (h *assignmentHarness) facts() map[int64]assignmentFact {
	h.t.Helper()
	status, data, _ := h.request(http.MethodGet, "/staff-facts", nil)
	require.Equal(h.t, http.StatusOK, status)
	var rows []assignmentFact
	require.NoError(h.t, json.Unmarshal(data, &rows))
	byStaff := make(map[int64]assignmentFact, len(rows))
	for _, row := range rows {
		byStaff[int64(row.StaffID)] = row
	}
	return byStaff
}

func (h *assignmentHarness) versions(staffID int64) []scheduleVersion {
	h.t.Helper()
	var rows []scheduleVersion
	require.NoError(h.t, h.db.NewSelect().TableExpr("config.staff_work_schedules").
		Column("target_minutes", "valid_from", "valid_until").
		Where("staff_id = ?", staffID).OrderExpr("valid_from, day_of_week, week_index").Scan(context.Background(), &rows))
	return rows
}

func (h *assignmentHarness) binding(staffID int64) (modelID *int64, anchor *calendar.Date) {
	h.t.Helper()
	require.NoError(h.t, h.db.NewRaw(`SELECT work_time_model_id, rotation_anchor_date FROM users.staff_employment_profiles WHERE membership_id = ?`, staffID).
		Scan(context.Background(), &modelID, &anchor))
	return modelID, anchor
}

// One request binds a template to several people (#6921): new people get
// the template's Soll from today, a running custom schedule is closed at
// today, people already on the template keep theirs, and the time accounts
// are invalidated once.
func TestWorkTimeModelAssignmentBindsSeveralPeopleFromToday(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	h := newAssignmentHarness(t, db)
	template := h.model("Teilzeit A/B", budgetWorkTimeModelFields("", 1))
	fresh := testpkg.CreateTestStaff(t, db, "Assign", "Fresh")
	custom := testpkg.CreateTestStaff(t, db, "Assign", "Custom")
	already := testpkg.CreateTestStaff(t, db, "Assign", "Already")
	bindToModel(t, db, already.ID, template.ID)
	require.NoError(t, h.models.ReplaceStaffSchedule(testpkg.Ctx(t), workforce.ReplaceStaffSchedule{
		StaffID: custom.ID, ValidFrom: "2026-09-01",
		Entries: []workforce.StaffWorkScheduleEntry{{WeekIndex: 0, RotationLength: 1, DayOfWeek: 0, TargetMinutes: 480}},
	}))

	facts := h.facts()
	assert.True(t, facts[custom.ID].HasSchedule, "a running schedule is reported")
	require.NotNil(t, facts[already.ID].WorkTimeModelID)
	assert.Equal(t, template.ID, int64(*facts[already.ID].WorkTimeModelID))
	assert.NotContains(t, facts, fresh.ID, "a person without any fact is absent")

	status, result, _ := h.assign(template.ID, "", custom.ID, fresh.ID, already.ID, fresh.ID)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, sortedIDs(fresh.ID, custom.ID), testpkg.IDs(result.Assigned))
	assert.Equal(t, []int64{already.ID}, testpkg.IDs(result.Unchanged))
	assert.Equal(t, assignmentToday, result.ValidFrom)
	assert.Equal(t, 1, h.notified)

	for _, staffID := range []int64{fresh.ID, custom.ID} {
		modelID, anchor := h.binding(staffID)
		require.NotNil(t, modelID)
		assert.Equal(t, template.ID, *modelID)
		require.NotNil(t, anchor)
		assert.Equal(t, calendar.Date("2026-10-26"), *anchor, "the staff anchor is the template's")
	}
	freshVersions := h.versions(fresh.ID)
	require.Len(t, freshVersions, 3, "the template's three entries")
	for _, version := range freshVersions {
		assert.Equal(t, calendar.Date(assignmentToday), version.ValidFrom)
		assert.Nil(t, version.ValidUntil)
	}
	customVersions := h.versions(custom.ID)
	require.Len(t, customVersions, 4)
	assert.Equal(t, 480, customVersions[0].TargetMinutes)
	require.NotNil(t, customVersions[0].ValidUntil, "the custom version ends where the template starts")
	assert.Equal(t, calendar.Date(assignmentToday), *customVersions[0].ValidUntil)
	assert.Empty(t, h.versions(already.ID), "a person already on the template is not rewritten")

	status, result, _ = h.assign(template.ID, "", already.ID)
	require.Equal(t, http.StatusOK, status)
	assert.Empty(t, result.Assigned)
	assert.Equal(t, 1, h.notified, "no Soll changed, so no time account is invalidated")
}

// A start before today is the rule of a first own schedule (#3892) for
// everybody in the request: only people without any schedule, never inside a
// closed month. One person who does not allow it refuses the whole request.
func TestWorkTimeModelAssignmentStartsEarlierOnlyForFirstSchedules(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	h := newAssignmentHarness(t, db)
	template := h.model("Vollzeit", budgetWorkTimeModelFields("", 1))
	first := testpkg.CreateTestStaff(t, db, "Early", "First")
	second := testpkg.CreateTestStaff(t, db, "Early", "Second")
	closed := testpkg.CreateTestStaff(t, db, "Early", "Closed")
	_, err := db.NewRaw(`INSERT INTO active.staff_month_balance_snapshots (tenant_id, staff_id, year, month, closing_balance_minutes, closed_by) VALUES (?, ?, 2026, 9, 0, ?)`,
		testpkg.Tenant(t), closed.ID, closed.ID).Exec(context.Background())
	require.NoError(t, err)

	fact := h.facts()[closed.ID]
	require.NotNil(t, fact.ClosedThrough)
	assert.Equal(t, "2026-09", *fact.ClosedThrough)

	status, _, _ := h.assign(template.ID, "2026-09-15", first.ID, closed.ID)
	assert.Equal(t, http.StatusBadRequest, status, "a start inside a closed month")
	assert.Empty(t, h.versions(first.ID), "the refused request wrote nothing for anybody")
	status, _, _ = h.assign(template.ID, "2026-10-15", first.ID)
	assert.Equal(t, http.StatusBadRequest, status, "a start after today")

	status, result, _ := h.assign(template.ID, "2026-10-01", first.ID, closed.ID)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "2026-10-01", result.ValidFrom)
	for _, version := range h.versions(first.ID) {
		assert.Equal(t, calendar.Date("2026-10-01"), version.ValidFrom)
	}

	other := h.model("Minijob", budgetWorkTimeModelFields("", 1))
	status, _, _ = h.assign(other.ID, "2026-10-05", first.ID, second.ID)
	assert.Equal(t, http.StatusBadRequest, status, "first now has a schedule, so no earlier start for the request")
	assert.Empty(t, h.versions(second.ID))
}

// Archived templates, people of other schools, offboarded people and other
// schools' templates are refused before anything is written.
func TestWorkTimeModelAssignmentRefusals(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	h := newAssignmentHarness(t, db)
	template := h.model("Archiviert", budgetWorkTimeModelFields("", 1))
	staff := testpkg.CreateTestStaff(t, db, "Refused", "Staff")
	_, err := h.models.ArchiveWorkTimeModel(testpkg.Ctx(t), template.ID)
	require.NoError(t, err)

	status, _, code := h.assign(template.ID, "", staff.ID)
	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "workforce.work_time_model_archived", code)

	offered := h.model("Angeboten", budgetWorkTimeModelFields("", 1))
	foreign := testpkg.NewTenantScope(t, db)
	foreignStaff := testpkg.CreateTestStaffForTenant(t, db, foreign.TenantID, "Foreign", "Staff")
	retired := testpkg.CreateTestStaff(t, db, "Refused", "Retired")
	_, err = db.NewRaw(`UPDATE users.staff_school_memberships SET deleted_at = now() WHERE id = ?`, retired.ID).Exec(context.Background())
	require.NoError(t, err)
	for name, staffID := range map[string]int64{"other school": foreignStaff.ID, "offboarded": retired.ID, "unknown": 1 << 40} {
		status, _, _ = h.assign(offered.ID, "", staff.ID, staffID)
		assert.Equal(t, http.StatusNotFound, status, name)
	}
	foreignModel, err := h.models.CreateWorkTimeModel(foreign.Context(), workforce.CreateWorkTimeModel{WorkTimeModelFields: budgetWorkTimeModelFields("Fremd", 1)})
	require.NoError(t, err)
	testpkg.OwnTestWorkTimeModel(t, db, foreignModel.ID)
	status, _, _ = h.assign(foreignModel.ID, "", staff.ID)
	assert.Equal(t, http.StatusNotFound, status, "another school's template")
	for name, body := range map[string]any{
		"no people":     map[string]any{"staff_ids": []int64{}},
		"malformed day": map[string]any{"staff_ids": []int64{staff.ID}, "valid_from": "14.10.2026"},
	} {
		status, _, _ = h.request(http.MethodPost, fmt.Sprintf("/%d/assignments", offered.ID), body)
		assert.Equal(t, http.StatusBadRequest, status, name)
	}
	assert.Empty(t, h.versions(staff.ID))
	modelID, _ := h.binding(staff.ID)
	assert.Nil(t, modelID, "nothing was bound")
	assert.Zero(t, h.notified)
}

// The dialog's read costs the same statements for one person as for many.
func TestWorkTimeModelAssignmentFactsQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	h := newAssignmentHarness(t, db)
	template := h.model("Budget", budgetWorkTimeModelFields("", 1))
	counter := testpkg.CaptureQueries(t, db)
	previous := 0
	for _, people := range []int{1, 4} {
		for index := previous; index < people; index++ {
			staff := testpkg.CreateTestStaff(t, db, "Facts", fmt.Sprintf("Person %d", index))
			bindToModel(t, db, staff.ID, template.ID)
		}
		counter.Reset()
		facts := h.facts()
		queries := counter.Measurement(counter.Queries())
		assert.Len(t, facts, people)
		require.Zero(t, counter.WriteRows(), "the read writes nothing")
		querybudgets.AssertQueryBudget(t, "api.workforce.work_time_models.staff_facts", queries)
		previous = people
	}
}

func sortedIDs(a, b int64) []int64 {
	if a < b {
		return []int64{a, b}
	}
	return []int64{b, a}
}

// The bulk write costs the same statements for one person as for four. Only
// the locks are per person, as the issue asks: the balance gate, the staff
// row and its employment profile, taken ascending.
func TestWorkTimeModelAssignmentQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	h := newAssignmentHarness(t, db)
	counter := testpkg.CaptureQueries(t, db)
	for _, people := range []int{1, 4} {
		template := h.model(fmt.Sprintf("Budget %d", people), budgetWorkTimeModelFields("", 1))
		staffIDs := make([]int64, 0, people)
		for index := range people {
			staffIDs = append(staffIDs, testpkg.CreateTestStaff(t, db, "Bulk", fmt.Sprintf("%d-%d", people, index)).ID)
		}
		counter.Reset()
		status, result, _ := h.assign(template.ID, "", staffIDs...)
		require.Equal(t, http.StatusOK, status)
		require.Len(t, result.Assigned, people)
		locks := counter.Matching(isPersonLock)
		assert.Len(t, locks, 3*people, "three locks per person: balance gate, staff row, employment profile")
		shared := counter.Matching(func(sql string) bool { return !isPersonLock(sql) })
		querybudgets.AssertQueryBudget(t, "api.workforce.work_time_models.assign", counter.Measurement(shared))
	}
}

// isPersonLock names the statements a single person's lock costs.
func isPersonLock(sql string) bool {
	return strings.Contains(sql, "pg_advisory_xact_lock") ||
		strings.Contains(sql, "for no key update") ||
		(strings.HasPrefix(sql, "select") && strings.Contains(sql, `"profile"."staff_notes"`))
}
