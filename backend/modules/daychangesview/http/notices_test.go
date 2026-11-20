package daychangesviewhttp_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type wireNotice struct {
	ID                      string `json:"id"`
	Title                   string `json:"title"`
	Body                    string `json:"body"`
	Priority                string `json:"priority"`
	RequiresAcknowledgement bool   `json:"requires_acknowledgement"`
	Acknowledged            bool   `json:"acknowledged"`
}

// noticeLines renders the notice entries as "section title [important]
// [open|confirmed] ->link", in the order of the answer.
func noticeLines(t *testing.T, body string) []string {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []struct {
				Kind    string      `json:"kind"`
				Section string      `json:"section"`
				Notice  *wireNotice `json:"notice"`
				Link    *struct {
					Target string `json:"target"`
				} `json:"link"`
			} `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []string{}
	for _, entry := range envelope.Data.Entries {
		if entry.Kind != "staff_notice" {
			continue
		}
		require.NotNil(t, entry.Notice)
		line := entry.Section + " " + entry.Notice.Title
		if entry.Notice.Priority == "important" {
			line += " wichtig"
		}
		if entry.Notice.RequiresAcknowledgement {
			if entry.Notice.Acknowledged {
				line += " bestätigt"
			} else {
				line += " offen"
			}
		}
		if entry.Link != nil {
			line += " ->" + entry.Link.Target
		}
		lines = append(lines, line)
	}
	return lines
}

func sourceStatus(overview wireOverview, source string) string {
	for _, status := range overview.Sources {
		if status.Source == source {
			return status.Status
		}
	}
	return "missing"
}

// writeNotice sends one request to Timetable's notice routes and returns the
// id of the notice it answers with, if any.
func writeNotice(t *testing.T, router chi.Router, path string, accountID, tenantID int64, payload any, perms ...string) string {
	t.Helper()
	return sendNotice(t, router, http.MethodPost, path, accountID, tenantID, payload, perms...)
}

func sendNotice(t *testing.T, router chi.Router, method, path string, accountID, tenantID int64, payload any, perms ...string) string {
	t.Helper()
	raw, err := json.Marshal(payload)
	require.NoError(t, err)
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, testutil.TenantUserTestClaims(int(accountID), tenantID, perms...)))
	rec := testutil.ExecuteRequestForTest(t, router, req)
	require.Less(t, rec.Code, 300, rec.Body.String())
	var envelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &envelope)
	return envelope.Data.ID
}

type noticeInput struct {
	Title                   string  `json:"title"`
	Body                    string  `json:"body"`
	Priority                string  `json:"priority"`
	Audience                string  `json:"audience"`
	ValidFrom               string  `json:"valid_from"`
	ValidUntil              *string `json:"valid_until,omitempty"`
	Weekdays                []int16 `json:"weekdays"`
	RequiresAcknowledgement bool    `json:"requires_acknowledgement"`
	Active                  bool    `json:"active"`
}

func until(days int) *string {
	value := day.AddDays(days).String()
	return &value
}

// TestDayChangesNoticeSource is Seam 1 for the Hinweise der Leitung: the
// leadership writes the notices over Timetable's routes, the overview reads
// them through its route, and a confirmation over the existing write path
// moves a notice from "Betrifft dich" to "Schule".
func TestDayChangesNoticeSource(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, leadAccount := testpkg.CreateTestStaffWithAccount(t, db, "Lea", "Leitung")
	_, carerAccount := testpkg.CreateTestStaffWithAccount(t, db, "Anna", "Betreuung")
	_, plainAccount := testpkg.CreateTestStaffWithAccount(t, db, "Zoe", "Ohne")
	notices, signals := api.NewDayChangesNoticeTestRouter(testpkg.NewDatabase(t, db), tenantID, day)
	create := func(input noticeInput) string {
		input.Active = true
		if input.Audience == "" {
			input.Audience = "all"
		}
		if input.Priority == "" {
			input.Priority = "info"
		}
		return writeNotice(t, notices, "/api/staff-notices/", leadAccount.ID, tenantID, input, "admin:*")
	}

	// 2026-09-09 is a Wednesday (ISO weekday 3).
	confirm := create(noticeInput{Title: "Elternabend", Body: "Bitte Stühle stellen.", Priority: "important",
		ValidFrom: day.String(), ValidUntil: until(0), Weekdays: []int16{3}, RequiresAcknowledgement: true})
	create(noticeInput{Title: "Baustelle", ValidFrom: day.AddDays(-3).String(), ValidUntil: until(3)})
	create(noticeInput{Title: "Abgelaufen", ValidFrom: day.AddDays(-5).String(), ValidUntil: until(-1)})
	create(noticeInput{Title: "Donnerstags", ValidFrom: day.AddDays(-7).String(), Weekdays: []int16{4}})
	teachersOnly := noticeInput{Title: "Nur Lehrkräfte", ValidFrom: day.String(), Audience: "lehrkraft"}
	teachersID := create(teachersOnly)
	teachersOnly.Active, teachersOnly.Priority, teachersOnly.Body = true, "info", "Geändert"
	sendNotice(t, notices, http.MethodPut, "/api/staff-notices/"+teachersID, leadAccount.ID, tenantID, teachersOnly, "admin:*")
	sendNotice(t, notices, http.MethodDelete, "/api/staff-notices/"+teachersID, leadAccount.ID, tenantID, nil, "admin:*")
	t.Run("other school", func(t *testing.T) {
		testpkg.OwnTenant(t)
		_, foreignLead := testpkg.CreateTestStaffWithAccount(t, db, "Xaver", "Fremd")
		writeNotice(t, notices, "/api/staff-notices/", foreignLead.ID, testpkg.Tenant(t), noticeInput{
			Title: "Fremde Schule", Priority: "info", Audience: "all", ValidFrom: day.String(), Active: true,
		}, "admin:*")
	})

	t.Run("a new or changed notice wakes the overview without content", func(t *testing.T) {
		sources, content := signals()
		assert.Equal(t, []string{
			"staff_notice_create", "staff_notice_create", "staff_notice_create", "staff_notice_create", "staff_notice_create",
			"staff_notice_update", "staff_notice_delete",
		}, sources, "one signal per write of the school's notices, after its commit")
		assert.False(t, content, "the signal carries nothing but its source")
	})

	router := newRouter(t, db, day)

	t.Run("today's notices, the open one first under Betrifft dich", func(t *testing.T) {
		overview, body := read(t, router, carerAccount.ID, tenantID, "users:read")
		assert.Equal(t, "loaded", sourceStatus(overview, "notices"))
		assert.Equal(t, []string{
			"you Elternabend wichtig offen ->staff_notices",
			"school Baustelle ->staff_notices",
		}, noticeLines(t, body))
		assert.Contains(t, body, "Bitte Stühle stellen.")
		for _, hidden := range []string{"Abgelaufen", "Donnerstags", "Nur Lehrkräfte", "Fremde Schule"} {
			assert.NotContains(t, body, hidden)
		}
	})

	t.Run("confirming over the existing write path moves the notice to Schule", func(t *testing.T) {
		writeNotice(t, notices, "/api/staff-notices/"+confirm+"/acknowledge", carerAccount.ID, tenantID, map[string]any{}, "users:read")
		sources, content := signals()
		assert.Equal(t, []string{"staff_notice_acknowledge"}, sources,
			"a confirmation wakes the overview after its commit")
		assert.False(t, content, "the signal carries nothing but its source")
		_, body := read(t, router, carerAccount.ID, tenantID, "users:read")
		assert.ElementsMatch(t, []string{
			"school Elternabend wichtig bestätigt ->staff_notices",
			"school Baustelle ->staff_notices",
		}, noticeLines(t, body))
		_, leadBody := read(t, router, leadAccount.ID, tenantID, "admin:*")
		assert.Contains(t, noticeLines(t, leadBody), "school Elternabend wichtig bestätigt ->staff_notices",
			"the author's own acknowledgement is stamped on saving")
	})

	t.Run("an account without users:read gets no notices and no failure", func(t *testing.T) {
		overview, body := read(t, router, plainAccount.ID, tenantID)
		assert.Empty(t, noticeLines(t, body))
		assert.Equal(t, "loaded", sourceStatus(overview, "notices"))
	})

	t.Run("the day before shows that day's notices only", func(t *testing.T) {
		_, body := read(t, newRouter(t, db, day.AddDays(-1)), carerAccount.ID, tenantID, "users:read")
		assert.ElementsMatch(t, []string{"school Abgelaufen ->staff_notices", "school Baustelle ->staff_notices"}, noticeLines(t, body))
	})
}
