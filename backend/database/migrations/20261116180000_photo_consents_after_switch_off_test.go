package migrations

import (
	"context"
	"testing"
	"time"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPhotoConsentsAfterSwitchOffEndOnlyTheSurvivors pins 20261116180000
// (#7250): a photo consent given before the school's last switch-off ends,
// with its withdrawal in the trail and its photo queued for removal; a
// consent given after it stays, and neither a switch-on nor a set to false
// while photos were already off counts as a switch-off.
func TestPhotoConsentsAfterSwitchOffEndOnlyTheSurvivors(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()

	day := func(d int) time.Time { return time.Date(2026, time.March, d, 9, 0, 0, 0, time.UTC) }
	student := testpkg.CreateTestStudent(t, db, "Foto", "Ueberlebt", "3a")
	tenantID := student.TenantID
	audit := func(oldValue, newValue *string, action string, at time.Time) {
		t.Helper()
		_, err := db.NewRaw(`INSERT INTO config.setting_audit (tenant_id, setting_key, old_value, new_value, action, changed_at)
			VALUES (?, 'operations.student_photos_enabled', ?::jsonb, ?::jsonb, ?, ?)`, tenantID, oldValue, newValue, action, at).Exec(ctx)
		require.NoError(t, err)
	}
	on, off := "true", "false"
	audit(nil, &on, "set", day(1))
	audit(&on, &off, "set", day(5))
	audit(&off, &on, "set", day(10))
	audit(&on, nil, "reset", day(20)) // the last switch-off: back to the default
	audit(nil, &off, "set", day(25))  // already off, no switch-off

	consenting := func(first string, givenAt time.Time, photo *string) int64 {
		t.Helper()
		child := testpkg.CreateTestStudent(t, db, first, "Foto", "3a")
		_, err := db.NewRaw(`UPDATE users.student_profiles SET photo_consent_given_at = ?, photo_path = ? WHERE id = ?`,
			givenAt, photo, child.ID).Exec(ctx)
		require.NoError(t, err)
		return child.ID
	}
	survivorPhoto := "/uploads/student-photos/ueberlebt.jpg"
	withPhoto := consenting("MitFoto", day(2), &survivorPhoto)
	withoutPhoto := consenting("OhneFoto", day(12), nil)
	afterSwitchOff := consenting("Danach", day(22), nil)

	require.NoError(t, photoConsentsAfterSwitchOffUp(ctx, db))
	require.NoError(t, photoConsentsAfterSwitchOffUp(ctx, db), "the migration reruns")

	type profile struct {
		PhotoPath *string    `bun:"photo_path"`
		GivenAt   *time.Time `bun:"photo_consent_given_at"`
	}
	read := func(id int64) profile {
		t.Helper()
		var row profile
		require.NoError(t, db.NewRaw(`SELECT photo_path, photo_consent_given_at FROM users.student_profiles WHERE id = ?`, id).Scan(ctx, &row))
		return row
	}
	for _, id := range []int64{withPhoto, withoutPhoto} {
		ended := read(id)
		assert.Nil(t, ended.GivenAt, "a consent from before the last switch-off ends (student %d)", id)
		assert.Nil(t, ended.PhotoPath)
	}
	kept := read(afterSwitchOff)
	require.NotNil(t, kept.GivenAt, "a consent given after the last switch-off stays")
	assert.True(t, kept.GivenAt.Equal(day(22)))
	assert.Nil(t, read(student.ID).GivenAt, "a child without a consent stays without one")

	type change struct {
		StudentID      int64  `bun:"student_id"`
		ConsentKey     string `bun:"consent_key"`
		Action         string `bun:"action"`
		Source         string `bun:"source"`
		ActorAccountID *int64 `bun:"actor_account_id"`
	}
	var trail []change
	require.NoError(t, db.NewRaw(`SELECT student_id, consent_key, action, source, actor_account_id
		FROM audit.student_consent_changes WHERE tenant_id = ? ORDER BY student_id`, tenantID).Scan(ctx, &trail))
	require.Len(t, trail, 2, "one withdrawal per ended consent, none on the rerun")
	assert.ElementsMatch(t, []int64{withPhoto, withoutPhoto}, []int64{trail[0].StudentID, trail[1].StudentID})
	for _, entry := range trail {
		assert.Equal(t, "photo", entry.ConsentKey)
		assert.Equal(t, "withdrawn", entry.Action)
		assert.Equal(t, "migration_snapshot", entry.Source)
		assert.Nil(t, entry.ActorAccountID)
	}

	var queued []string
	require.NoError(t, db.NewRaw(`SELECT filename_stored FROM documents.file_cleanup
		WHERE tenant_id = ? AND object_kind = 'student-photos' AND owner_id = ? AND cleaned_at IS NULL`,
		tenantID, tenantID).Scan(ctx, &queued))
	assert.Equal(t, []string{"ueberlebt.jpg"}, queued, "the detached photo waits for the upload cleanup")
}
