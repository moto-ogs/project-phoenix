package application

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
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

type closureNoticeStore struct {
	closureLockStore
	insertedInTransaction bool
}

func (s *closureNoticeStore) InsertClosure(ctx context.Context, input facilities.CloseRoom) (facilities.RoomClosure, domain.OperationStats, error) {
	s.insertedInTransaction, _ = ctx.Value(closureNoticeTransactionKey{}).(bool)
	return facilities.RoomClosure{ID: 7, RoomID: input.RoomID, StartDate: input.StartDate, EndDate: input.EndDate, Reason: input.Reason}, domain.OperationStats{}, nil
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
	store := &closureNoticeStore{}
	notices := &rejectedClosureNotice{}
	today := calendar.NewDate(2026, 11, 26)
	closures := NewClosures(NewRooms(store, transaction, func(ports.Observation) {}), store, func() calendar.Date { return today })
	service, err := NewNoticedClosures(closures, notices, func() calendar.Date { return today })
	require.NoError(t, err)

	_, err = service.CloseRoom(testpkg.TenantContext(47), facilities.CloseRoom{RoomID: 8, StartDate: today, EndDate: today, Reason: "Wasserschaden"})

	require.ErrorIs(t, err, errClosureNotice)
	assert.True(t, store.insertedInTransaction, "the closure write belongs to the outer transaction")
	assert.True(t, notices.calledInTransaction, "the durable notification belongs to the closure transaction")
	assert.Zero(t, transaction.commits, "a rejected notification rolls back the closure transaction")
}
