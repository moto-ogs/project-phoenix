package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var errClosureNotice = errors.New("write notice")

type closureNoticeTransaction struct {
	commits int
}

func (t *closureNoticeTransaction) RunWrite(ctx context.Context, callback func(context.Context) error) error {
	err := callback(context.WithValue(ctx, closureNoticeTransactionKey{}, true))
	if err == nil {
		t.commits++
	}
	return err
}

func (*closureNoticeTransaction) AcquireLock(context.Context, string) error { return nil }

type closureNoticeTransactionKey struct{}

type closureNoticeClosures struct {
	closedInTransaction bool
}

func (c *closureNoticeClosures) CloseRoom(ctx context.Context, _ facilities.CloseRoom) (facilities.RoomClosure, error) {
	c.closedInTransaction, _ = ctx.Value(closureNoticeTransactionKey{}).(bool)
	day := calendar.NewDate(2026, 11, 26)
	return facilities.RoomClosure{ID: 7, RoomID: 8, RoomName: "Werkraum", StartDate: day, EndDate: day, Reason: "Wasserschaden"}, nil
}

func (*closureNoticeClosures) ReopenRoom(context.Context, int64, int64) error { return nil }

func (*closureNoticeClosures) ListRoomClosures(context.Context, facilities.RoomClosureFilter) ([]facilities.RoomClosure, error) {
	return nil, nil
}

func (*closureNoticeClosures) RoomClosedOn(context.Context, int64, calendar.Date) (bool, error) {
	return false, nil
}

func (*closureNoticeClosures) RoomClosureRanges(context.Context, []int64, calendar.Date, calendar.Date) ([]facilities.RoomClosure, error) {
	return nil, nil
}

type rejectedClosureNotice struct {
	calledInTransaction bool
}

func (n *rejectedClosureNotice) NotifyRoomClosed(ctx context.Context, _ facilities.RoomClosureNotice) error {
	n.calledInTransaction, _ = ctx.Value(closureNoticeTransactionKey{}).(bool)
	return errClosureNotice
}

func TestNoticedClosuresRollsBackClosureWhenNoticeFails(t *testing.T) {
	t.Parallel()

	transaction := &closureNoticeTransaction{}
	closures := &closureNoticeClosures{}
	notices := &rejectedClosureNotice{}
	service := NewNoticedClosures(closures, notices, transaction, func() calendar.Date { return calendar.NewDate(2026, 11, 26) })

	_, err := service.CloseRoom(context.Background(), facilities.CloseRoom{RoomID: 8})

	require.ErrorIs(t, err, errClosureNotice)
	assert.True(t, closures.closedInTransaction, "the closure write belongs to the outer transaction")
	assert.True(t, notices.calledInTransaction, "the durable notification belongs to the closure transaction")
	assert.Zero(t, transaction.commits, "a rejected notification rolls back the closure transaction")
}
