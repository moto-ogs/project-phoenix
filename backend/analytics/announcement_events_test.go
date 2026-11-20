package analytics

import (
	"context"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAnnouncementRouter mounts the announcement routes of the OGS portal as
// the production root does, for a staff member of school 42 (account 7).
func newAnnouncementRouter(tracker Tracker, schoolOn, consent bool) http.Handler {
	answer := func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("status") == "500" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","message":"ok"}`))
	}
	root := chi.NewRouter()
	root.Use(CoreActionMiddleware(CoreActionConfig{
		Tracker: tracker,
		Policy: CollectionPolicy{SchoolEnabled: func(_ context.Context, id int64) (bool, error) {
			return schoolOn && id == 42, nil
		}},
		RequestActor: func(*http.Request) (Actor, bool) {
			return Actor{Surface: SurfaceOGS, Role: RoleStaff, SchoolID: 42, AccountID: 7}, true
		},
		Consent: func(context.Context, int64) bool { return consent },
	}))
	root.Route("/api/platform/announcements", func(r chi.Router) {
		r.Post("/{id}/seen", answer)
		r.Post("/{id}/dismiss", answer)
	})
	return root
}

// The announcement (#7555) counts "seen" and "closed" for its school,
// independently of the person's consent, but never without the school's
// switch and never for a failed request.
func TestAnnouncementSeenAndDismissedCountForTheSchool(t *testing.T) {
	t.Parallel()

	for path, name := range map[string]string{"seen": "announcement_seen", "dismiss": "announcement_dismissed"} {
		target := "/api/platform/announcements/5/" + path
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			for _, consent := range []bool{true, false} {
				tracker := &recordingTracker{}
				rec := serve(newAnnouncementRouter(tracker, true, consent), http.MethodPost, target, "", map[string]string{SessionIDHeader: testSessionID})
				require.Equal(t, http.StatusOK, rec.Code)

				events := tracker.captured()
				require.Len(t, events, 1, "consent %v", consent)
				assert.Equal(t, name, events[0].event)
				assert.Equal(t, "school:42", events[0].distinctID)
				assert.Equal(t, map[string]any{"surface": SurfaceOGS, "role": RoleStaff, "school_id": "42"}, events[0].props, "no announcement id")
				if consent {
					assert.Equal(t, testSessionID, events[0].sessionID)
				} else {
					assert.Empty(t, events[0].sessionID, "no $session_id without consent")
				}
			}

			failed := &recordingTracker{}
			serve(newAnnouncementRouter(failed, true, true), http.MethodPost, target+"?status=500", "", nil)
			assert.Empty(t, failed.captured(), "nothing on failure")

			off := &recordingTracker{}
			rec := serve(newAnnouncementRouter(off, false, true), http.MethodPost, target, "", nil)
			require.Equal(t, http.StatusOK, rec.Code)
			assert.Empty(t, off.captured(), "nothing while the school's usage analytics is off")
		})
	}
}
