package api

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The operator edit handler reads the announcement before the service locks
// it. An unpublish that commits after the operator read it refuses the edit
// (ADR 0311): the stale copy writes nothing and the unpublish stays in force.
// An edit on the stored state lands and keeps the publication state.
func TestAnnouncementEditKeepsConcurrentUnpublish(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module := buildCommunication(t, db, &auditRecorder{})
	ctx := testpkg.Ctx(t)
	operator := testpkg.CreateTestOperator(t, db)
	ownAnnouncementsByOperator(t, db, operator.ID)
	announcement := newAnnouncement("Before edit", testpkg.Tenant(t))
	require.NoError(t, module.CreateAnnouncement(ctx, announcement, operator.ID, nil))
	require.NoError(t, module.PublishAnnouncement(ctx, announcement.ID, communication.AnnouncementEditVersion(*announcement), operator.ID, nil))

	stale, err := module.GetAnnouncement(ctx, announcement.ID)
	require.NoError(t, err)
	require.NotNil(t, stale.PublishedAt)
	require.NoError(t, module.UnpublishAnnouncement(ctx, announcement.ID, operator.ID, nil))
	stale.Title = "After edit"
	err = module.UpdateAnnouncement(ctx, stale, communication.AnnouncementEditVersion(*stale), operator.ID, nil)
	require.ErrorIs(t, err, readstate.ErrChanged)

	persisted, err := module.GetAnnouncement(ctx, announcement.ID)
	require.NoError(t, err)
	assert.Equal(t, "Before edit", persisted.Title, "the refused edit writes nothing")
	assert.Nil(t, persisted.PublishedAt, "the committed unpublish stays in force")

	persisted.Title = "After edit"
	require.NoError(t, module.UpdateAnnouncement(ctx, persisted, communication.AnnouncementEditVersion(*persisted), operator.ID, nil))
	stored, err := module.GetAnnouncement(ctx, announcement.ID)
	require.NoError(t, err)
	assert.Equal(t, "After edit", stored.Title, "an edit on the stored state lands")
	assert.Nil(t, stored.PublishedAt, "the edit keeps the publication state")
	assert.Equal(t, communication.AnnouncementEditVersion(*stored), communication.AnnouncementEditVersion(*persisted),
		"the edit answers with the stored version")
}
