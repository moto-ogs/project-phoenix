package application

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/feedback"
	"github.com/moto-ogs/project-phoenix/modules/feedback/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/feedback/internal/ports"
)

type seamStore struct {
	ports.Store
	e *recordingEngine
}

func (s seamStore) Create(ctx context.Context, value domain.Entry) (domain.Entry, domain.OperationStats, error) {
	entry, err := s.e.Submit(ctx, feedback.CreateEntry{Value: value.Value, Day: feedback.Date(value.Day.String()), Time: value.Time.Format("15:04:05"), StudentID: value.StudentID, IsMensaFeedback: value.IsMensaFeedback})
	value.ID = entry.ID
	return value, domain.OperationStats{}, err
}

func (s seamStore) CreateBatch(ctx context.Context, values []domain.Entry) ([]domain.Entry, domain.OperationStats, error) {
	entries := make([]domain.Entry, 0, len(values))
	for _, value := range values {
		entry, _, err := s.Create(ctx, value)
		if err != nil {
			return nil, domain.OperationStats{}, err
		}
		entries = append(entries, entry)
	}
	return entries, domain.OperationStats{}, nil
}

type seamTransaction struct{}

func (seamTransaction) Run(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }

type seamSettings struct{}

func (seamSettings) FeedbackEnabled(context.Context) (bool, error)      { return true, nil }
func (seamSettings) FeedbackRetentionDays(context.Context) (int, error) { return 90, nil }

// seamStops reports the listed children as stopped (#3844).
type seamStops map[int64]bool

func (s seamStops) MoodCaptureStopped(_ context.Context, studentID int64) (bool, error) {
	return s[studentID], nil
}

func newTestModule(e *recordingEngine) *Service {
	return newTestModuleWithStops(e, seamStops{})
}

func newTestModuleWithStops(e *recordingEngine, stops seamStops) *Service {
	return New(seamStore{e: e}, seamSettings{}, stops, seamTransaction{}, func(o ports.Observation) {
		if o.Err != nil {
			e.ObserveRejection(o.Operation, o.Duration, o.Err)
		}
	}, func() domain.Date { return domain.Date("2026-08-31") })
}

var _ = time.Second
