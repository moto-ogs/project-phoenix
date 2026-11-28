package careplan

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
)

// CareScheduleRequestQuery is the bounded storage read used by staff review.
type CareScheduleRequestQuery interface {
	FindCareScheduleRequest(context.Context, int64, bool) (CareScheduleChangeRequest, error)
	ListCareScheduleRequests(context.Context, CareScheduleRequestFilter) ([]CareScheduleChangeRequest, error)
}

type CareScheduleReviewQuery interface {
	GetForReview(context.Context, int64) (*carerequests.HistoryItem, error)
	ListPending(context.Context, RequestQueueFilter) ([]*CareScheduleReviewItem, *RequestCursor, error)
	ListHistory(context.Context, RequestQueueFilter) ([]*CareScheduleHistoryItem, *RequestCursor, error)
	carerequests.WeeklyImpact
	// PickupOrigins resolves the approved parent requests that the given
	// pickup times of one child came from (#8209), keyed by request ID. A
	// request of another child, an undecided one or one no longer approved
	// is left out.
	PickupOrigins(ctx context.Context, studentID int64, requestIDs []int64) (map[int64]PickupOrigin, error)
}

// PickupOrigin is the parent request a pickup time was approved from: who
// approved it and when. It is read from the request each time.
type PickupOrigin struct {
	RequestID      int64
	ApprovedByName string
	ApprovedAt     *time.Time
}

type CareScheduleReviewItem = carerequests.ReviewItem
type CareScheduleHistoryItem = carerequests.HistoryItem
type CareReviewBlock = carerequests.Block
