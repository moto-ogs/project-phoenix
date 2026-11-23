package announcement_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
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
