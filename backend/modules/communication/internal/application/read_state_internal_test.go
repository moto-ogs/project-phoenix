package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// An announcement edited, published or rescheduled since its author read it
// refuses the write with readstate.ErrChanged and writes nothing; the version
// of the stored state passes (ADR 0311).

// readEarlier is the version of a state older than the stored one.
var readEarlier = readstate.Of(storedAt.Add(-time.Minute))

func TestUpdateRefusesADraftChangedSinceItWasRead(t *testing.T) {
	t.Parallel()
	repo := &fakeAnnouncementRepo{announcement: draftAnnouncement(false)}
	svc := newTestService(repo, &fakeOutbox{})
	in := validInput()

	in.ExpectedVersion = readEarlier
	_, err := svc.Update(context.Background(), repo.announcement.ID, in)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Zero(t, repo.updateCalls, "a refused edit writes nothing")

	in.ExpectedVersion = ""
	_, err = svc.Update(context.Background(), repo.announcement.ID, in)
	require.ErrorIs(t, err, readstate.ErrChanged, "an edit without a read version is refused")

	in.ExpectedVersion = readstate.Of(storedAt)
	_, err = svc.Update(context.Background(), repo.announcement.ID, in)
	require.NoError(t, err)
	assert.Equal(t, 1, repo.updateCalls)
}

func TestPublishRefusesADraftChangedSinceItWasRead(t *testing.T) {
	t.Parallel()
	repo := &fakeAnnouncementRepo{announcement: draftAnnouncement(false)}
	svc := newTestService(repo, &fakeOutbox{})

	_, err := svc.Publish(context.Background(), repo.announcement.ID, readEarlier)
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Zero(t, repo.publishCalls, "a refused publication publishes nothing")
	assert.Nil(t, repo.announcement.PublishedAt)

	_, err = svc.Publish(context.Background(), repo.announcement.ID, readstate.Of(storedAt))
	require.NoError(t, err)
	assert.Equal(t, 1, repo.publishCalls)
}

func TestUpdateReminderRefusesAReminderChangedSinceItWasRead(t *testing.T) {
	t.Parallel()
	a := publishedWithReminder(false)
	repo := &reminderRepo{fakeAnnouncementRepo: fakeAnnouncementRepo{announcement: a}, setReminderApplied: true}
	h := newReminderHarness(repo)
	future := staffTestNow.Add(48 * time.Hour)

	_, err := h.svc.UpdateReminder(context.Background(), a.ID, ReminderInput{ReminderAt: &future, ExpectedVersion: readEarlier})
	require.ErrorIs(t, err, readstate.ErrChanged)
	assert.Empty(t, repo.setReminderCalls, "a refused reminder edit writes nothing")

	_, err = h.svc.UpdateReminder(context.Background(), a.ID, ReminderInput{ReminderAt: &future, ExpectedVersion: readstate.Of(storedAt)})
	require.NoError(t, err)
	assert.Len(t, repo.setReminderCalls, 1)
}
