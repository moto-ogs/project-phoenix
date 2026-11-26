package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A change of an opening change tells the school, its families and its
// Träger in their notification feed (#8178), in the transaction that wrote
// it and with the push window of the closing days (#7144).

// OpeningChangeStore persists the opening changes of the school of the
// ambient tenant transaction; LockOpeningChange reads one and holds it until
// the transaction ends, so a notice names the version a write replaced.
type OpeningChangeStore interface {
	schoolcalendar.OpeningChanges
	LockOpeningChange(ctx context.Context, id int64) (schoolcalendar.OpeningChange, error)
}

// NoticedOpeningChanges serves the opening changes over the store and tells
// the school of every write that concerns today or a later day. Reads pass
// to the store unchanged.
type NoticedOpeningChanges struct {
	OpeningChangeStore
	notices schoolcalendar.OpeningChangeNotices
	today   func() string
}

var _ schoolcalendar.OpeningChanges = (*NoticedOpeningChanges)(nil)

// NewNoticedOpeningChanges builds the opening changes over store; today
// names the school's day (YYYY-MM-DD) the push window counts from.
func NewNoticedOpeningChanges(store OpeningChangeStore, notices schoolcalendar.OpeningChangeNotices, today func() string) *NoticedOpeningChanges {
	if store == nil || notices == nil || today == nil {
		panic("school calendar: the opening change store, the notices and the day are required")
	}
	return &NoticedOpeningChanges{OpeningChangeStore: store, notices: notices, today: today}
}

// CreateOpeningChange stores a new change and tells the school.
func (c *NoticedOpeningChanges) CreateOpeningChange(ctx context.Context, input schoolcalendar.OpeningChangeInput) (schoolcalendar.OpeningChange, error) {
	change, err := c.OpeningChangeStore.CreateOpeningChange(ctx, input)
	if err != nil {
		return change, err
	}
	if notice, ok := openingChangeNotice(c.today(), change.ID, change.Reason, nil, openingChangeSpan(change)); ok {
		if err := c.notices.NotifyOpeningChangeChanged(ctx, notice); err != nil {
			return schoolcalendar.OpeningChange{}, notifyOpeningChangeError(err)
		}
	}
	return change, nil
}

// UpdateOpeningChange replaces a change and tells the school what it was
// and what it is now.
func (c *NoticedOpeningChanges) UpdateOpeningChange(ctx context.Context, id int64, input schoolcalendar.OpeningChangeInput) (schoolcalendar.OpeningChange, error) {
	previous, err := c.LockOpeningChange(ctx, id)
	if err != nil {
		return schoolcalendar.OpeningChange{}, err
	}
	change, err := c.OpeningChangeStore.UpdateOpeningChange(ctx, id, input)
	if err != nil {
		return change, err
	}
	if notice, ok := openingChangeNotice(c.today(), change.ID, change.Reason, openingChangeSpan(previous), openingChangeSpan(change)); ok {
		if err := c.notices.NotifyOpeningChangeChanged(ctx, notice); err != nil {
			return schoolcalendar.OpeningChange{}, notifyOpeningChangeError(err)
		}
	}
	return change, nil
}

// DeleteOpeningChange removes a change and tells the school which one.
func (c *NoticedOpeningChanges) DeleteOpeningChange(ctx context.Context, id int64) error {
	previous, err := c.LockOpeningChange(ctx, id)
	if err != nil {
		return err
	}
	if err := c.OpeningChangeStore.DeleteOpeningChange(ctx, id); err != nil {
		return err
	}
	if notice, ok := openingChangeNotice(c.today(), id, previous.Reason, openingChangeSpan(previous), nil); ok {
		if err := c.notices.NotifyOpeningChangeChanged(ctx, notice); err != nil {
			return notifyOpeningChangeError(err)
		}
	}
	return nil
}

// openingChangeNotice decides the notice of a write on today: none for a
// change whose days all lie before today, nor for one that keeps its days and
// times, since only they decide when the school closes.
func openingChangeNotice(today string, id int64, reason string, previous, current *schoolcalendar.OpeningChangeSpan) (schoolcalendar.OpeningChangeNotice, bool) {
	if previous != nil && current != nil && *previous == *current {
		return schoolcalendar.OpeningChangeNotice{}, false
	}
	day := calendar.Date(today)
	reaches, push := false, false
	for _, span := range []*schoolcalendar.OpeningChangeSpan{previous, current} {
		if span == nil || span.EndsOn.Before(day) {
			continue
		}
		reaches = true
		push = push || !span.StartsOn.After(day.AddDays(closingDayNoticePushDays))
	}
	return schoolcalendar.OpeningChangeNotice{
		OpeningChangeID: id, Reason: reason, Previous: previous, Current: current, Push: push,
	}, reaches
}

func notifyOpeningChangeError(err error) error {
	return fmt.Errorf("school calendar: notify opening change: %w", err)
}

func openingChangeSpan(change schoolcalendar.OpeningChange) *schoolcalendar.OpeningChangeSpan {
	return &schoolcalendar.OpeningChangeSpan{
		StartsOn: change.StartDate, EndsOn: change.EndDate, OpensAt: change.OpensAt, ClosesAt: change.ClosesAt,
	}
}
