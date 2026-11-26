package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestPlatformAnnouncementChangeTimesRepairsTheZeroTime pins 20261124000153
// (#7904): an announcement stored with the zero time gets real creation and
// change times, so it has an edit version again; a stored time stays.
func TestPlatformAnnouncementChangeTimesRepairsTheZeroTime(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	published := time.Date(2026, time.October, 5, 9, 0, 0, 0, time.UTC)
	kept := time.Date(2026, time.October, 6, 9, 0, 0, 0, time.UTC)
	var broken, intact int64
	require.NoError(t, db.NewRaw(`INSERT INTO platform.announcements (title, content, type, severity, active, published_at, created_at, updated_at)
		VALUES ('Jahr eins', 'Text', 'announcement', 'info', TRUE, ?, '0001-01-01 00:00:00+00', '0001-01-01 00:00:00+00') RETURNING id`, published).Scan(ctx, &broken))
	require.NoError(t, db.NewRaw(`INSERT INTO platform.announcements (title, content, type, severity, active, created_at, updated_at)
		VALUES ('Gespeichert', 'Text', 'announcement', 'info', TRUE, ?, ?) RETURNING id`, kept, kept).Scan(ctx, &intact))
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `DELETE FROM platform.announcements WHERE id IN (?, ?)`, broken, intact)
		require.NoError(t, err)
	})

	require.NoError(t, platformAnnouncementChangeTimesUp(ctx, db))

	var created, updated time.Time
	require.NoError(t, db.NewRaw(`SELECT created_at, updated_at FROM platform.announcements WHERE id = ?`, broken).Scan(ctx, &created, &updated))
	assert.True(t, created.Equal(published), "the publication stands in for the unknown creation, got %s", created)
	assert.Greater(t, updated.Year(), 1970, "the change time carries an edit version")
	require.NoError(t, db.NewRaw(`SELECT created_at, updated_at FROM platform.announcements WHERE id = ?`, intact).Scan(ctx, &created, &updated))
	assert.True(t, created.Equal(kept) && updated.Equal(kept), "stored times stay")
}
