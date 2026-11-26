package announcement_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	configModel "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A survey edit and its publication carry the draft they were made on, and a
// delete the answers its dialog named (ADR 0311): a stale token is refused
// and writes nothing, the token of the stored state passes.
func TestSurvey_WritesRefuseAChangedReadState(t *testing.T) {
	t.Parallel()
	f := newSurveyFixture(t, 2)
	read := func(id int64) *communication.Survey {
		var survey *communication.Survey
		require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
			var err error
			survey, err = f.surveys.GetSurvey(ctx, id)
			return err
		}))
		return survey
	}
	var draft *communication.Survey
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		var err error
		draft, err = f.surveys.CreateSurvey(ctx, f.staff[0].AccountID, staffSurveyInput(false))
		return err
	}))
	opened := communication.SurveyVersion(*draft)

	edit := staffSurveyInput(false)
	edit.Title = "Erste Fassung"
	edit.ExpectedVersion = opened
	var saved *communication.Survey
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		var err error
		saved, err = f.surveys.UpdateSurvey(ctx, draft.ID, edit)
		return err
	}))
	assert.Equal(t, communication.SurveyVersion(*read(draft.ID)), communication.SurveyVersion(*saved), "the save answers the stored version")

	stale := staffSurveyInput(false)
	stale.Title = "Zweite Fassung"
	stale.ExpectedVersion = opened
	require.ErrorIs(t, f.inSchool(t, func(ctx context.Context) error {
		_, err := f.surveys.UpdateSurvey(ctx, draft.ID, stale)
		return err
	}), readstate.ErrChanged)
	require.ErrorIs(t, f.inSchool(t, func(ctx context.Context) error {
		_, err := f.surveys.PublishSurvey(ctx, f.staff[0].AccountID, draft.ID, opened)
		return err
	}), readstate.ErrChanged)
	current := read(draft.ID)
	assert.Equal(t, "Erste Fassung", current.Title, "the refused edit wrote nothing")
	assert.Nil(t, current.PublishedAt, "the refused publication published nothing")

	var published *communication.Survey
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		var err error
		published, err = f.surveys.PublishSurvey(ctx, f.staff[0].AccountID, draft.ID, communication.SurveyVersion(*current))
		return err
	}))
	dialog := communication.SurveyDeleteFingerprint(*read(published.ID))
	f.answerAll(t, published, 1)
	require.ErrorIs(t, f.inSchool(t, func(ctx context.Context) error {
		return f.surveys.DeleteSurvey(ctx, published.ID, dialog)
	}), readstate.ErrChanged, "an answer given after the dialog opened refuses the delete")
	require.Equal(t, 1, read(published.ID).ParticipantCount, "the refused delete removed nothing")

	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		return f.surveys.DeleteSurvey(ctx, published.ID, communication.SurveyDeleteFingerprint(*read(published.ID)))
	}))
}

// An answer that commits while the delete waits for the survey's row lock is
// counted: the statement that waited took its snapshot before the answer
// committed, so the count under the lock comes from a statement of its own.
func TestSurvey_DeleteCountsAnAnswerCommittedWhileItWaited(t *testing.T) {
	t.Parallel()
	f := newSurveyFixture(t, 1)
	survey := f.publishStaffSurvey(t, false)
	var dialog string
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		read, err := f.surveys.GetSurvey(ctx, survey.ID)
		if err == nil {
			dialog = communication.SurveyDeleteFingerprint(*read)
		}
		return err
	}))

	// The answer holds the survey row and commits only after the delete
	// queued behind it.
	held := make(chan int, 1)
	proceed := make(chan struct{})
	answered := make(chan error, 1)
	go func() {
		ctx := testpkg.WithTenantRuntime(t, testpkg.Ctx(t), f.db)
		answered <- tenant.WithTenantTx(ctx, f.db, testpkg.Tenant(t), func(txCtx context.Context, tx bun.Tx) error {
			var pid int
			if err := tx.NewRaw(`SELECT pg_backend_pid() FROM users.surveys WHERE id = ? FOR UPDATE`, survey.ID).Scan(txCtx, &pid); err != nil {
				held <- 0
				return err
			}
			if err := f.surveys.SubmitStaffSurvey(txCtx, f.staff[0].AccountID, survey.ID, answersFor(survey, 0)); err != nil {
				held <- 0
				return err
			}
			held <- pid
			<-proceed
			return nil
		})
	}()
	holder := <-held
	require.NotZero(t, holder, "the answer holds the survey: %v", answered)

	deleted := make(chan error, 1)
	go func() {
		deleted <- f.inSchool(t, func(ctx context.Context) error {
			return f.surveys.DeleteSurvey(ctx, survey.ID, dialog)
		})
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := f.db.NewRaw("SELECT EXISTS (SELECT 1 FROM pg_locks l WHERE NOT l.granted AND ? = ANY(pg_blocking_pids(l.pid)))", holder).
			Scan(context.Background(), &waiting)
		return err == nil && waiting
	}, 10*time.Second, 10*time.Millisecond, "the delete waits for the survey row the answer holds")
	close(proceed)
	require.NoError(t, <-answered)

	require.ErrorIs(t, <-deleted, readstate.ErrChanged, "the answer given while the delete waited refuses it")
	var participants int
	require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM users.survey_participations WHERE survey_id = ?`, survey.ID).Scan(testpkg.Ctx(t), &participants))
	assert.Equal(t, 1, participants, "the refused delete removed nothing")
}

// The attachments are part of what a publication confirms (ADR 0311): an
// attachment added or removed since the author opened the draft stamps it,
// so the publication of the version the author read is refused and
// publishes nothing; the version the attachment change answered passes.
func TestParentAnnouncement_AttachmentChangeRefusesAnOlderPublication(t *testing.T) {
	t.Parallel()
	news := noticeSettings()
	news.ResolveBoolFn = func(_ context.Context, key string) (bool, error) {
		return key == configModel.KeyParentNewsEnabled || key == configModel.KeyNotificationsDispatchEnabled, nil
	}
	f := newSurveyFixtureWith(t, 1, news)
	var draft *communication.ParentAnnouncement
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		var err error
		draft, err = f.announcements.CreateParentAnnouncement(ctx, f.staff[0].AccountID, communication.ParentAnnouncementInput{
			Title: "Ausflug", Body: "Wir fahren in den Zoo.", Priority: "info",
			Targets: []communication.ParentAnnouncementTargetInput{{TargetType: "school_all"}},
		})
		return err
	}))
	opened := communication.ParentAnnouncementVersion(*draft)

	// A colleague attaches a file: the file side locks the draft at the
	// version their editor holds and stamps it after the change.
	var changed string
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		exists, editable, err := f.announcements.LockAnnouncementForAttachmentChange(ctx, draft.ID, opened)
		if err != nil {
			return err
		}
		require.True(t, exists && editable)
		changed, err = f.announcements.ResetAnnouncementEngagement(ctx, draft.ID)
		return err
	}))
	require.NotEqual(t, opened, changed, "the attachment change stamps the draft")

	require.ErrorIs(t, f.inSchool(t, func(ctx context.Context) error {
		_, err := f.announcements.PublishParentAnnouncement(ctx, draft.ID, opened)
		return err
	}), readstate.ErrChanged, "the author's older version is refused")
	require.ErrorIs(t, f.inSchool(t, func(ctx context.Context) error {
		_, _, err := f.announcements.LockAnnouncementForAttachmentChange(ctx, draft.ID, opened)
		return err
	}), readstate.ErrChanged, "so is a further attachment change on it")
	var stored *communication.ParentAnnouncement
	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		var err error
		stored, err = f.announcements.GetParentAnnouncement(ctx, draft.ID)
		return err
	}))
	require.Nil(t, stored.PublishedAt, "the refused publication published nothing")
	require.Equal(t, changed, communication.ParentAnnouncementVersion(*stored), "the answered version is the stored one")

	require.NoError(t, f.inSchool(t, func(ctx context.Context) error {
		_, err := f.announcements.PublishParentAnnouncement(ctx, draft.ID, changed)
		return err
	}))
}
