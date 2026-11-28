package application

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
)

// GetForReview authorizes the child before loading display identities. It
// serves every request status and never reads today's schedule.
func (s *scheduleReviewCommands) GetForReview(ctx context.Context, id int64) (value0 *carerequests.HistoryItem, err error) {
	err = s.commands.deps.RunInTx(ctx, func(txCtx context.Context) error {
		value0, err = s.commands.GetForReview(txCtx, id)
		return err
	})
	return
}

func (s *ScheduleReviews) GetForReview(ctx context.Context, id int64) (*carerequests.HistoryItem, error) {
	if id <= 0 {
		return nil, careplan.ErrCareScheduleRequestNotFound
	}
	request, err := s.deps.Requests.FindCareScheduleRequest(ctx, id, false)
	if err != nil {
		return nil, fmt.Errorf("schedule: load care request: %w", err)
	}
	students, err := s.deps.People.FindStudents(ctx, []int64{request.StudentID})
	if err != nil {
		return nil, fmt.Errorf("schedule: load student for care request: %w", err)
	}
	student, found := students[request.StudentID]
	if !found {
		return nil, careplan.ErrCareScheduleRequestNotFound
	}
	scope, err := s.deps.Scope(ctx)
	if err != nil {
		return nil, fmt.Errorf("schedule: resolve request reviewer scope: %w", err)
	}
	if !scope.Allows(&student) {
		return nil, carerequests.ErrCareRequestForbidden
	}
	item := storedCareRequestDetail(&request)
	names, err := s.deps.People.PersonNames(ctx, []int64{student.PersonID})
	if err != nil {
		return nil, fmt.Errorf("schedule: load person for care request: %w", err)
	}
	name := names[student.PersonID]
	item.FirstName, item.LastName = name.FirstName, name.LastName
	if request.ReviewedBy != nil && *request.ReviewedBy > 0 {
		reviewers, readErr := s.deps.People.ReviewerNames(ctx, []int64{*request.ReviewedBy})
		if readErr != nil {
			return nil, fmt.Errorf("schedule: load reviewer for care request: %w", readErr)
		}
		item.ReviewerName = reviewerDisplayName(reviewers, request.ReviewedBy)
	}
	return item, nil
}

func storedCareRequestDetail(request *carerequests.Request) *carerequests.HistoryItem {
	item := &carerequests.HistoryItem{Request: request,
		Requested: requestedCareSummary(request.Payload), Diff: careReviewSnapshot(request.DecisionSnapshot)}
	var payload map[string]any
	if json.Unmarshal(request.Payload, &payload) != nil {
		return item
	}
	if reason, ok := payload["reason"].(string); ok && strings.TrimSpace(reason) != "" {
		trimmed := strings.TrimSpace(reason)
		item.RequestReason = &trimmed
	}
	if request.RequestKind == "pickup_change" {
		item.PickupChange = carerequests.StoredPickupTerms(request.Payload)
	}
	return item
}

// PickupOrigins reads the approved requests behind a child's pickup times
// (#8209) in two statements, whatever the number of days: the requests by
// ID, then their reviewers' names. It runs in the caller's tenant
// transaction; the caller already may read the child's plan, and the
// request only adds who decided it.
func (s *scheduleReviewCommands) PickupOrigins(ctx context.Context, studentID int64, requestIDs []int64) (map[int64]careplan.PickupOrigin, error) {
	ids := uniquePositive(requestIDs)
	if studentID <= 0 || len(ids) == 0 {
		return map[int64]careplan.PickupOrigin{}, nil
	}
	rows, err := s.commands.deps.Requests.ListCareScheduleRequests(ctx, careplan.CareScheduleRequestFilter{
		IDs: ids, StudentID: studentID, RequestKinds: []string{carerequests.KindPickupChange}, Statuses: []string{carerequests.StatusApproved},
	})
	if err != nil {
		return nil, fmt.Errorf("schedule: load requests behind pickup times: %w", err)
	}
	reviewers, err := s.commands.deps.People.ReviewerNames(ctx, requestReviewerIDs(rows))
	if err != nil {
		return nil, fmt.Errorf("schedule: load reviewers behind pickup times: %w", err)
	}
	return pickupOrigins(rows, studentID, reviewers), nil
}

func requestReviewerIDs(rows []careplan.CareScheduleChangeRequest) []int64 {
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		if row.ReviewedBy != nil && *row.ReviewedBy > 0 {
			ids = append(ids, *row.ReviewedBy)
		}
	}
	return ids
}

// pickupOrigins keys the approvals of one child by request; a request of
// another child names no origin.
func pickupOrigins(rows []careplan.CareScheduleChangeRequest, studentID int64, reviewers map[int64]careplan.PersonName) map[int64]careplan.PickupOrigin {
	origins := make(map[int64]careplan.PickupOrigin, len(rows))
	for _, row := range rows {
		if row.StudentID != studentID {
			continue
		}
		origins[row.ID] = careplan.PickupOrigin{RequestID: row.ID, ApprovedByName: reviewerDisplayName(reviewers, row.ReviewedBy), ApprovedAt: row.ReviewedAt}
	}
	return origins
}
