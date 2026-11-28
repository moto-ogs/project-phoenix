package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A change of a school closing day also tells the school and its families
// in their notification feed (#7144); see noticeClosingDayChange.
//
// A change of a school closing day proposes a notice to the parents of the
// booked holiday weeks it touches (#6442, #6457, ADR 0196): in the same
// school transaction and under the school's revision lock, so concurrent
// changes of one school merge in order. The proposal sends nothing; only a
// click confirms it. A change whose days, together with those of an
// unfinished command of the same closing day, all lie before today proposes
// nothing, but still resolves that command (#6806).

func (s *Service) lockHolidayClosureRevision(ctx context.Context, stats *domain.OperationStats) (int64, error) {
	revision, lockStats, err := s.store.LockHolidayClosureRevision(ctx)
	stats.Add(lockStats)
	return revision, err
}

func (s *Service) recordHolidayClosureChange(ctx context.Context, stats *domain.OperationStats, closingDayID int64, reason string,
	previous, current *domain.HolidayClosureRange, revision int64,
) error {
	change := domain.HolidayClosureChange{
		SourceKind: domain.HolidayClosureSourceSchoolClosingDay, SourceID: closingDayID, Reason: reason,
		Previous: previous, Current: current, Revision: revision, Today: calendar.Date(s.administration.Today()),
	}
	recordStats, err := s.store.RecordHolidayClosureChange(ctx, change)
	stats.Add(recordStats)
	if err != nil {
		return err
	}
	if err := s.followClosingDayPlans(ctx, previous, current); err != nil {
		return err
	}
	return s.noticeClosingDayChange(ctx, closingDayID, reason, previous, current, change.Today)
}

// followClosingDayPlans hands the days a change opened or closed to the
// plans that leave closing days out (#8205), in the transaction that wrote
// the change. A change that keeps the days changes no plan; the plans keep
// every day up to today themselves.
func (s *Service) followClosingDayPlans(ctx context.Context, previous, current *domain.HolidayClosureRange) error {
	plans := s.administration.ClosingDayPlans
	if plans == nil || sameClosingDays(previous, current) {
		return nil
	}
	var from, to calendar.Date
	for _, r := range []*domain.HolidayClosureRange{previous, current} {
		if r == nil {
			continue
		}
		if from.IsZero() || r.StartsOn.Before(from) {
			from = r.StartsOn
		}
		if to.IsZero() || r.EndsOn.After(to) {
			to = r.EndsOn
		}
	}
	if from.IsZero() {
		return nil
	}
	if err := plans.FollowBreakDays(ctx, from, to); err != nil {
		return fmt.Errorf("school calendar: follow closing day in the plans: %w", err)
	}
	return nil
}

// closingDayNoticePushDays is how far ahead a changed closing day may lie and
// still ring a phone (#7144), the relevance window of the notification feed
// (#7127): a later one reaches the feed only.
const closingDayNoticePushDays = 14

// noticeClosingDayChange tells the school about a planned, changed or
// cancelled closing day (#7144) in the transaction that wrote it. A change
// whose days all lie before today tells nobody, and so does a change that
// keeps the days: only the days decide whether the school is open.
func (s *Service) noticeClosingDayChange(ctx context.Context, closingDayID int64, reason string, previous, current *domain.HolidayClosureRange, today calendar.Date) error {
	notices := s.administration.ClosingDayNotices
	if notices == nil || sameClosingDays(previous, current) {
		return nil
	}
	reaches, push := false, false
	for _, r := range []*domain.HolidayClosureRange{previous, current} {
		if r == nil || r.EndsOn.Before(today) {
			continue
		}
		reaches = true
		push = push || !r.StartsOn.After(today.AddDays(closingDayNoticePushDays))
	}
	if !reaches {
		return nil
	}
	notice := schoolcalendar.ClosingDayNotice{
		ClosingDayID: closingDayID, Reason: reason,
		Previous: closingDayRange(previous), Current: closingDayRange(current), Push: push,
	}
	if err := notices.NotifyClosingDayChanged(ctx, notice); err != nil {
		return fmt.Errorf("school calendar: notify closing day change: %w", err)
	}
	return nil
}

func sameClosingDays(previous, current *domain.HolidayClosureRange) bool {
	return previous != nil && current != nil && *previous == *current
}

func closingDayRange(r *domain.HolidayClosureRange) *schoolcalendar.ClosingDayRange {
	if r == nil {
		return nil
	}
	return &schoolcalendar.ClosingDayRange{StartsOn: r.StartsOn, EndsOn: r.EndsOn}
}
