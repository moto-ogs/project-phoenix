package notifications

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// TraegerFeedEntry is one entry of the Träger bell (#7146) with the school it
// is about.
type TraegerFeedEntry struct {
	FeedEntry
	SchoolID   int64
	SchoolName string
}

// TraegerFeedPage is one page of the Träger bell with the unread count.
type TraegerFeedPage struct {
	Entries     []TraegerFeedEntry
	NextCursor  string
	UnreadCount int
}

// TraegerFeedService serves a Träger member the bell across the schools of
// the session's Träger (#7146).
type TraegerFeedService interface {
	Page(ctx context.Context, organizationID, accountID int64, cursor string, limit int) (TraegerFeedPage, error)
	UnreadCount(ctx context.Context, organizationID, accountID int64) (int, error)
	MarkRead(ctx context.Context, organizationID, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, organizationID, accountID int64) (int, error)
	IsNotFound(error) bool
	IsInvalidCursor(error) bool
}

// TraegerFeedResource serves the bell of the Träger-Portal (#7146).
type TraegerFeedResource struct {
	Feed    TraegerFeedService
	Runtime Runtime
}

// NewTraegerFeedResource binds the Träger bell to its runtime.
func NewTraegerFeedResource(feed TraegerFeedService, runtime Runtime) *TraegerFeedResource {
	return &TraegerFeedResource{Feed: feed, Runtime: runtime}
}

type traegerFeedEntryResponse struct {
	feedEntryResponse
	SchoolID   int64  `json:"school_id,string"`
	SchoolName string `json:"school_name"`
}

type traegerFeedPageResponse struct {
	Entries     []traegerFeedEntryResponse `json:"entries"`
	NextCursor  *string                    `json:"next_cursor"`
	UnreadCount int                        `json:"unread_count"`
}

// Router mounts the bell behind the Träger session. The routes open no
// transaction of their own: the bell reads across the Träger's schools in
// one administrative unit, which the Träger transaction cannot hold.
func (rs *TraegerFeedResource) Router() chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	rs.Runtime.ProtectedTraeger(r, func(r chi.Router) {
		r.Route("/feed", func(r chi.Router) {
			r.Get("/", rs.list)
			r.Get("/unread-count", rs.unreadCount)
			r.Post("/read-all", rs.markAllRead)
			r.Post("/{id}/read", rs.markRead)
		})
	})
	return r
}

// caller is the Träger and the account of the session.
func (rs *TraegerFeedResource) caller(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	if rs.Feed == nil {
		rs.Runtime.Internal(w, r, errors.New("traeger notification feed is not configured"))
		return 0, 0, false
	}
	organizationID := rs.Runtime.OrganizationID(r.Context())
	if organizationID <= 0 {
		rs.Runtime.Forbidden(w, r, errors.New("missing Träger context"))
		return 0, 0, false
	}
	accountID := rs.Runtime.ActorID(r.Context())
	if accountID == nil {
		rs.Runtime.Unauthorized(w, r)
		return 0, 0, false
	}
	return organizationID, *accountID, true
}

func (rs *TraegerFeedResource) list(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := rs.caller(w, r)
	if !ok {
		return
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			rs.Runtime.Invalid(w, r, errors.New("limit must be a positive number"))
			return
		}
		limit = parsed
	}
	page, err := rs.Feed.Page(r.Context(), organizationID, accountID, r.URL.Query().Get("cursor"), limit)
	if err != nil {
		if rs.Feed.IsInvalidCursor(err) {
			rs.Runtime.Invalid(w, r, err)
			return
		}
		rs.Runtime.Internal(w, r, err)
		return
	}
	response := traegerFeedPageResponse{Entries: make([]traegerFeedEntryResponse, 0, len(page.Entries)), UnreadCount: page.UnreadCount}
	if page.NextCursor != "" {
		response.NextCursor = &page.NextCursor
	}
	for _, entry := range page.Entries {
		response.Entries = append(response.Entries, traegerFeedEntryResponse{
			feedEntryResponse: feedEntryResponse(entry.FeedEntry), SchoolID: entry.SchoolID, SchoolName: entry.SchoolName,
		})
	}
	rs.Runtime.Respond(w, r, http.StatusOK, response, "Notification feed retrieved successfully")
}

func (rs *TraegerFeedResource) unreadCount(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := rs.caller(w, r)
	if !ok {
		return
	}
	count, err := rs.Feed.UnreadCount(r.Context(), organizationID, accountID)
	if err != nil {
		rs.Runtime.Internal(w, r, err)
		return
	}
	rs.Runtime.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, "Unread notification count retrieved successfully")
}

func (rs *TraegerFeedResource) markRead(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := rs.caller(w, r)
	if !ok {
		return
	}
	entryID, err := rs.Runtime.ParseIDParam(r, "id")
	if err != nil || entryID <= 0 {
		rs.Runtime.Invalid(w, r, errors.New("invalid notification feed entry id"))
		return
	}
	count, err := rs.Feed.MarkRead(r.Context(), organizationID, accountID, entryID)
	if err != nil {
		if rs.Feed.IsNotFound(err) {
			rs.Runtime.NotFound(w, r, err)
			return
		}
		rs.Runtime.Internal(w, r, err)
		return
	}
	rs.Runtime.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, "Notification marked as read")
}

func (rs *TraegerFeedResource) markAllRead(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := rs.caller(w, r)
	if !ok {
		return
	}
	count, err := rs.Feed.MarkAllRead(r.Context(), organizationID, accountID)
	if err != nil {
		rs.Runtime.Internal(w, r, err)
		return
	}
	rs.Runtime.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, "All notifications marked as read")
}
