package notifications

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// FeedEntry is one entry of the caller's notification feed (#7148).
type FeedEntry struct {
	ID        ident.ID
	Type      string
	Title     string
	Body      string
	DeepLink  string
	CreatedAt time.Time
	UpdatedAt time.Time
	ReadAt    *time.Time
}

// FeedPage is one page of the feed with the unread count.
type FeedPage struct {
	Entries     []FeedEntry
	NextCursor  string
	UnreadCount int
}

// FeedService serves the caller's own notification feed in the school and the
// portal of the session (#7148, #7139).
type FeedService interface {
	Page(ctx context.Context, tenantID, accountID int64, portal, cursor string, limit int) (FeedPage, error)
	UnreadCount(ctx context.Context, tenantID, accountID int64, portal string) (int, error)
	MarkRead(ctx context.Context, tenantID, accountID int64, portal string, entryID int64) (int, error)
	MarkAllRead(ctx context.Context, tenantID, accountID int64, portal string) (int, error)
	IsNotFound(error) bool
	IsInvalidCursor(error) bool
}

type feedEntryResponse struct {
	ID        ident.ID   `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	DeepLink  string     `json:"deep_link"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	ReadAt    *time.Time `json:"read_at"`
}

type feedPageResponse struct {
	Entries     []feedEntryResponse `json:"entries"`
	NextCursor  *string             `json:"next_cursor"`
	UnreadCount int                 `json:"unread_count"`
}

type feedCountResponse struct {
	UnreadCount int `json:"unread_count"`
}

// registerFeedRoutes mounts the feed in the request's tenant transaction. The
// staff portal and moto schule mount the same routes; the request's portal
// decides which entries the session sees.
func (rs *Resource) registerFeedRoutes(r chi.Router, withTx Middleware) {
	r.With(withTx).Route("/feed", func(r chi.Router) {
		r.Get("/", rs.listFeed)
		r.Get("/unread-count", rs.feedUnreadCount)
		r.Post("/read-all", rs.markAllFeedRead)
		r.Post("/{id}/read", rs.markFeedEntryRead)
	})
}

// feedCaller is the school and account of the session.
func (rs *Resource) feedCaller(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	if rs.FeedService == nil {
		rs.Runtime.Internal(w, r, errors.New("notification feed is not configured"))
		return 0, 0, false
	}
	tenantID := rs.Runtime.TenantID(r.Context())
	if tenantID <= 0 {
		rs.Runtime.Forbidden(w, r, errors.New("missing tenant context"))
		return 0, 0, false
	}
	accountID := rs.Runtime.ActorID(r.Context())
	if accountID == nil {
		rs.Runtime.Unauthorized(w, r)
		return 0, 0, false
	}
	return tenantID, *accountID, true
}

func (rs *Resource) listFeed(w http.ResponseWriter, r *http.Request) {
	tenantID, accountID, ok := rs.feedCaller(w, r)
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
	page, err := rs.FeedService.Page(r.Context(), tenantID, accountID, requestPortal(r), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		if rs.FeedService.IsInvalidCursor(err) {
			rs.Runtime.Invalid(w, r, err)
			return
		}
		rs.Runtime.Internal(w, r, err)
		return
	}
	response := feedPageResponse{Entries: make([]feedEntryResponse, 0, len(page.Entries)), UnreadCount: page.UnreadCount}
	if page.NextCursor != "" {
		response.NextCursor = &page.NextCursor
	}
	for _, entry := range page.Entries {
		response.Entries = append(response.Entries, feedEntryResponse(entry))
	}
	rs.Runtime.Respond(w, r, http.StatusOK, response, "Notification feed retrieved successfully")
}

func (rs *Resource) feedUnreadCount(w http.ResponseWriter, r *http.Request) {
	tenantID, accountID, ok := rs.feedCaller(w, r)
	if !ok {
		return
	}
	count, err := rs.FeedService.UnreadCount(r.Context(), tenantID, accountID, requestPortal(r))
	if err != nil {
		rs.Runtime.Internal(w, r, err)
		return
	}
	rs.Runtime.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, "Unread notification count retrieved successfully")
}

func (rs *Resource) markFeedEntryRead(w http.ResponseWriter, r *http.Request) {
	tenantID, accountID, ok := rs.feedCaller(w, r)
	if !ok {
		return
	}
	entryID, err := rs.Runtime.ParseIDParam(r, "id")
	if err != nil || entryID <= 0 {
		rs.Runtime.Invalid(w, r, errors.New("invalid notification feed entry id"))
		return
	}
	count, err := rs.FeedService.MarkRead(r.Context(), tenantID, accountID, requestPortal(r), entryID)
	if err != nil {
		if rs.FeedService.IsNotFound(err) {
			rs.Runtime.NotFound(w, r, err)
			return
		}
		rs.Runtime.Internal(w, r, err)
		return
	}
	rs.Runtime.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, "Notification marked as read")
}

func (rs *Resource) markAllFeedRead(w http.ResponseWriter, r *http.Request) {
	tenantID, accountID, ok := rs.feedCaller(w, r)
	if !ok {
		return
	}
	count, err := rs.FeedService.MarkAllRead(r.Context(), tenantID, accountID, requestPortal(r))
	if err != nil {
		rs.Runtime.Internal(w, r, err)
		return
	}
	rs.Runtime.Respond(w, r, http.StatusOK, feedCountResponse{UnreadCount: count}, "All notifications marked as read")
}
