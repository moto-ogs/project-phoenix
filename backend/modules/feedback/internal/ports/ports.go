package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/feedback/internal/domain"
)

type Store interface {
	Create(context.Context, domain.Entry) (domain.Entry, domain.OperationStats, error)
	CreateBatch(context.Context, []domain.Entry) ([]domain.Entry, domain.OperationStats, error)
	List(context.Context, domain.Filter) ([]domain.Entry, domain.OperationStats, error)
	DeleteOlderThan(context.Context, domain.Date) (domain.OperationStats, error)
	CountForStudent(context.Context, int64) (int, domain.OperationStats, error)
}

type Settings interface {
	FeedbackEnabled(context.Context) (bool, error)
	FeedbackRetentionDays(context.Context) (int, error)
}

// StudentStops tells whether a child's mood capture is stopped (#3844). The
// root binds it to Student Presence's per-child stop.
type StudentStops interface {
	MoodCaptureStopped(ctx context.Context, studentID int64) (bool, error)
}

type Transaction interface {
	Run(context.Context, func(context.Context) error) error
}

type Observation struct {
	Operation string
	Duration  time.Duration
	Stats     domain.OperationStats
	Err       error
}

type Observer func(Observation)
