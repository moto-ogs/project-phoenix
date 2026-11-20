package presence

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

type sessionQueryStub struct {
	PresenceQueries
	query  func(context.Context, []int64) ([]studentpresence.LiveGroup, error)
	list   func(context.Context, studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error)
	visits func(context.Context, studentpresence.VisitFilter) ([]studentpresence.Visit, error)
}

func (s sessionQueryStub) QueryGroupSupervisions(context.Context, studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error) {
	return nil, nil
}

func (s sessionQueryStub) ListVisits(ctx context.Context, filter studentpresence.VisitFilter) ([]studentpresence.Visit, error) {
	return s.visits(ctx, filter)
}

func (s sessionQueryStub) QueryLiveGroups(ctx context.Context, filter studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error) {
	if s.list != nil {
		return s.list(ctx, filter)
	}
	return nil, nil
}

func (s sessionQueryStub) ListLiveGroups(ctx context.Context, ids []int64) ([]studentpresence.LiveGroup, error) {
	return s.query(ctx, ids)
}
