package notifications

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// The bells across schools: the Träger-Portal's (#7146) and the caterer
// portal's (#7147). Both serve the same four routes; each entry names the
// school it is about.

// SchoolFeedEntry is one entry of a bell across schools with the school it is
// about.
type SchoolFeedEntry struct {
	FeedEntry
	SchoolID   int64
	SchoolName string
}

// SchoolFeedPage is one page of a bell across schools with the unread count.
type SchoolFeedPage struct {
	Entries     []SchoolFeedEntry
	NextCursor  string
	UnreadCount int
}

// TraegerFeedService serves a Träger member the bell across the schools of
// the session's Träger (#7146).
type TraegerFeedService interface {
	Page(ctx context.Context, organizationID, accountID int64, cursor string, limit int) (SchoolFeedPage, error)
	UnreadCount(ctx context.Context, organizationID, accountID int64) (int, error)
	MarkRead(ctx context.Context, organizationID, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, organizationID, accountID int64) (int, error)
	IsNotFound(error) bool
	IsInvalidCursor(error) bool
}

// CatererFeedService serves a caterer account the bell across the schools
// its caterer supplies (#7147).
type CatererFeedService interface {
	Page(ctx context.Context, accountID int64, cursor string, limit int) (SchoolFeedPage, error)
	UnreadCount(ctx context.Context, accountID int64) (int, error)
	MarkRead(ctx context.Context, accountID, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, accountID int64) (int, error)
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

// CatererFeedResource serves the bell of the caterer portal (#7147).
type CatererFeedResource struct {
	Feed    CatererFeedService
	Runtime Runtime
}

// NewCatererFeedResource binds the caterer bell to its runtime.
func NewCatererFeedResource(feed CatererFeedService, runtime Runtime) *CatererFeedResource {
	return &CatererFeedResource{Feed: feed, Runtime: runtime}
}

type schoolFeedEntryResponse struct {
	feedEntryResponse
	SchoolID   int64  `json:"school_id,string"`
	SchoolName string `json:"school_name"`
}

type schoolFeedPageResponse struct {
	Entries     []schoolFeedEntryResponse `json:"entries"`
	NextCursor  *string                   `json:"next_cursor"`
	UnreadCount int                       `json:"unread_count"`
}

// schoolFeedSession is the bell of one request, bound to its session.
type schoolFeedSession struct {
	page        func(ctx context.Context, cursor string, limit int) (SchoolFeedPage, error)
	unreadCount func(ctx context.Context) (int, error)
	markRead    func(ctx context.Context, entryID int64) (int, error)
	markAllRead func(ctx context.Context) (int, error)
	notFound    func(error) bool
	badCursor   func(error) bool
}

// schoolFeedRoutes registers the four routes of a bell across schools. The
// routes open no transaction of their own: the bell reads across schools in
// one administrative unit. session answers false after it wrote the refusal.
func schoolFeedRoutes(r chi.Router, rt Runtime, session func(http.ResponseWriter, *http.Request) (schoolFeedSession, bool)) {
	r.Route("/feed", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			if feed, ok := session(w, r); ok {
				listSchoolFeed(w, r, rt, feed)
			}
		})
		r.Get("/unread-count", func(w http.ResponseWriter, r *http.Request) {
			if feed, ok := session(w, r); ok {
				respondSchoolFeedCount(w, r, rt, feed, "Unread notification count retrieved successfully", func(ctx context.Context) (int, error) {
					return feed.unreadCount(ctx)
				})
			}
		})
		r.Post("/read-all", func(w http.ResponseWriter, r *http.Request) {
			if feed, ok := session(w, r); ok {
				respondSchoolFeedCount(w, r, rt, feed, "All notifications marked as read", feed.markAllRead)
			}
		})
		r.Post("/{id}/read", func(w http.ResponseWriter, r *http.Request) {
			if feed, ok := session(w, r); ok {
				markSchoolFeedRead(w, r, rt, feed)
			}
		})
	})
}

func listSchoolFeed(w http.ResponseWriter, r *http.Request, rt Runtime, feed schoolFeedSession) {
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			rt.Invalid(w, r, errors.New("limit must be a positive number"))
			return
		}
		limit = parsed
	}
	page, err := feed.page(r.Context(), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		if feed.badCursor(err) {
			rt.Invalid(w, r, err)
			return
		}
		rt.Internal(w, r, err)
		return
	}
	response := schoolFeedPageResponse{Entries: make([]schoolFeedEntryResponse, 0, len(page.Entries)), UnreadCount: page.UnreadCount}
	if page.NextCursor != "" {
		response.NextCursor = &page.NextCursor
	}
	for _, entry := range page.Entries {
		response.Entries = append(response.Entries, schoolFeedEntryResponse{
			feedEntryResponse: feedEntryResponse(entry.FeedEntry), SchoolID: entry.SchoolID, SchoolName: entry.SchoolName,
		})
	}
	rt.Respond(w, r, http.StatusOK, response, "Notification feed retrieved successfully")
}

func markSchoolFeedRead(w http.ResponseWriter, r *http.Request, rt Runtime, feed schoolFeedSession) {
	entryID, err := rt.ParseIDParam(r, "id")
	if err != nil || entryID <= 0 {
		rt.Invalid(w, r, errors.New("invalid notification feed entry id"))
		return
	}
	respondSchoolFeedCount(w, r, rt, feed, "Notification marked as read", func(ctx context.Context) (int, error) {
		return feed.markRead(ctx, entryID)
	})
}

func respondSchoolFeedCount(w http.ResponseWriter, r *http.Request, rt Runtime, feed schoolFeedSession, message string, run func(context.Context) (int, error)) {
	count, err := run(r.Context())
	if err != nil {
		if feed.notFound(err) {
			rt.NotFound(w, r, err)
			return
		}
		rt.Internal(w, r, err)
		return
	}
	rt.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, message)
}

// Router mounts the Träger bell behind the Träger session.
func (rs *TraegerFeedResource) Router() chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	rs.Runtime.ProtectedTraeger(r, func(r chi.Router) {
		schoolFeedRoutes(r, rs.Runtime, rs.session)
	})
	return r
}

// session binds the bell to the Träger and the account of the session.
func (rs *TraegerFeedResource) session(w http.ResponseWriter, r *http.Request) (schoolFeedSession, bool) {
	if rs.Feed == nil {
		rs.Runtime.Internal(w, r, errors.New("traeger notification feed is not configured"))
		return schoolFeedSession{}, false
	}
	organizationID := rs.Runtime.OrganizationID(r.Context())
	if organizationID <= 0 {
		rs.Runtime.Forbidden(w, r, errors.New("missing Träger context"))
		return schoolFeedSession{}, false
	}
	accountID := rs.Runtime.ActorID(r.Context())
	if accountID == nil {
		rs.Runtime.Unauthorized(w, r)
		return schoolFeedSession{}, false
	}
	account, feed := *accountID, rs.Feed
	return schoolFeedSession{
		page: func(ctx context.Context, cursor string, limit int) (SchoolFeedPage, error) {
			return feed.Page(ctx, organizationID, account, cursor, limit)
		},
		unreadCount: func(ctx context.Context) (int, error) { return feed.UnreadCount(ctx, organizationID, account) },
		markRead: func(ctx context.Context, entryID int64) (int, error) {
			return feed.MarkRead(ctx, organizationID, account, entryID)
		},
		markAllRead: func(ctx context.Context) (int, error) { return feed.MarkAllRead(ctx, organizationID, account) },
		notFound:    feed.IsNotFound, badCursor: feed.IsInvalidCursor,
	}, true
}

// Router mounts the caterer bell behind the caterer session.
func (rs *CatererFeedResource) Router() chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	rs.Runtime.ProtectedCaterer(r, func(r chi.Router) {
		schoolFeedRoutes(r, rs.Runtime, rs.session)
	})
	return r
}

// session binds the bell to the account of the caterer session.
func (rs *CatererFeedResource) session(w http.ResponseWriter, r *http.Request) (schoolFeedSession, bool) {
	if rs.Feed == nil {
		rs.Runtime.Internal(w, r, errors.New("caterer notification feed is not configured"))
		return schoolFeedSession{}, false
	}
	accountID := rs.Runtime.ActorID(r.Context())
	if accountID == nil || *accountID <= 0 {
		rs.Runtime.Unauthorized(w, r)
		return schoolFeedSession{}, false
	}
	account, feed := *accountID, rs.Feed
	return schoolFeedSession{
		page: func(ctx context.Context, cursor string, limit int) (SchoolFeedPage, error) {
			return feed.Page(ctx, account, cursor, limit)
		},
		unreadCount: func(ctx context.Context) (int, error) { return feed.UnreadCount(ctx, account) },
		markRead:    func(ctx context.Context, entryID int64) (int, error) { return feed.MarkRead(ctx, account, entryID) },
		markAllRead: func(ctx context.Context) (int, error) { return feed.MarkAllRead(ctx, account) },
		notFound:    feed.IsNotFound, badCursor: feed.IsInvalidCursor,
	}, true
}
