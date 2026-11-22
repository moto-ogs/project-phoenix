package application

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RetentionStore reads and deletes the appointments of the school in context
// for the nightly cleanup (#4045).
type RetentionStore interface {
	// ListRetentionCandidates returns the appointments that start before
	// cutoff, are neither cancelled nor deleted and are no endless series,
	// with their rules and latest override days.
	ListRetentionCandidates(ctx context.Context, cutoff appointments.Date) ([]appointments.RetentionCandidate, error)
	// LockRetentionCandidates rereads the selected candidates and locks their
	// appointments, rules and overrides until the tenant transaction commits.
	LockRetentionCandidates(ctx context.Context, cutoff appointments.Date, ids []int64) ([]appointments.RetentionCandidate, error)
	DeleteAppointments(ctx context.Context, ids []int64) (int, error)
	// ListParentConferenceAppointments returns the Elternsprechtag
	// appointments that start before cutoff, cancelled ones included, and
	// locks them; DeleteParentConferenceAppointments deletes them.
	ListParentConferenceAppointments(ctx context.Context, cutoff appointments.Date) ([]int64, error)
	DeleteParentConferenceAppointments(ctx context.Context, ids []int64) (int, error)
}

// Retention deletes the ended appointments of the school in context. today
// is the Berlin calendar day the window counts back from (ADR 0239).
type Retention struct {
	store RetentionStore
	today func() calendar.Date
}

func NewRetention(store RetentionStore, now func() time.Time) *Retention {
	if store == nil || now == nil {
		panic("appointments application: retention requires its store and clock")
	}
	return &Retention{store: store, today: calendar.CalendarDateClock(now)}
}

// DeleteExpiredAppointments deletes the appointments whose last day lies
// before the first Berlin calendar day a window of retentionDays keeps.
func (r *Retention) DeleteExpiredAppointments(ctx context.Context, retentionDays int) (int, error) {
	if retentionDays <= 0 {
		return 0, fmt.Errorf("%w, got %d", appointments.ErrAppointmentRetentionWindow, retentionDays)
	}
	cutoff := appointments.Date(r.today().AddDays(-retentionDays).String())
	candidates, err := r.store.ListRetentionCandidates(ctx, cutoff)
	if err != nil {
		return 0, err
	}
	var expired []int64
	for _, candidate := range candidates {
		if last, ok := candidate.LastDay(); ok && last.Before(cutoff) {
			expired = append(expired, candidate.Appointment.ID.Int64())
		}
	}
	if len(expired) == 0 {
		return 0, nil
	}
	locked, err := r.store.LockRetentionCandidates(ctx, cutoff, expired)
	if err != nil {
		return 0, err
	}
	expired = expired[:0]
	for _, candidate := range locked {
		if last, ok := candidate.LastDay(); ok && last.Before(cutoff) {
			expired = append(expired, candidate.Appointment.ID.Int64())
		}
	}
	if len(expired) == 0 {
		return 0, nil
	}
	return r.store.DeleteAppointments(ctx, expired)
}

// DeleteParentConferenceAppointmentsBefore deletes the appointments of
// Elternsprechtag bookings that start before cutoff (#4801).
func (r *Retention) DeleteParentConferenceAppointmentsBefore(ctx context.Context, cutoff appointments.Date) (int, error) {
	if _, err := appointments.ParseDate(cutoff.String()); err != nil {
		return 0, fmt.Errorf("%w: parent conference cutoff: %v", appointments.ErrInvalidAppointment, err)
	}
	ids, err := r.store.ListParentConferenceAppointments(ctx, cutoff)
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	return r.store.DeleteParentConferenceAppointments(ctx, ids)
}
