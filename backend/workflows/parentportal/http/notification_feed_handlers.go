package parent

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The bell of the parents portal (#7140): the notification feed of the
// account across the schools of the family. The wire shape is the one of the
// staff portal's feed (#7148), so both bells read it alike.

type notificationFeedEntryResponse struct {
	ID        ident.ID   `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	DeepLink  string     `json:"deep_link"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	ReadAt    *time.Time `json:"read_at"`
}

type notificationFeedPageResponse struct {
	Entries     []notificationFeedEntryResponse `json:"entries"`
	NextCursor  *string                         `json:"next_cursor"`
	UnreadCount int                             `json:"unread_count"`
}

type notificationFeedCountResponse struct {
	UnreadCount int `json:"unread_count"`
}

// feedAccount is the account of the session, or false after an answer.
func (rs *Resource) feedAccount(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if rs.FeedService == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("notification feed is not configured")))
		return 0, false
	}
	return int64(sessiontoken.ClaimsFromCtx(r.Context()).ID), true
}

func (rs *Resource) listNotificationFeed(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.feedAccount(w, r)
	if !ok {
		return
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("limit must be a positive number")))
			return
		}
		limit = parsed
	}
	page, err := rs.FeedService.Page(r.Context(), accountID, r.URL.Query().Get("cursor"), limit)
	switch {
	case err != nil && rs.FeedService.IsInvalidCursor(err):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	response := notificationFeedPageResponse{
		Entries:     make([]notificationFeedEntryResponse, 0, len(page.Entries)),
		UnreadCount: page.UnreadCount,
	}
	if page.NextCursor != "" {
		response.NextCursor = &page.NextCursor
	}
	for _, entry := range page.Entries {
		response.Entries = append(response.Entries, notificationFeedEntryResponse(entry))
	}
	common.Respond(w, r, http.StatusOK, response, "Notification feed retrieved successfully")
}

func (rs *Resource) notificationFeedUnreadCount(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.feedAccount(w, r)
	if !ok {
		return
	}
	count, err := rs.FeedService.UnreadCount(r.Context(), accountID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, notificationFeedCountResponse{UnreadCount: count}, "Unread notification count retrieved successfully")
}

func (rs *Resource) markNotificationFeedEntryRead(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.feedAccount(w, r)
	if !ok {
		return
	}
	entryID, err := common.ParseIDParam(r, "id")
	if err != nil || entryID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid notification feed entry id")))
		return
	}
	count, err := rs.FeedService.MarkRead(r.Context(), accountID, entryID)
	switch {
	case err != nil && rs.FeedService.IsNotFound(err):
		common.RenderError(w, r, common.ErrorNotFound(err))
		return
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, notificationFeedCountResponse{UnreadCount: count}, "Notification marked as read")
}

func (rs *Resource) markAllNotificationFeedRead(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.feedAccount(w, r)
	if !ok {
		return
	}
	count, err := rs.FeedService.MarkAllRead(r.Context(), accountID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, notificationFeedCountResponse{UnreadCount: count}, "All notifications marked as read")
}
