package api

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentHTTP "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// The parents' writes the catalog proxy forwards since #2352, through the
// /parent mount on a real database.

// A guardian switches one notification on and every notification off.
func TestParentPortalNotificationChoicesAnswerThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)

	var overview parentHTTP.ParentPreferenceOverview
	r.call(t, http.MethodGet, "/parent/me/notification-preferences", f.token, nil, &overview)
	require.NotEmpty(t, overview.Types, "the guardians' catalogue")
	key := overview.Types[0].Key
	enabled := func() bool {
		t.Helper()
		overview = parentHTTP.ParentPreferenceOverview{}
		r.call(t, http.MethodGet, "/parent/me/notification-preferences", f.token, nil, &overview)
		for _, choice := range overview.Types {
			if choice.Key == key {
				return choice.Enabled
			}
		}
		t.Fatalf("type %s left the catalogue", key)
		return false
	}

	rec := r.call(t, http.MethodPut, "/parent/me/notification-preferences/"+key, f.token, map[string]any{"enabled": true}, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.True(t, enabled(), "the choice is stored")
	rec = r.call(t, http.MethodDelete, "/parent/me/notification-preferences", f.token, nil, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.False(t, enabled(), "every notification is off")
}

// A guardian books a slot of the class's Elternsprechtag and cancels it.
func TestParentPortalConferenceBookingAnswersThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)
	var schoolClass string
	require.NoError(t, db.NewRaw(`SELECT school_class FROM users.student_school_memberships WHERE id = ?`, f.StudentID).Scan(testpkg.Ctx(t), &schoolClass))
	organizer, _ := testpkg.CreateTestStaffWithAccountForTenant(t, db, f.TenantID, "Sprech", "Tag")
	var conferenceID int64
	day := time.Now().AddDate(0, 1, 0).Format(time.DateOnly)
	require.NoError(t, db.NewRaw(`INSERT INTO calendar.parent_conferences
		(tenant_id, organizer_staff_id, school_class, conference_date, start_minute, end_minute, slot_minutes)
		VALUES (?, ?, ?, ?, 840, 900, 15) RETURNING id`, f.TenantID, organizer.ID, schoolClass, day).Scan(testpkg.Ctx(t), &conferenceID))
	path := childPath(f, fmt.Sprintf("/parent-conferences/%d/booking", conferenceID))

	var offer struct {
		ID      string `json:"id"`
		Booking *struct {
			StartTime string `json:"start_time"`
		} `json:"booking"`
	}
	r.call(t, http.MethodPut, path, f.token, map[string]any{"start_time": "14:15"}, &offer)
	require.NotNil(t, offer.Booking, "the slot is booked")
	assert.Equal(t, "14:15", offer.Booking.StartTime)
	var cancelled parentHTTP.ParentConferenceCancelledResponse
	r.call(t, http.MethodDelete, path, f.token, nil, &cancelled)
	assert.Equal(t, "cancelled", cancelled.Status)
	assert.Zero(t, r.scalar(t, `SELECT count(*) FROM calendar.parent_conference_bookings WHERE conference_id = ?`, conferenceID))
}

// A guardian opens an Umfrage of the feed and answers it once.
func TestParentPortalSurveyAnswersThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r, surveys := newParentPortalRoutesWithSurveys(t, db)
	f := r.family(t)
	r.set(t, map[string]any{"operations.parent_news_enabled": true})
	_, author := testpkg.CreateTestStaffWithAccountForTenant(t, db, f.TenantID, "Umfrage", "Autorin")
	ctx := tenant.WithTenantID(testpkg.WithTenantRuntime(t, context.Background(), db), f.TenantID)
	var survey *communication.Survey
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, f.TenantID, func(ctx context.Context) error {
		draft, err := surveys.CreateSurvey(ctx, author.ID, communication.SurveyInput{
			Title: "Ferienbetreuung", Audience: communication.SurveyAudienceParents, ClosesAt: time.Now().Add(2 * time.Hour),
			Targets:   []communication.SurveyTarget{{TargetType: "student", RefID: &f.StudentID}},
			Questions: []communication.SurveyQuestionInput{{Kind: communication.SurveyQuestionSingle, Prompt: "Brauchst du sie?", Required: true, Options: []string{"Ja", "Nein"}}},
		})
		if err != nil {
			return err
		}
		survey, err = surveys.PublishSurvey(ctx, author.ID, draft.ID, communication.SurveyVersion(*draft))
		return err
	}))
	require.NotNil(t, survey.AnnouncementID, "the published survey has its news item")
	// The portal reads on the rig's fixed school day; the news item counts as
	// published before it.
	_, err := db.ExecContext(testpkg.Ctx(t), `UPDATE users.parent_announcements SET published_at = ? WHERE id = ?`,
		r.now().Add(-time.Hour), *survey.AnnouncementID)
	require.NoError(t, err)
	path := fmt.Sprintf("/parent/me/news/%d/survey", *survey.AnnouncementID)

	var form parentHTTP.SurveyFormResponse
	r.call(t, http.MethodGet, path, f.token, nil, &form)
	assert.False(t, form.Participated)
	require.Len(t, form.Survey.Questions, 1)
	question := form.Survey.Questions[0]
	var submitted parentHTTP.SurveySubmittedResponse
	r.call(t, http.MethodPost, path, f.token, map[string]any{"answers": []map[string]any{
		{"question_id": question.ID, "option_ids": []string{question.Options[0].ID}},
	}}, &submitted)
	assert.True(t, submitted.Submitted)
	form = parentHTTP.SurveyFormResponse{}
	r.call(t, http.MethodGet, path, f.token, nil, &form)
	assert.True(t, form.Participated, "the answer is stored once")
}

// A guardian asks to book a care offering and then changes the note of the
// waiting request; the stored request carries the edit.
func TestParentPortalOfferingChangeIsRequestedAndEditedThroughTheParentMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	r := newParentPortalRoutes(t, db)
	f := r.family(t)
	phase := r.scalar(t, `SELECT q.phase_id FROM enrollment.request_children AS c JOIN enrollment.requests AS q ON q.id = c.request_id
		WHERE c.created_student_id = ?`, f.StudentID)
	offering := testpkg.CreateTestCareOffering(t, db, phase, "Nachmittag")
	change := func(note string) map[string]any {
		return map[string]any{
			"offerings":      []map[string]any{{"offering_id": fmt.Sprint(offering.ID), "selected_days": []string{}}},
			"effective_from": "2026-12-01", "note": note,
		}
	}
	type pending struct {
		PendingRequest *struct {
			ID   string `json:"id"`
			Note string `json:"note"`
		} `json:"pending_request"`
	}

	var requested pending
	r.call(t, http.MethodPost, childPath(f, "/care-offerings/requests"), f.token, change("Bitte ab Dezember"), &requested)
	require.NotNil(t, requested.PendingRequest)
	request := r.scalar(t, `SELECT id FROM enrollment.offering_change_requests WHERE student_id = ? AND status = 'pending'`, f.StudentID)
	require.Equal(t, fmt.Sprint(request), requested.PendingRequest.ID)

	edit := change("Bitte erst ab Januar")
	edit["expected_version"] = testpkg.ParentRequestVersionIn(t, r.db, "enrollment.offering_change_requests", request)
	var edited pending
	r.call(t, http.MethodPut, childPath(f, fmt.Sprintf("/care-offerings/requests/%d", request)), f.token, edit, &edited)
	require.NotNil(t, edited.PendingRequest)
	assert.Equal(t, "Bitte erst ab Januar", edited.PendingRequest.Note)
	var stored pending
	r.call(t, http.MethodGet, childPath(f, "/care-offerings"), f.token, nil, &stored)
	require.NotNil(t, stored.PendingRequest)
	assert.Equal(t, "Bitte erst ab Januar", stored.PendingRequest.Note, "a later read shows the edited request")
}
